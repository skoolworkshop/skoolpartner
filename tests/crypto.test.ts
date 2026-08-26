import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

describe("versleuteling van integratietokens", () => {
  let encryptSecret: (value: string) => string;
  let decryptSecret: (value: string) => string;
  let hashToken: (value: string) => string;
  let safeEqual: (a: string | null, b: string | null) => boolean;

  beforeAll(async () => {
    process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    const mod = await import("@/lib/crypto");
    encryptSecret = mod.encryptSecret;
    decryptSecret = mod.decryptSecret;
    hashToken = mod.hashToken;
    safeEqual = mod.safeEqual;
  });

  it("versleutelt en ontsleutelt een refresh token", () => {
    const secret = "1//0abcdefghijklmnop-refresh-token";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("levert elke keer een andere versleutelde waarde op", () => {
    expect(encryptSecret("zelfde waarde")).not.toBe(encryptSecret("zelfde waarde"));
  });

  it("weigert geknoeide waarden", () => {
    const encrypted = encryptSecret("gevoelig");
    const parts = encrypted.split(":");
    parts[3] = Buffer.from("aangepast").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("bewaart uitnodigingstokens alleen als hash", () => {
    const token = "abc123";
    const hash = hashToken(token);
    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(64);
    expect(hashToken(token)).toBe(hash);
  });

  it("vergelijkt secrets zonder timingverschil en zonder crash", () => {
    expect(safeEqual("geheim", "geheim")).toBe(true);
    expect(safeEqual("geheim", "anders")).toBe(false);
    expect(safeEqual("kort", "veel langer")).toBe(false);
    expect(safeEqual(null, "geheim")).toBe(false);
    expect(safeEqual("geheim", null)).toBe(false);
  });
});

describe("Moneybird-webhookhandtekening", () => {
  let verifyMoneybirdSignature: (params: {
    header: string | null;
    rawBody: string;
    secret: string;
    nowSeconds?: number;
  }) => boolean;

  beforeAll(async () => {
    process.env.APP_ENCRYPTION_KEY =
      process.env.APP_ENCRYPTION_KEY ?? crypto.randomBytes(32).toString("base64");
    verifyMoneybirdSignature = (await import("@/lib/crypto")).verifyMoneybirdSignature;
  });

  const secret = "geheim-van-de-webhook";
  const body = '{"entity_type":"SalesInvoice","entity_id":"123"}';
  const t = 1_800_000_000;

  function tekenen(tijd: number, inhoud: string, sleutel = secret) {
    return crypto.createHmac("sha256", sleutel).update(`${tijd}.${inhoud}`).digest("hex");
  }

  it("accepteert een kloppende handtekening", () => {
    expect(
      verifyMoneybirdSignature({
        header: `t=${t},v1=${tekenen(t, body)}`,
        rawBody: body,
        secret,
        nowSeconds: t + 10,
      })
    ).toBe(true);
  });

  it("weigert een aangepaste inhoud", () => {
    expect(
      verifyMoneybirdSignature({
        header: `t=${t},v1=${tekenen(t, body)}`,
        rawBody: '{"entity_type":"SalesInvoice","entity_id":"999"}',
        secret,
        nowSeconds: t + 10,
      })
    ).toBe(false);
  });

  it("weigert een verkeerd secret", () => {
    expect(
      verifyMoneybirdSignature({
        header: `t=${t},v1=${tekenen(t, body, "iets anders")}`,
        rawBody: body,
        secret,
        nowSeconds: t + 10,
      })
    ).toBe(false);
  });

  it("weigert een oude handtekening, zodat hergebruik niet werkt", () => {
    expect(
      verifyMoneybirdSignature({
        header: `t=${t},v1=${tekenen(t, body)}`,
        rawBody: body,
        secret,
        nowSeconds: t + 3600,
      })
    ).toBe(false);
  });

  it("weigert een ontbrekende of onzinnige header", () => {
    expect(verifyMoneybirdSignature({ header: null, rawBody: body, secret })).toBe(false);
    expect(verifyMoneybirdSignature({ header: "onzin", rawBody: body, secret })).toBe(false);
    expect(
      verifyMoneybirdSignature({ header: `t=${t}`, rawBody: body, secret, nowSeconds: t })
    ).toBe(false);
  });

  it("accepteert als één van meerdere handtekeningen klopt", () => {
    expect(
      verifyMoneybirdSignature({
        header: `t=${t},v1=${tekenen(t, body, "oud")},v1=${tekenen(t, body)}`,
        rawBody: body,
        secret,
        nowSeconds: t + 10,
      })
    ).toBe(true);
  });
});
