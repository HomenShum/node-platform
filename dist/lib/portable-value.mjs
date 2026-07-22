export const PORTABLE_VALUE_LIMITS = Object.freeze({
    maxArrayItems: 8_192,
    // Leave substantial headroom under Convex's 1 MiB document limit for
    // record metadata and codec overhead.
    maxEncodedBytes: 768 * 1_024,
    maxEnvelopeBytes: 900 * 1_024,
    // Convex documents may be nested at most 16 levels. Caseflow payloads are
    // embedded in result/event envelopes, so reserve three levels for those
    // provider-owned wrappers and one final level for the document itself.
    maxEnvelopeNestingDepth: 15,
    maxNestingDepth: 15,
    maxPayloadNestingDepth: 12,
    maxObjectFields: 1_024,
    maxObjectKeyLength: 1_024,
});
/**
 * Normalize a value into NodeKit's provider-portable JSON subset.
 *
 * The function deliberately rejects values whose JavaScript, JSON, Convex,
 * and PostgreSQL representations differ. It also returns a fresh plain value
 * so adapters never store a caller-owned mutable object.
 *
 * @param {unknown} value
 * @param {string} [label]
 * @param {{maxEncodedBytes?: number, maxNestingDepth?: number}} [options]
 * @returns {null | boolean | number | string | Array<unknown> | Record<string, unknown>}
 */
export function normalizePortableValue(value, label = "value", options = {}) {
    const maxNestingDepth = options.maxNestingDepth ?? PORTABLE_VALUE_LIMITS.maxNestingDepth;
    if (!Number.isSafeInteger(maxNestingDepth)
        || maxNestingDepth < 1
        || maxNestingDepth > PORTABLE_VALUE_LIMITS.maxEnvelopeNestingDepth) {
        throw new TypeError(`maxNestingDepth must be between 1 and ${PORTABLE_VALUE_LIMITS.maxEnvelopeNestingDepth}`);
    }
    /** @type {Set<object>} */
    const ancestors = new Set();
    /**
     * @param {unknown} candidate
     * @param {string} path
     * @param {number} depth
     * @returns {null | boolean | number | string | Array<unknown> | Record<string, unknown>}
     */
    function visit(candidate, path, depth) {
        if (candidate === null || typeof candidate === "boolean")
            return candidate;
        if (typeof candidate === "string")
            return requirePortableString(candidate, path);
        if (typeof candidate === "number") {
            if (!Number.isFinite(candidate))
                throw new TypeError(`${path} must be a portable value; non-finite numbers are not supported`);
            // JSON, JSONB, and Convex do not preserve JavaScript's negative zero
            // distinction. Canonicalize it before hashing and persistence.
            return Object.is(candidate, -0) ? 0 : candidate;
        }
        if (candidate === undefined)
            throw new TypeError(`${path} must be a portable value; undefined is not supported`);
        if (typeof candidate === "bigint")
            throw new TypeError(`${path} must be a portable value; BigInt is not supported`);
        if (typeof candidate === "function")
            throw new TypeError(`${path} must be a portable value; functions are not supported`);
        if (typeof candidate === "symbol")
            throw new TypeError(`${path} must be a portable value; symbols are not supported`);
        if (typeof candidate !== "object")
            throw new TypeError(`${path} must be a portable value`);
        if (depth > maxNestingDepth) {
            throw new TypeError(`${path} must be a portable value; nesting exceeds ${maxNestingDepth} levels`);
        }
        if (ancestors.has(candidate))
            throw new TypeError(`${path} must be a portable value; cyclic references are not supported`);
        ancestors.add(candidate);
        try {
            if (Array.isArray(candidate)) {
                if (candidate.length > PORTABLE_VALUE_LIMITS.maxArrayItems) {
                    throw new TypeError(`${path} must be a portable value; arrays cannot exceed ${PORTABLE_VALUE_LIMITS.maxArrayItems} items`);
                }
                if (Object.getPrototypeOf(candidate) !== Array.prototype) {
                    throw new TypeError(`${path} must be a portable value; custom array prototypes are not supported`);
                }
                const symbolKeys = Object.getOwnPropertySymbols(candidate);
                if (symbolKeys.length > 0)
                    throw new TypeError(`${path} must be a portable value; symbol keys are not supported`);
                const propertyNames = Object.getOwnPropertyNames(candidate);
                const indexKeys = propertyNames.filter((key) => key !== "length");
                if (indexKeys.length !== candidate.length) {
                    throw new TypeError(`${path} must be a portable value; sparse arrays and array properties are not supported`);
                }
                const result = new Array(candidate.length);
                for (const key of indexKeys) {
                    const index = Number(key);
                    if (!Number.isInteger(index)
                        || index < 0
                        || index >= candidate.length
                        || index > 4_294_967_294
                        || String(index) !== key) {
                        throw new TypeError(`${path} must be a portable value; array properties are not supported`);
                    }
                    const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
                    if (!descriptor?.enumerable || !("value" in descriptor)) {
                        throw new TypeError(`${path}[${key}] must be a portable value; accessors and non-enumerable properties are not supported`);
                    }
                    result[index] = visit(descriptor.value, `${path}[${key}]`, depth + 1);
                }
                return result;
            }
            const prototype = Object.getPrototypeOf(candidate);
            if (prototype !== Object.prototype && prototype !== null) {
                const prototypeName = prototype?.constructor?.name ?? "unknown";
                throw new TypeError(`${path} must be a portable value; custom prototype ${prototypeName} is not supported`);
            }
            if (Object.getOwnPropertySymbols(candidate).length > 0) {
                throw new TypeError(`${path} must be a portable value; symbol keys are not supported`);
            }
            const propertyNames = Object.getOwnPropertyNames(candidate);
            if (propertyNames.length > PORTABLE_VALUE_LIMITS.maxObjectFields) {
                throw new TypeError(`${path} must be a portable value; objects cannot exceed ${PORTABLE_VALUE_LIMITS.maxObjectFields} fields`);
            }
            /** @type {Record<string, unknown>} */
            const result = {};
            for (const key of propertyNames) {
                requirePortableString(key, `${path} object key`);
                if (key === "__proto__") {
                    throw new TypeError(`${path} object key must be a portable value; __proto__ is not supported`);
                }
                if (key.length > PORTABLE_VALUE_LIMITS.maxObjectKeyLength) {
                    throw new TypeError(`${path} object key must be a portable value; keys cannot exceed ${PORTABLE_VALUE_LIMITS.maxObjectKeyLength} characters`);
                }
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                    throw new TypeError(`${path} object key must be a portable value; keys must use Convex-compatible ASCII identifiers`);
                }
                const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
                if (!descriptor?.enumerable || !("value" in descriptor)) {
                    throw new TypeError(`${path}.${key} must be a portable value; accessors and non-enumerable properties are not supported`);
                }
                // Descriptor-safe cloning avoids invoking any legacy setters while
                // keeping the normalized result a plain object.
                Object.defineProperty(result, key, {
                    configurable: true,
                    enumerable: true,
                    value: visit(descriptor.value, `${path}.${key}`, depth + 1),
                    writable: true,
                });
            }
            return result;
        }
        finally {
            ancestors.delete(candidate);
        }
    }
    const normalized = visit(value, label, 1);
    const encodedBytes = new TextEncoder().encode(JSON.stringify(normalized)).byteLength;
    const maxEncodedBytes = options.maxEncodedBytes ?? PORTABLE_VALUE_LIMITS.maxEncodedBytes;
    if (!Number.isSafeInteger(maxEncodedBytes) || maxEncodedBytes < 1 || maxEncodedBytes > PORTABLE_VALUE_LIMITS.maxEnvelopeBytes) {
        throw new TypeError(`maxEncodedBytes must be between 1 and ${PORTABLE_VALUE_LIMITS.maxEnvelopeBytes}`);
    }
    if (encodedBytes > maxEncodedBytes) {
        throw new TypeError(`${label} must be a portable value; encoded size cannot exceed ${maxEncodedBytes} bytes`);
    }
    return normalized;
}
/**
 * PostgreSQL jsonb rejects NUL and invalid UTF-16 surrogate escapes. Reject
 * them for every provider so a value that hashes successfully is always
 * persistable by Memory, Convex, and PostgreSQL.
 *
 * @param {string} value
 * @param {string} path
 */
