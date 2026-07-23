const FORBIDDEN_KEY = /(?:api[_-]?key|secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token)/i;
const FORBIDDEN_VALUE = /(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/;

function walk(value, location = "$") {
  if (typeof value === "string") {
    return FORBIDDEN_VALUE.test(value) ? [`${location}: secret-like value`] : [];
  }
  if (Array.isArray(value)) return value.flatMap((entry, index) => walk(entry, `${location}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(FORBIDDEN_KEY.test(key) ? [`${location}.${key}: secret-like key`] : []),
    ...walk(entry, `${location}.${key}`),
  ]);
}

export const validator = Object.freeze({
  id: "receipt-is-secret-free",
  version: "1.0.0",
  async validate({ receipt }) {
    const findings = walk(receipt);
    return {
      details: { findingCount: findings.length, findings },
      message: findings.length === 0
        ? "The bounded receipt contains no secret-like keys or values."
        : "The receipt contains a secret-like key or value and cannot be emitted.",
      passed: findings.length === 0,
    };
  },
});
