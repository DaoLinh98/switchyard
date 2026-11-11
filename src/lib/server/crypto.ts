import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

const ALGO = "aes-256-gcm";
const VERSION = "v1";

let cachedKey: Buffer | null = null;

/** 32-byte master key stored next to the database, created on first use. */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const file = path.join(dataDir(), "master.key");
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
  }
  const key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  if (key.length !== 32) throw new Error(`master.key is corrupt (expected 32 bytes, got ${key.length})`);
  cachedKey = key;
  return key;
}

/** Encrypts a JSON-serialisable value into "v1:<iv>:<tag>:<ciphertext>" (base64 parts). */
export function seal(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function unseal<T>(sealed: string): T {
  const [version, iv, tag, ct] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || !ct) throw new Error("Unsupported sealed value format");
  const decipher = crypto.createDecipheriv(ALGO, masterKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

/** Test hook: forget the cached key so a new SWITCHYARD_HOME is picked up. */
export function resetKeyCache(): void {
  cachedKey = null;
}
