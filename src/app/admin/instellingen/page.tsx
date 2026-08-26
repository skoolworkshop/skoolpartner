import type { Metadata } from "next";

import { ActionForm } from "@/components/admin/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/form";
import { requireAdmin } from "@/lib/auth/session";
import { listSettings } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/format";
import { updateSettingAction } from "../actions";
import type { AppSettingRow } from "@/lib/types/database";

export const metadata: Metadata = { title: "Instellingen" };

const GROUP_LABELS: Record<string, string> = {
  programma: "Programma",
  verdienen: "Punten verdienen",
  waarde: "Waarde van punten",
  inwisselen: "Inwisselen",
  geldigheid: "Geldigheid",
  teksten: "Teksten",
  boekingen: "Boekingen en herkenning",
  berichten: "Berichten",
  contact: "Contact en chat",
  resultaten: "Resultaten van workshops",
  algemeen: "Overig",
};

function valueToInput(setting: AppSettingRow): string {
  const value = setting.value;
  if (Array.isArray(value)) return value.join("\n");
  if (typeof value === "string") return value;
  return String(value);
}

export default async function AdminSettingsPage() {
  await requireAdmin();
  const settings = (await listSettings()) as AppSettingRow[];

  const groups = settings.reduce<Record<string, AppSettingRow[]>>((acc, setting) => {
    (acc[setting.group_name] ??= []).push(setting);
    return acc;
  }, {});

  return (
    <>
      <h1 className="mb-2 text-[30px]">Instellingen</h1>
      <p className="mb-6 max-w-3xl text-[15px] text-muted">
        Alle bedrijfsregels van SkoolPartner staan hier. Een wijziging geldt alleen voor nieuwe
        transacties: bestaande punten behouden de waarde die gold op het moment van toekennen, dus
        de historie blijft kloppen.
      </p>

      {settings.length === 0 ? (
        <Alert tone="warning" title="Nog geen instellingen gevonden">
          Draai eerst de databasemigraties, inclusief de seed met startinstellingen.
        </Alert>
      ) : null}

      <div className="space-y-5">
        {Object.entries(groups).map(([group, items]) => (
          <Card key={group}>
            <CardHeader title={GROUP_LABELS[group] ?? group} />
            <CardBody className="divide-y divide-line-soft">
              {items.map((setting) => (
                <div key={setting.key} className="py-5 first:pt-0 last:pb-0">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                    <div>
                      <p className="font-semibold">{setting.label}</p>
                      {setting.description ? (
                        <p className="mt-1 text-sm text-muted">{setting.description}</p>
                      ) : null}
                      <p className="mt-2 font-mono text-xs text-muted-soft">{setting.key}</p>
                      {setting.updated_at ? (
                        <p className="mt-1 text-xs text-muted-soft">
                          Laatst gewijzigd {formatDateTime(setting.updated_at)}
                        </p>
                      ) : null}
                    </div>

                    <ActionForm action={updateSettingAction} submitLabel="Opslaan">
                      <input type="hidden" name="key" value={setting.key} />
                      <label htmlFor={`value-${setting.key}`} className="sr-only">
                        {setting.label}
                      </label>
                      {setting.value_type === "boolean" ? (
                        <Select
                          id={`value-${setting.key}`}
                          name="value"
                          defaultValue={String(setting.value)}
                        >
                          <option value="true">Aan</option>
                          <option value="false">Uit</option>
                        </Select>
                      ) : setting.value_type === "longtext" || setting.value_type === "json" ? (
                        <Textarea
                          id={`value-${setting.key}`}
                          name="value"
                          rows={setting.value_type === "json" ? 3 : 8}
                          defaultValue={valueToInput(setting)}
                        />
                      ) : (
                        <Input
                          id={`value-${setting.key}`}
                          name="value"
                          type={setting.value_type === "number" ? "number" : "text"}
                          defaultValue={valueToInput(setting)}
                        />
                      )}
                    </ActionForm>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
