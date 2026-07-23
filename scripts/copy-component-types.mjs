import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "src/component/_generated/component.d.ts");
const target = resolve(root, "dist/component/_generated/component.d.ts");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
