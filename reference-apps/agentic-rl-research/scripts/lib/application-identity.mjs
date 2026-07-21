import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalBytes(file) {
  const content = readFileSync(file);
  if (content.includes(0)) return content;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    return Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
  } catch {
    return content;
  }
}

function contained(root, relative) {
  const absolute = path.resolve(root, relative);
  const fromRoot = path.relative(root, absolute);
  if (path.isAbsolute(relative) || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    throw new Error(`compiled identity contains an unsafe path: ${relative}`);
  }
  return absolute;
}

function currentFiles(root, identity) {
  const files = new Set();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if ([".git", ".nodeagent", "node_modules"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`application identity does not permit symlinks: ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else files.add(path.relative(root, absolute).replaceAll("\\", "/"));
    }
  };
  for (const relative of identity.roots?.resolvedDirectories ?? []) {
    const absolute = contained(root, relative);
    if (lstatSync(absolute, { throwIfNoEntry: false })?.isDirectory()) visit(absolute);
  }
  for (const relative of identity.roots?.files ?? []) {
    const absolute = contained(root, relative);
    if (lstatSync(absolute, { throwIfNoEntry: false })?.isFile()) files.add(relative.replaceAll("\\", "/"));
  }
  return [...files].sort();
}

export function requireCurrentApplicationIdentity(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  const identity = JSON.parse(readFileSync(path.join(root, ".nodeagent", "application-identity.json"), "utf8"));
  const inventory = identity.identity ?? {};
  const expectedPaths = (inventory.files ?? []).map((file) => file.path).sort();
  const actualPaths = currentFiles(root, inventory);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("compiled application identity is stale: the identity-bound file set changed");
  }
  for (const expected of inventory.files ?? []) {
    const content = canonicalBytes(contained(root, expected.path));
    if (content.byteLength !== expected.bytes || hash(content) !== expected.digest) {
      throw new Error(`compiled application identity is stale: ${expected.path} changed`);
    }
  }
  const manifest = canonicalBytes(path.join(root, "nodeagent.yaml"));
  if (hash(manifest) !== identity.manifestDigest) {
    throw new Error("compiled application identity is stale: nodeagent.yaml changed");
  }
  return identity;
}
