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
  setUserRoleAction,
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
                      <Field label="Rol" htmlFor={`role-${row.id}`} className="w-40">
                        <Select id={`role-${row.id}`} name="role" defaultValue="lid">
                          <option value="lid">Lid</option>
                          <option value="beheerder">Beheerder</option>
                        </Select>
                      </Field>
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

        <Card>
          <CardHeader
            title="Alle gebruikers"
            description="Blokkeren is omkeerbaar. Definitief verwijderen niet: het account en het lidmaatschap verdwijnen uit de database. Boekingen, facturen en SkoolPoints blijven staan, want die horen bij de organisatie."
            action={
              <form className="flex gap-2">
                <label htmlFor="q" className="sr-only">
                  Zoek op e-mailadres
                </label>
                <Input id="q" name="q" defaultValue={q ?? ""} placeholder="Zoek op e-mail" />
              </form>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-2xl text-left text-sm">
              <thead className="border-b border-line-soft text-muted">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-semibold">E-mail</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Naam</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Rechten</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Sinds</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Actie</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-5 py-2.5">{user.email}</td>
                    <td className="px-5 py-2.5">{user.full_name ?? "—"}</td>
                    <td className="px-5 py-2.5">
                      {session.profile?.is_super_admin && user.id !== session.userId ? (
                        <ActionForm
                          action={setUserRoleAction}
                          submitLabel="Opslaan"
                          variant="secondary"
                          inline
                        >
                          <input type="hidden" name="user_id" value={user.id} />
                          <Field label="Rol" htmlFor={`rol-${user.id}`} className="w-44">
                            <Select
                              id={`rol-${user.id}`}
                              name="rol"
                              defaultValue={
                                user.is_super_admin
                                  ? "hoofdbeheerder"
                                  : user.is_admin
                                    ? "beheerder"
                                    : "klant"
                              }
                            >
                              <option value="klant">Klant</option>
                              <option value="beheerder">Beheerder</option>
                              <option value="hoofdbeheerder">Hoofdbeheerder</option>
                            </Select>
                          </Field>
                        </ActionForm>
                      ) : user.is_super_admin ? (
                        <Badge tone="accent">Hoofdbeheerder</Badge>
                      ) : user.is_admin ? (
                        <Badge tone="info">Beheerder</Badge>
                      ) : (
                        <Badge>Klant</Badge>
                      )}
                      {user.is_blocked ? <Badge tone="danger" className="ml-1">Geblokkeerd</Badge> : null}
                    </td>
                    <td className="px-5 py-2.5 text-muted">{formatShortDate(user.created_at)}</td>
                    <td className="px-5 py-2.5">
                      {session.profile?.is_super_admin && user.id !== session.userId ? (
                        <div className="flex flex-wrap items-end gap-3">
                          <ActionForm
                            action={setUserBlockedAction}
                            submitLabel={user.is_blocked ? "Deblokkeren" : "Blokkeren"}
                            variant="secondary"
                            inline
                          >
                            <input type="hidden" name="user_id" value={user.id} />
                            <input
                              type="hidden"
                              name="blocked"
                              value={user.is_blocked ? "0" : "1"}
                            />
                          </ActionForm>

                          {user.is_super_admin ? null : (
                            <ActionForm
                              action={deleteUserAction}
                              submitLabel="Definitief verwijderen"
                              variant="danger"
                              inline
                            >
                              <input type="hidden" name="user_id" value={user.id} />
                              <input type="hidden" name="verwacht" value={user.email} />
                              <Field
                                label="Bevestig met het e-mailadres"
                                htmlFor={`bevestig-${user.id}`}
                                className="min-w-64"
                              >
                                <Input
                                  id={`bevestig-${user.id}`}
                                  name="bevestiging"
                                  autoComplete="off"
                                  placeholder={user.email}
                                />
                              </Field>
                            </ActionForm>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
