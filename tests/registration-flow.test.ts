import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  completeRegistration: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  cookieSet: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  after: vi.fn(),
  fetchOrganizationLogo: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mocks.cookieSet })),
}));
vi.mock("next/navigation", () => ({
  RedirectType: { replace: "replace", push: "push" },
  redirect: mocks.redirect,
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/auth/session", () => ({
  ACTIVE_ORGANIZATION_COOKIE: "mijnskool.org",
  requireUser: mocks.requireUser,
}));
vi.mock("@/lib/organizations/registration", () => ({
  completeRegistration: mocks.completeRegistration,
}));
vi.mock("@/lib/organizations/address-lookup", () => ({
  lookupOrganizationAddress: vi.fn(),
}));
vi.mock("@/lib/organizations/logo", () => ({
  fetchOrganizationLogo: mocks.fetchOrganizationLogo,
}));
vi.mock("@/lib/organizations/service", () => ({
  searchOrganizations: vi.fn(),
  suggestOrganizationsForEmail: vi.fn(async () => []),
}));
vi.mock("@/lib/env", () => ({ hasServiceRole: vi.fn(() => true) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: mocks.getUser, updateUser: mocks.updateUser },
  })),
}));
vi.mock("@/lib/registration", () => ({
  validateRegistration: vi.fn(() => ({
    ok: true,
    errors: {},
    values: {
      firstName: "Sanne",
      lastName: "de Vries",
      fullName: "Sanne de Vries",
      jobTitle: "Cultuurcoördinator",
      phone: "0612345678",
      organizationName: "Tests school",
      street: "Markt",
      houseNumber: "1",
      houseNumberAddition: null,
      postalCode: "2801AB",
      city: "Gouda",
      hasCjp: "nee",
      cjpSchoolNumber: null,
    },
  })),
}));

import { completeRegistrationAction } from "@/app/(auth)/aanmelden/actions";
import JoinPage from "@/app/(auth)/aanmelden/page";

function validFormData() {
  const data = new FormData();
  data.set("first_name", "Sanne");
  data.set("last_name", "de Vries");
  data.set("job_title", "Cultuurcoördinator");
  data.set("phone", "0612345678");
  data.set("organization_name", "Tests school");
  data.set("street", "Markt");
  data.set("house_number", "1");
  data.set("postal_code", "2801 AB");
  data.set("city", "Gouda");
  data.set("has_cjp", "nee");
  return data;
}

describe("registratie afronden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "sanne@tests-school.nl",
      isAdmin: false,
    });
    mocks.completeRegistration.mockResolvedValue({
      ok: true,
      state: "active",
      organizationId: "00000000-0000-4000-8000-000000000002",
    });
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "00000000-0000-4000-8000-000000000001",
          user_metadata: { full_name: "Sanne de Vries" },
        },
      },
      error: null,
    });
    mocks.updateUser.mockResolvedValue({
      data: {
        user: {
          id: "00000000-0000-4000-8000-000000000001",
          user_metadata: { full_name: "Sanne de Vries", onboarding_completed: true },
        },
      },
      error: null,
    });
    mocks.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("bevestigt Auth, wist oude routecache en vervangt onboarding door het dashboard", async () => {
    await expect(
      completeRegistrationAction({ status: "idle", errors: {} }, validFormData())
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.completeRegistration).toHaveBeenCalledOnce();
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.updateUser).toHaveBeenCalledWith({
      data: expect.objectContaining({ onboarding_completed: true }),
    });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "mijnskool.org",
      "00000000-0000-4000-8000-000000000002",
      expect.objectContaining({ httpOnly: true, path: "/" })
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/aanmelden");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard", "replace");
  });

  it("blijft met een duidelijke Nederlandse melding op het formulier als Auth niet klopt", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("sessie weg") });

    const result = await completeRegistrationAction(
      { status: "idle", errors: {} },
      validFormData()
    );

    expect(result.status).toBe("error");
    expect(result.message).toBe(
      "Het afronden van je registratie is niet gelukt. Probeer het opnieuw."
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("vervangt de registratiepagina door wachten als de organisatie nog gecontroleerd wordt", async () => {
    mocks.completeRegistration.mockResolvedValue({
      ok: true,
      state: "pending",
      organizationId: "00000000-0000-4000-8000-000000000002",
      organizationName: "Bestaande school",
    });

    await expect(
      completeRegistrationAction({ status: "idle", errors: {} }, validFormData())
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith("/wachten", "replace");
  });

  it("toont onboarding na refresh of opnieuw inloggen niet meer voor een actief lid", async () => {
    mocks.requireUser.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "sanne@tests-school.nl",
      profile: null,
      memberships: [{ organization: { id: "00000000-0000-4000-8000-000000000002" } }],
      pendingMemberships: [],
      isAdmin: false,
    });

    await expect(JoinPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
  });
});
