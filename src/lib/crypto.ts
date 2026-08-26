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
/**
 * Controleert de Moneybird-Signature van een webhook.
 *
 * De header ziet eruit als "t=1748534400,v1=<hex>". Moneybird tekent de string
 * "<t>.<ruwe body>" met HMAC-SHA256 en het secret van die webhook. De body moet
 * daarbij byte voor byte zijn zoals hij binnenkwam: opnieuw omzetten naar JSON
 * verandert de inhoud en dan klopt de handtekening niet meer.
 *
 * Een handtekening ouder dan vijf minuten wijzen wij af, zodat een onderschept
 * verzoek niet later opnieuw gebruikt kan worden.
 */
export function verifyMoneybirdSignature(params: {
  header: string | null;
  rawBody: string;
  secret: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean {
  if (!params.header) return false;

  const onderdelen = new Map<string, string[]>();
  for (const deel of params.header.split(",")) {
    const [sleutel, waarde] = deel.trim().split("=");
    if (!sleutel || !waarde) continue;
    onderdelen.set(sleutel, [...(onderdelen.get(sleutel) ?? []), waarde]);
  }

  const tijdstempel = onderdelen.get("t")?.[0];
  const handtekeningen = onderdelen.get("v1") ?? [];
  if (!tijdstempel || handtekeningen.length === 0) return false;

  const t = Number.parseInt(tijdstempel, 10);
  if (!Number.isFinite(t)) return false;

  const nu = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const marge = params.toleranceSeconds ?? 300;
  if (Math.abs(nu - t) > marge) return false;

  const verwacht = crypto
    .createHmac("sha256", params.secret)
    .update(`${t}.${params.rawBody}`)
    .digest("hex");

  return handtekeningen.some((waarde) => safeEqual(verwacht, waarde));
}

export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
