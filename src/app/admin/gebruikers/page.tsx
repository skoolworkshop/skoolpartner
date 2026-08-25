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
import {
  approveMembershipAction,
  rejectMembershipAction,
  setUserBlockedAction,
} from "../actions";

export const metadata: Metadata = { title: "Gebruikers" };

interface PendingRow {
  id: string;
  created_at: string;
  source: string;
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
                      {user.is_super_admin ? (
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
                        <ActionForm
                          action={setUserBlockedAction}
                          submitLabel={user.is_blocked ? "Deblokkeren" : "Blokkeren"}
                          variant="secondary"
                          inline
                        >
                          <input type="hidden" name="user_id" value={user.id} />
                          <input type="hidden" name="blocked" value={user.is_blocked ? "0" : "1"} />
                        </ActionForm>
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
