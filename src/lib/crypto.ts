import crypto from "node:crypto";

import { serverEnv } from "@/lib/env";

/**
 * AES-256-GCM versleuteling voor gevoelige tokens (o.a. de Gmail refresh token).
 * De sleutel komt uit APP_ENCRYPTION_KEY: 32 willekeurige bytes, base64.
 *
 *   openssl rand -base64 32
 */

function getKey(): Buffer {
  const raw = serverEnv.appEncryptionKey;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY ontbreekt. Genereer er een met: openssl rand -base64 32"
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY moet exact 32 bytes zijn (base64 van 32 random bytes)");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Onbekend formaat voor versleutelde waarde");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Hash voor uitnodigingstokens: de leesbare token bewaren we nooit. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Timing-safe vergelijking voor webhook- en cron-secrets. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
