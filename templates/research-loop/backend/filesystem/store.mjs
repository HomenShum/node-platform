import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function createFileStore(file = path.resolve(".data", "session.json")) {
  return {
    file,
    async load() {
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async save(value) {
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await rename(temporary, file);
      return value;
    },
  };
}
