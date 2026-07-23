#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareExactConsumerPackage } from "../src/lib/consumer-package-preparation.mjs";

const scriptPath = fileURLToPath(import.meta.url);

const VALUE_OPTIONS = new Map([
  ["--archive", "archivePath"],
  ["--candidate", "candidateCommit"],
  ["--consumer-commit", "expectedConsumerCommit"],
  ["--consumer-package-json", "packageJsonPath"],
  ["--consumer-root", "consumerRoot"],
  ["--integrity", "expectedIntegrity"],
  ["--manifest-path", "manifestPath"],
  ["--nodekit-root", "nodekitRoot"],
  ["--package-name", "expectedName"],
  ["--package-version", "expectedVersion"],
  ["--source-hash", "sourceHash"],
  ["--tarball-sha256", "expectedTarballSha256"],
  ["--vendor-path", "vendorPath"],
]);
const REQUIRED = Object.freeze([
  "archivePath",
  "candidateCommit",
  "consumerRoot",
  "expectedIntegrity",
  "expectedName",
  "expectedTarballSha256",
  "expectedVersion",
  "nodekitRoot",
  "sourceHash",
]);

export function consumerPackagePreparationHelp() {
  return `Usage:
  nodekit-consumer-prepare \\
    --archive <nodekit.tgz> \\
    --nodekit-root <exact-nodekit-worktree> \\
    --consumer-root <clean-consumer-worktree> \\
    --candidate <40-char-commit> \\
    --source-hash <sha256> \\
    --package-name <npm-name> \\
    --package-version <semver> \\
    --tarball-sha256 <sha256> \\
    --integrity <sha512-SRI> [options]

Options:
  --apply                         Write the vendored archive and provenance manifest.
                                  Without this flag the command is a read-only dry-run.
  --update-dependency             Update one existing package.json dependency declaration.
                                  This never happens implicitly, including with --apply.
  --consumer-commit <commit>      Also require an exact consumer base commit.
  --consumer-package-json <path>  Default: package.json
  --vendor-path <path>            Default: vendor/nodekit.tgz
  --manifest-path <path>          Default: nodekit.consumer-package.json
  --help                          Show this help.

This command never deploys, commits, signs, or claims authenticated Convex adoption.`;
}

export function parseConsumerPackagePreparationArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true };
    if (argument === "--apply" || argument === "--update-dependency") {
      const key = argument === "--apply" ? "apply" : "updateDependency";
      if (options[key] !== undefined) throw new Error(`${argument} cannot be repeated`);
      options[key] = true;
      continue;
    }
    const key = VALUE_OPTIONS.get(argument);
    if (!key) throw new Error(`unknown argument: ${argument}`);
    if (options[key] !== undefined) throw new Error(`${argument} cannot be repeated`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[key] = value;
    index += 1;
  }
  const missing = REQUIRED.filter((key) => options[key] === undefined);
  if (missing.length > 0) throw new Error(`missing required arguments: ${missing.join(", ")}`);
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath);
if (isMain) {
  try {
    const options = parseConsumerPackagePreparationArguments(process.argv.slice(2));
    if (options.help) {
      console.log(consumerPackagePreparationHelp());
    } else {
      const result = await prepareExactConsumerPackage(options);
      console.log(JSON.stringify(result, null, 2));
      console.error(result.applied
        ? "NODEKIT CONSUMER PACKAGE PREPARED (NOT AUTHENTICATED ADOPTION)"
        : "NODEKIT CONSUMER PACKAGE DRY RUN (NO WRITES)");
    }
  } catch (error) {
    console.error(`NODEKIT CONSUMER PACKAGE PREPARATION FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
