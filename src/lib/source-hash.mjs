import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalBytes(content) {
  if (content.includes(0)) return content;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    return Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
  } catch {
    return content;
  }
}

export async function computeNodeKitSourceHash(repoRoot) {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const entries = ["package.json", ...(packageJson.files ?? [])];
  const files = [];
  const visit = async (absolute) => {
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) throw new Error(`NodeKit distribution cannot contain symlinks: ${absolute}`);
    if (metadata.isDirectory()) {
      const children = await readdir(absolute);
      children.sort();
      for (const child of children) await visit(path.join(absolute, child));
      return;
    }
    const content = canonicalBytes(await readFile(absolute));
    files.push({ digest: createHash("sha256").update(content).digest("hex"), path: path.relative(repoRoot, absolute).replaceAll("\\", "/") });
  };
  for (const relative of entries) await visit(path.join(repoRoot, relative));
  return digest(files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}
