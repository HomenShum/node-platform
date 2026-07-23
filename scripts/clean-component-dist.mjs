import { rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
for (const relativePath of ["dist/client", "dist/component", "dist/lib", "dist/convex-test.d.ts", "dist/convex-test.d.ts.map", "dist/convex-test.js", "dist/convex-test.js.map", "tsconfig.component.tsbuildinfo"]) {
  rmSync(resolve(root, relativePath), { force: true, recursive: true });
}
