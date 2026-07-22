#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { signDetachedAttestation } from "../src/lib/submission-attestation.mjs";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`--${name} is required`);
  return process.argv[index + 1];
}

const payloadPath = path.resolve(argument("payload"));
const outputPath = path.resolve(argument("output"));
const keyId = argument("key-id");
const privateKeyPath = process.env.NODEKIT_ATTESTATION_PRIVATE_KEY_FILE;
if (!privateKeyPath) throw new Error("NODEKIT_ATTESTATION_PRIVATE_KEY_FILE must name an external Ed25519 private-key PEM file");
const payload = JSON.parse(await readFile(payloadPath, "utf8"));
const privateKey = await readFile(path.resolve(privateKeyPath), "utf8");
const attestation = signDetachedAttestation({ payload, privateKey, keyId });
await writeFile(outputPath, `${JSON.stringify(attestation, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ keyId, outputPath, payloadSha256: attestation.payloadSha256, payloadType: attestation.payloadType }, null, 2));
