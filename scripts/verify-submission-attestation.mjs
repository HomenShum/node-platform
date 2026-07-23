#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseTrustedAttestationKeysJson,
  verifyDetachedAttestation,
} from "../src/lib/submission-attestation.mjs";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`--${name} is required`);
  return process.argv[index + 1];
}

const payload = JSON.parse(await readFile(path.resolve(argument("payload")), "utf8"));
const attestation = JSON.parse(await readFile(path.resolve(argument("attestation")), "utf8"));
const trustedKeys = parseTrustedAttestationKeysJson(process.env.NODEKIT_SUBMISSION_TRUSTED_KEYS_JSON ?? "{}");
const result = verifyDetachedAttestation({
  payload,
  attestation,
  expectedPayloadType: payload.type,
  trustedKeys,
});
console.log(JSON.stringify(result, null, 2));
