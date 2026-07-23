import { createHash } from "node:crypto";

/**
 * Produce a deterministic content hash for bounded, structured runtime output.
 * This intentionally never accepts binary artifacts or provider payloads.
 */
export function stableDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
