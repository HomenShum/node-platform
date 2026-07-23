/**
 * Return the repository pathspecs whose bytes define the npm distribution.
 * Keeping this in one place prevents proof and provider-conformance runners
 * from silently disagreeing about whether a dirty file belongs to a candidate.
 */
export function distributablePathspecs(packageJson) {
  return ["package.json", ...(packageJson?.files ?? [])]
    .map((entry) => String(entry).replace(/^\.\//, ""))
    .filter(Boolean);
}

/** Parse `git status --porcelain=v1 -z`, including both paths for renames. */
export function parseGitStatusPorcelainZ(output) {
  const tokens = output.toString("utf8").split("\0").filter((token) => token.length > 0);
  const paths = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index];
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("git status returned an invalid porcelain v1 -z record");
    }
    const status = record.slice(0, 2);
    paths.push(record.slice(3).replaceAll("\\", "/"));
    if (/[RC]/.test(status)) {
      const originalPath = tokens[index + 1];
      if (originalPath === undefined) {
        throw new Error("git status returned an incomplete rename/copy record");
      }
      paths.push(originalPath.replaceAll("\\", "/"));
      index += 1;
    }
  }
  return paths;
}

export function assertCleanDistributablePaths(dirtyPaths, context = "candidate") {
  if (dirtyPaths.length > 0) {
    throw new Error(`${context} requires a clean distributable candidate; dirty paths: ${dirtyPaths.join(", ")}`);
  }
}
