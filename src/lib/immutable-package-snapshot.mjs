import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectNpmPackageArchiveFile } from "./npm-package-archive.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function manifestIdentity(archive) {
  return JSON.stringify({
    canonicalManifest: archive.canonicalManifest,
    fileManifest: archive.fileManifest,
    name: archive.name,
    tarballSha256: archive.tarballSha256,
    version: archive.version,
  });
}

export function packageArchivesMatch(left, right) {
  return manifestIdentity(left) === manifestIdentity(right);
}

export async function installedPackageExactlyMatchesArchive(packageRoot, archive) {
  const actualPaths = [];
  async function walk(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        if (!(await walk(absolute, relative))) return false;
      } else if (entry.isFile()) actualPaths.push(relative);
      else return false;
    }
    return true;
  }
  if (!(await walk(packageRoot))) return false;
  const expectedPaths = archive.fileManifest.map((entry) => entry.path).sort();
  actualPaths.sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) return false;
  for (const entry of archive.fileManifest) {
    const absolute = path.join(packageRoot, ...entry.path.split("/"));
    try {
      const metadata = await lstat(absolute);
      if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
      const bytes = await readFile(absolute);
      if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Read a candidate archive once, bind those bytes, and create the only snapshot
 * later installation/copy steps are permitted to consume. `flag: "wx"` prevents
 * an earlier file from being silently replaced.
 */
export async function createImmutablePackageSnapshot(sourceFile, destinationFile, options = {}) {
  const source = path.resolve(sourceFile);
  const destination = path.resolve(destinationFile);
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("candidate package must be one regular non-symbolic-link file");
  }
  const bytes = await readFile(source);
  const sourceSha256 = sha256(bytes);
  if (options.expectedTarballSha256 && sourceSha256 !== options.expectedTarballSha256) {
    throw new Error("candidate package bytes do not match the expected SHA-256");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: "wx", mode: 0o444 });
  const snapshotBytes = await readFile(destination);
  if (!snapshotBytes.equals(bytes)) throw new Error("immutable package snapshot changed while being written");

  const [sourceArchive, snapshotArchive] = await Promise.all([
    inspectNpmPackageArchiveFile(source, {
      ...(options.expectedName ? { expectedName: options.expectedName } : {}),
      expectedTarballSha256: sourceSha256,
    }),
    inspectNpmPackageArchiveFile(destination, {
      ...(options.expectedName ? { expectedName: options.expectedName } : {}),
      expectedTarballSha256: sourceSha256,
    }),
  ]);
  if (!packageArchivesMatch(sourceArchive, snapshotArchive)) {
    throw new Error("immutable package snapshot manifest differs from the inspected source archive");
  }
  return Object.freeze({
    archive: snapshotArchive,
    destination,
    source,
    sourceArchive,
    tarballSha256: sourceSha256,
  });
}
