import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.homedir(), ".switchyard", "switchyard.db");
const db = new DatabaseSync(dbPath);

const accounts = db.prepare("SELECT id, provider, label, meta FROM accounts").all();
console.log("ACCOUNTS IN DB:", JSON.stringify(accounts, null, 2));

const models = db.prepare("SELECT provider, id, label FROM models").all();
console.log("MODELS IN DB:", JSON.stringify(models, null, 2));
