import type { Metadata } from "next";
import { UserCheck } from "lucide-react";

import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { listPendingMembers, listUsers } from "@/lib/admin/queries";
import { formatShortDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { RegistrationDetails } from "@/lib/types/database";
import {
  approveMembershipAction,
  deleteUserAction,
  rejectMembershipAction,
  setUserBlockedAction,
  updateUserIdentityAction,
  setUserRoleAction,
  startCustomerPreviewAction,
} from "../actions";

export const metadata: Metadata = { title: "Gebruikers" };

interface PendingRow {
  id: string;
  created_at: string;
  source: string;
  requested_details: RegistrationDetails | null;
  profiles: { email: string; full_name: string | null } | null;
  organizations: { name: string } | null;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireAdmin();
  const { q } = await searchParams;

  const [pending, users] = await Promise.all([listPendingMembers(), listUsers(q)]);
  const pendingRows = pending as unknown as PendingRow[];

  return (
    <>
      <h1 className="mb-6 text-[30px]">Gebruikers</h1>

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Wachten op goedkeuring"
            description="Een gebruiker krijgt pas toegang tot de gegevens van een organisatie nadat u de koppeling heeft goedgekeurd."
          />
          {pendingRows.length > 0 ? (
            <ul className="divide-y divide-line-soft">
              {pendingRows.map((row) => (
                <li key={row.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {row.profiles?.full_name ?? row.profiles?.email ?? "Onbekend"}
                      </p>
                      <p className="text-sm text-muted">
                        {row.profiles?.email} · wil bij{" "}
                        <strong className="text-ink">{row.organizations?.name}</strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={row.source === "domain_match" ? "info" : "neutral"}>
                        {row.source === "domain_match"
                          ? "Domeinsuggestie"
                          : row.source === "invite"
                            ? "Uitnodiging"
                            : "Zelf aangevraagd"}
                      </Badge>
                      <span className="text-sm text-muted">{formatShortDate(row.created_at)}</span>
                    </div>
                  </div>

                  {row.requested_details ? (
                    <div className="rounded-card border border-line-soft bg-surface-1 px-4 py-3 text-sm">
                      <p className="mb-1 font-semibold">Ingevuld bij registratie</p>
                      <p className="text-muted">
                        {[
                          row.requested_details.job_title,
                          row.requested_details.phone
                            ? formatPhone(row.requested_details.phone)
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="text-muted">
                        {[
                          [
                            row.requested_details.street,
                            row.requested_details.house_number,
                            row.requested_details.house_number_addition,
                          ]
                            .filter(Boolean)
                            .join(" "),
                          [row.requested_details.postal_code, row.requested_details.city]
                            .filter(Boolean)
                            .join(" "),
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                      <p className="mt-1.5 text-muted">
                        Deze gegevens vullen bij goedkeuren alleen lege velden van de organisatie
                        aan. Wat er al stond, blijft staan.
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-4">
                    <ActionForm action={approveMembershipAction} submitLabel="Goedkeuren" inline>
                      <input type="hidden" name="member_id" value={row.id} />
                    </ActionForm>

                    <ActionForm
                      action={rejectMembershipAction}
                      submitLabel="Afwijzen"
                      variant="secondary"
                      inline
                    >
                      <input type="hidden" name="member_id" value={row.id} />
                      <Field label="Reden" htmlFor={`reject-${row.id}`} className="min-w-56">
                        <Input id={`reject-${row.id}`} name="reason" placeholder="Optioneel" />
                      </Field>
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={UserCheck}
              title="Geen openstaande aanvragen"
              description="Nieuwe registraties verschijnen hier automatisch."
            />
          )}
        </Card>

        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-[24px]">Alle gebruikers</h2>
              <p className="text-sm text-muted">{users.length} accounts gevonden. Open Beheren om naam, e-mail en rechten aan te passen.</p>
            </div>
            <form className="w-full sm:w-72">
              <label htmlFor="q" className="sr-only">Zoek op naam of e-mailadres</label>
              <Input id="q" name="q" defaultValue={q ?? ""} placeholder="Zoek gebruiker" />
            </form>
          </div>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {users.map((user) => {
              const nameParts = (user.full_name ?? "").trim().split(/\s+/).filter(Boolean);
              const firstName = user.first_name ?? nameParts[0] ?? "";
              const lastName = user.last_name ?? nameParts.slice(1).join(" ");
              return (
              <Card key={user.id} className="overflow-hidden">
                <div className="space-y-4 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words font-semibold">{user.full_name ?? "Naam niet ingevuld"}</p>
                    <p className="break-all text-sm text-muted">{user.email}</p>
                    <p className="mt-1 text-xs text-muted">Sinds {formatShortDate(user.created_at)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={user.is_admin ? "info" : "neutral"}>{user.is_admin ? "Beheerder" : "Klant"}</Badge>
                    {user.is_blocked ? <Badge tone="danger">Geblokkeerd</Badge> : null}
                  </div>
                </div>

                {!user.is_admin && !user.is_blocked ? (
                  <ActionForm action={startCustomerPreviewAction} submitLabel="Ga naar klantportaal" variant="ink">
                    <input type="hidden" name="user_id" value={user.id} />
                  </ActionForm>
                ) : null}

                <details className="group border-t border-line-soft pt-4">
                  <summary className="cursor-pointer list-none font-semibold text-ink underline underline-offset-4">Account beheren</summary>
                  <div className="mt-4 space-y-4">
                    <ActionForm action={updateUserIdentityAction} submitLabel="Naam en e-mail opslaan" variant="secondary">
                      <input type="hidden" name="user_id" value={user.id} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Voornaam" htmlFor={`voornaam-${user.id}`}><Input id={`voornaam-${user.id}`} name="first_name" defaultValue={firstName} required /></Field>
                        <Field label="Achternaam" htmlFor={`achternaam-${user.id}`}><Input id={`achternaam-${user.id}`} name="last_name" defaultValue={lastName} required /></Field>
                      </div>
                      <Field label="E-mailadres" htmlFor={`email-${user.id}`}><Input id={`email-${user.id}`} name="email" type="email" defaultValue={user.email} required /></Field>
                    </ActionForm>

                  {user.id !== session.userId ? (
                  <div className="grid gap-4 border-t border-line-soft pt-4 sm:grid-cols-2">
                    <ActionForm action={setUserRoleAction} submitLabel="Rol opslaan" variant="secondary">
                      <input type="hidden" name="user_id" value={user.id} />
                      <Field label="Rol" htmlFor={`rol-${user.id}`}>
                        <Select id={`rol-${user.id}`} name="rol" defaultValue={user.is_admin ? "beheerder" : "klant"}>
                          <option value="klant">Klant</option>
                          <option value="beheerder">Beheerder</option>
                        </Select>
                      </Field>
                    </ActionForm>

                    <div className="space-y-3">
                      <ActionForm action={setUserBlockedAction} submitLabel={user.is_blocked ? "Deblokkeren" : "Blokkeren"} variant="secondary">
                        <input type="hidden" name="user_id" value={user.id} />
                        <input type="hidden" name="blocked" value={user.is_blocked ? "0" : "1"} />
                      </ActionForm>
                      <ActionForm action={deleteUserAction} submitLabel="Definitief verwijderen" variant="danger">
                        <input type="hidden" name="user_id" value={user.id} />
                        <input type="hidden" name="verwacht" value={user.email} />
                        <Field label="Bevestig met het e-mailadres" htmlFor={`bevestig-${user.id}`}>
                          <Input id={`bevestig-${user.id}`} name="bevestiging" autoComplete="off" placeholder={user.email} />
                        </Field>
                      </ActionForm>
                    </div>
                  </div>
                  ) : <p className="text-sm text-muted">Dit is uw eigen beheeraccount; rol, blokkering en verwijdering zijn daarom vergrendeld.</p>}
                  </div>
                </details>
                </div>
              </Card>
            );})}
            {users.length === 0 ? <Card><p className="px-4 py-8 text-center text-muted">Geen gebruikers gevonden.</p></Card> : null}
          </div>
        </section>
      </div>
    </>
  );
}
