import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const validators = new Map();

export function createSchemaAjv(options = {}) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, ...options });
  addFormats(ajv);
  return ajv;
}

async function validatorFor(name) {
  if (!validators.has(name)) {
    const schema = JSON.parse(await readFile(path.join(packageRoot, "schemas", name), "utf8"));
    const ajv = createSchemaAjv();
    validators.set(name, ajv.compile(schema));
  }
  return validators.get(name);
}

export async function validateSchema(name, value, label) {
  const validator = await validatorFor(name);
  if (validator(value)) return [];
  return (validator.errors ?? []).map(
    (entry) => `${label}${entry.instancePath || "/"} ${entry.message}`,
  );
}
