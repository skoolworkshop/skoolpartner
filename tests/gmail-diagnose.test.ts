import { describe, expect, it } from "vitest";

import { rolUitSupabaseSleutel } from "@/lib/integrations/gmail/diagnose";

/**
 * De rol uit een Supabase-sleutel lezen.
 *
 * Dit is het verschil tussen "alles werkt" en "permission denied for table
 * invoices". Wij lezen alleen het rolveld; de handtekening blijft geheim.
 */
function nepJwt(rol: string): string {
  const kop = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const inhoud = Buffer.from(JSON.stringify({ iss: "supabase", role: rol })).toString("base64url");
  return `${kop}.${inhoud}.handtekening-die-wij-nooit-lezen`;
}

describe("welke Supabase-sleutel staat er ingesteld", () => {
  it("herkent de service role key", () => {
    expect(rolUitSupabaseSleutel(nepJwt("service_role"))).toBe("service_role");
  });

  it("herkent de anon key, de klassieke verwisseling", () => {
    expect(rolUitSupabaseSleutel(nepJwt("anon"))).toBe("anon");
  });

  it("herkent de nieuwe sleutelvormen aan hun voorvoegsel", () => {
    expect(rolUitSupabaseSleutel("sb_secret_abc123")).toBe("secret (nieuw formaat)");
    expect(rolUitSupabaseSleutel("sb_publishable_abc123")).toBe("publishable (nieuw formaat)");
  });

  it("geeft null bij iets dat geen sleutel is", () => {
    expect(rolUitSupabaseSleutel(null)).toBeNull();
    expect(rolUitSupabaseSleutel("")).toBeNull();
    expect(rolUitSupabaseSleutel("zomaar-een-tekst")).toBeNull();
    expect(rolUitSupabaseSleutel("een.twee.drie")).toBeNull();
  });
});

describe("de lengte van APP_ENCRYPTION_KEY", () => {
  /**
   * De sleutel moet precies 32 bytes zijn. Dit legt vast wat wel en niet
   * werkt, want dit is een veelgemaakte vergissing: een zelfverzonnen
   * wachtwoord ziet er prima uit maar heeft nooit de juiste lengte.
   */
  it("rekent een geldige sleutel af op 32 bytes", () => {
    const goed = Buffer.alloc(32, 7).toString("base64");
    expect(Buffer.from(goed, "base64").length).toBe(32);
    expect(goed).toHaveLength(44);
    expect(goed.endsWith("=")).toBe(true);
  });

  it("wijst een zelfverzonnen wachtwoord af", () => {
    expect(Buffer.from("mijn-geheime-wachtwoord", "base64").length).not.toBe(32);
  });
});
