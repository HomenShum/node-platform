import { spawn } from "node:child_process";
const child = spawn("npm", ["audit", "--omit=dev"], { shell: process.platform === "win32", stdio: "inherit" });
await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`npm audit exited ${code}`))); });
