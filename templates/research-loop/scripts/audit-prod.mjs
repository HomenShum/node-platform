import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const friction = JSON.parse(await readFile(path.resolve("proof", "build-friction.json"), "utf8"));
const packageManager = friction.packageManager ?? "npm";
if (!new Set(["npm", "pnpm"]).has(packageManager)) {
  throw new Error(`unsupported package manager in build-friction receipt: ${packageManager}`);
}
const args = packageManager === "pnpm" ? ["audit", "--prod"] : ["audit", "--omit=dev"];

await new Promise((resolve, reject) => {
  const child = spawn(packageManager, args, {
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("exit", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${packageManager} ${args.join(" ")} exited ${code}`));
  });
});
