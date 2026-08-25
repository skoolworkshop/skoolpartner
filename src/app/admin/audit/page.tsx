import type { Metadata } from "next";

import { Card, CardHeader } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { listAuditLogs } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/format";
import type { AuditLogRow } from "@/lib/types/database";

export const metadata: Metadata = { title: "Audit log" };

export default async function AdminAuditPage() {
  await requireAdmin();
  const logs = (await listAuditLogs()) as AuditLogRow[];

  return (
    <>
      <h1 className="mb-2 text-[30px]">Audit log</h1>
      <p className="mb-6 max-w-3xl text-[15px] text-muted">
        Alle belangrijke handelingen worden hier vastgelegd: puntencorrecties, goedgekeurde
        boekingen, gewijzigde instellingen en koppelingen van gebruikers aan organisaties.
      </p>

      <Card>
        <CardHeader title={`Laatste ${logs.length} handelingen`} />
        <ul className="divide-y divide-line-soft">
          {logs.map((log) => (
            <li key={log.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{log.action}</p>
                <p className="text-sm text-muted">{formatDateTime(log.created_at)}</p>
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {log.actor_email ?? "systeem"} · {log.entity_type}
                {log.entity_id ? ` ${log.entity_id}` : ""}
              </p>
              {log.reason ? (
                <p className="mt-1 text-sm text-muted">Reden: {log.reason}</p>
              ) : null}
              {log.before_state || log.after_state ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-muted">Details</summary>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold text-muted">Oud</p>
                      <pre className="mt-1 overflow-auto rounded bg-surface-2 p-2 text-xs">
                        {JSON.stringify(log.before_state, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted">Nieuw</p>
                      <pre className="mt-1 overflow-auto rounded bg-surface-2 p-2 text-xs">
                        {JSON.stringify(log.after_state, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ) : null}
            </li>
          ))}
          {logs.length === 0 ? (
            <li className="px-5 py-10 text-center text-muted">Nog geen handelingen vastgelegd.</li>
          ) : null}
        </ul>
      </Card>
    </>
  );
}
