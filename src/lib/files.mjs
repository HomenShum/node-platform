import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nodekit",
  ".proofloop",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

export async function readYaml(target) {
  return parse(await readFile(target, "utf8"));
}

export async function listSourceFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      if (entry.isDirectory() && entry.name.startsWith(".node-platform")) continue;
      if (entry.isDirectory() && entry.name.startsWith(".tmp")) continue;

      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push({ absolute, relative: normalizePath(path.relative(root, absolute)) });
      }
    }
  }

  await visit(root);
  return files;
}
