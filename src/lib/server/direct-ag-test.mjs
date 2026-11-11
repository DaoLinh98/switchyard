import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.join(os.homedir(), ".switchyard");
const db = new DatabaseSync(path.join(dir, "switchyard.db"));
const keyFile = path.join(dir, "master.key");
const masterKey = Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "base64");

function unseal(sealed) {
  const [version, iv, tag, ct] = sealed.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]);
  return JSON.parse(pt.toString("utf8"));
}

async function run() {
  const row = db.prepare("SELECT token_sealed FROM accounts WHERE id = '38051849-cae6-41cb-b616-a80861d473e1'").get();
  const token = unseal(row.token_sealed);
  const access = token.access;
  const project = "aicode-consumers";

  const candidates = [
    "claude-sonnet-5-5-high",
    "gemini-2.5-flash",
    "gemini-3-flash",
    "gemini-3.8-flash-tiered"
  ];

  for (const m of candidates) {
    const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:generateContent", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "User-Agent": "antigravity/1.0 (switchyard)",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        project,
        model: m,
        request: {
          contents: [{ role: "user", parts: [{ text: "hi" }] }]
        }
      })
    });
    console.log(`Model: ${m} -> Status: ${res.status}`);
    const text = await res.text();
    console.log(`Response: ${text.slice(0, 200)}\n`);
  }
}

run().catch(console.error);
