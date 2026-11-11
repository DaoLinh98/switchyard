import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Root folder for all local state. Override with SWITCHYARD_HOME (used by tests). */
export function dataDir(): string {
  const dir = process.env.SWITCHYARD_HOME ?? path.join(os.homedir(), ".switchyard");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
