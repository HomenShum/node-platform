import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createImmutablePackageSnapshot, installedPackageExactlyMatchesArchive } from "../src/lib/immutable-package-snapshot.mjs";
import { resolveTarCommand } from "../src/lib/npm-cli-invocation.mjs";

async function pack(root, name, marker) {
  const packageRoot = path.join(root, marker);
  await writeFile(path.join(root, `${marker}.placeholder`), "").catch(() => undefined);
  execFileSync(process.execPath, ["-e", `
    const fs=require('fs'); const p=${JSON.stringify(packageRoot)};
    fs.mkdirSync(p,{recursive:true});
    fs.writeFileSync(p+'/package.json', JSON.stringify({name:${JSON.stringify(name)},version:'1.0.0'}));
    fs.writeFileSync(p+'/marker.txt', ${JSON.stringify(marker)});
  `]);
  return execFileSync("npm", ["pack", "--silent"], { cwd: packageRoot, encoding: "utf8", shell: process.platform === "win32" }).trim();
}

test("immutable package snapshot keeps inspected bytes when the mutable source is swapped", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-snapshot-test-"));
  const firstName = await pack(root, "@example/candidate", "first");
  const secondName = await pack(root, "@example/candidate", "second");
  const source = path.join(root, "candidate.tgz");
  await writeFile(source, await readFile(path.join(root, "first", firstName)));
  const snapshot = await createImmutablePackageSnapshot(source, path.join(root, "bound", "candidate.tgz"), {
    expectedName: "@example/candidate",
  });
  await writeFile(source, await readFile(path.join(root, "second", secondName)));
  assert.notDeepEqual(await readFile(source), await readFile(snapshot.destination));
  assert.equal((await readFile(snapshot.destination)).toString("base64"), (await readFile(path.join(root, "first", firstName))).toString("base64"));
});

test("installed package binding rejects files that were not in the packed manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-installed-manifest-test-"));
  const packedName = await pack(root, "@example/candidate", "exact");
  const source = path.join(root, "exact", packedName);
  const snapshot = await createImmutablePackageSnapshot(source, path.join(root, "bound", "candidate.tgz"), {
    expectedName: "@example/candidate",
  });
  const extracted = path.join(root, "extracted");
  await mkdir(extracted, { recursive: true });
  execFileSync(resolveTarCommand(), ["-xzf", snapshot.destination, "-C", extracted]);
  const packageRoot = path.join(extracted, "package");
  assert.equal(await installedPackageExactlyMatchesArchive(packageRoot, snapshot.archive), true);
  await writeFile(path.join(packageRoot, "injected.txt"), "not packed\n");
  assert.equal(await installedPackageExactlyMatchesArchive(packageRoot, snapshot.archive), false);
});
