import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.homedir(), ".switchyard", "switchyard.db");
const db = new DatabaseSync(dbPath);

let row = db.prepare("SELECT value FROM settings WHERE key = 'proxy_api_key'").get();

if (!row) {
  const newKey = "sk-" + crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO settings (key, value) VALUES ('proxy_api_key', ?)").run(newKey);
  console.log("CREATED NEW PROXY API KEY:", newKey);
} else {
  console.log("EXISTING PROXY API KEY:", row.value);
}