function requirePortableString(value, path) {
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit === 0) {
            throw new TypeError(`${path} must be a portable value; NUL characters are not supported`);
        }
        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
                throw new TypeError(`${path} must be a portable value; unpaired UTF-16 surrogates are not supported`);
            }
            index += 1;
        }
        else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            throw new TypeError(`${path} must be a portable value; unpaired UTF-16 surrogates are not supported`);
        }
    }
    return value;
}
/**
 * Validate and normalize the user-authored stage definitions shared by every
 * Caseflow adapter.
 *
 * @param {unknown} stages
 */
export function normalizeStageDefinitions(stages) {
    if (!Array.isArray(stages) || stages.length === 0)
        throw new Error("run stages are required");
    const portableStages = normalizePortableValue(stages, "stages");
    if (!Array.isArray(portableStages))
        throw new Error("run stages are required");
    const seen = new Set();
    return portableStages.map((candidate, index) => {
        if (candidate === null || Array.isArray(candidate) || typeof candidate !== "object") {
            throw new TypeError(`stages[${index}] must be an object`);
        }
        const stage = /** @type {Record<string, unknown>} */ (candidate);
        const id = requireTrimmedText(stage.id, `stages[${index}].id`);
        const label = requireTrimmedText(stage.label, `stages[${index}].label`);
        const owner = requireTrimmedText(stage.owner, `stages[${index}].owner`);
        if (seen.has(id))
            throw new Error(`stage ids must be unique: ${id}`);
        seen.add(id);
        return { id, label, owner, status: index === 0 ? "active" : "pending" };
    });
}
/**
 * Compare an active run's possibly-progressed stages with a newly requested
 * immutable stage plan. Runtime status is deliberately ignored.
 *
 * @param {unknown} currentStages
 * @param {Array<{id: string, label: string, owner: string}>} requestedStages
 */
export function stageDefinitionsMatch(currentStages, requestedStages) {
    if (!Array.isArray(currentStages) || currentStages.length !== requestedStages.length)
        return false;
    return currentStages.every((stage, index) => {
        const requested = requestedStages[index];
        return stage !== null
            && typeof stage === "object"
            && stage.id === requested.id
            && stage.label === requested.label
            && stage.owner === requested.owner;
    });
}
/** @param {unknown} value @param {string} label */
export function requireTrimmedText(value, label) {
    if (typeof value !== "string")
        throw new TypeError(`${label} must be a string`);
    const normalized = value.trim();
    if (normalized.length === 0)
        throw new Error(`${label} cannot be empty`);
    return normalized;
}
//# sourceMappingURL=portable-value.mjs.map