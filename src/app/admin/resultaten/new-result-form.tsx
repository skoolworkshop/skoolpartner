"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, ChevronsUpDown, LoaderCircle, Search } from "lucide-react";

import { ActionForm } from "@/components/admin/action-form";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { AdminState } from "@/app/admin/actions";
import { addResultLinkAction, createResultAction } from "@/app/admin/actions";
import { cn } from "@/lib/utils";
import { ResultUploader } from "./uploader";
import { loadResultBookingsAction, type ResultBookingOption } from "./result-form-actions";

interface OrganizationOption {
  id: string;
  name: string;
  city: string | null;
}

const initialState: AdminState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ink" size="sm" disabled={pending}>
      {pending ? "Set aanmaken…" : "Set aanmaken"}
    </Button>
  );
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("nl-NL");
}

function formatDate(value: string | null) {
  if (!value) return "datum onbekend";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}-${month}-${year}` : value;
}

function bookingLabel(booking: ResultBookingOption) {
  return [booking.reference, booking.workshopName, formatDate(booking.scheduledDate)]
    .filter(Boolean)
    .join(" · ");
}

export function NewResultForm({
  organizations,
  maxMb,
}: {
  organizations: OrganizationOption[];
  maxMb: number;
}) {
  const [state, formAction] = useActionState(createResultAction, initialState);
  const [query, setQuery] = useState("");
  const [selectedOrganization, setSelectedOrganization] = useState<OrganizationOption | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [bookings, setBookings] = useState<ResultBookingOption[]>([]);
  const [bookingId, setBookingId] = useState("");
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [loadingBookings, startLoadingBookings] = useTransition();
  const selectedOrganizationId = useRef<string | null>(null);

  const matches = useMemo(() => {
    const needle = normalize(query);
    const source = needle
      ? organizations.filter((organization) =>
          normalize(`${organization.name} ${organization.city ?? ""}`).includes(needle)
        )
      : organizations;
    return source.slice(0, 10);
  }, [organizations, query]);

  function chooseOrganization(organization: OrganizationOption) {
    setSelectedOrganization(organization);
    selectedOrganizationId.current = organization.id;
    setQuery(organization.name);
    setOpen(false);
    setBookingId("");
    setBookings([]);
    setBookingError(null);

    startLoadingBookings(async () => {
      const result = await loadResultBookingsAction(organization.id);
      if (selectedOrganizationId.current !== organization.id) return;
      setBookings(result.bookings);
      setBookingError(result.error ?? null);
    });
  }

  function changeSearch(value: string) {
    setQuery(value);
    setOpen(true);
    setActiveIndex(0);
    if (selectedOrganization && value !== selectedOrganization.name) {
      setSelectedOrganization(null);
      selectedOrganizationId.current = null;
      setBookings([]);
      setBookingId("");
      setBookingError(null);
    }
  }

  function selectBooking(value: string) {
    setBookingId(value);
    if (title.trim() || !value) return;
    const booking = bookings.find((item) => item.id === value);
    if (booking) setTitle(`${booking.workshopName} · ${formatDate(booking.scheduledDate)}`);
  }

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Organisatie"
            htmlFor="organization_search"
            hint="Typ een naam of plaats en kies de organisatie."
            required
          >
            <div className="relative">
              <input type="hidden" name="organization_id" value={selectedOrganization?.id ?? ""} />
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted"
                />
                <Input
                  id="organization_search"
                  value={query}
                  onChange={(event) => changeSearch(event.target.value)}
                  onFocus={() => setOpen(true)}
                  onBlur={() => window.setTimeout(() => setOpen(false), 150)}
                  onKeyDown={(event) => {
                    if (!open || matches.length === 0) return;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveIndex((index) => Math.max(index - 1, 0));
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      chooseOrganization(matches[activeIndex] ?? matches[0]);
                    } else if (event.key === "Escape") {
                      setOpen(false);
                    }
                  }}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={open}
                  aria-controls="organization-options"
                  aria-activedescendant={open ? `organization-option-${activeIndex}` : undefined}
                  autoComplete="off"
                  placeholder="Zoek bijvoorbeeld De Goudse Waarden"
                  className="pl-11 pr-11"
                  required
                />
                <ChevronsUpDown
                  aria-hidden
                  className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted"
                />
              </div>

              {open ? (
                <div
                  id="organization-options"
                  role="listbox"
                  className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-card border border-line-soft bg-white p-1 shadow-lg"
                >
                  {matches.length > 0 ? (
                    matches.map((organization, index) => (
                      <button
                        id={`organization-option-${index}`}
                        key={organization.id}
                        type="button"
                        role="option"
                        aria-selected={selectedOrganization?.id === organization.id}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseOrganization(organization)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm",
                          index === activeIndex ? "bg-surface-2" : "hover:bg-surface-2"
                        )}
                      >
                        <span>
                          <span className="block font-semibold">{organization.name}</span>
                          {organization.city ? (
                            <span className="block text-muted">{organization.city}</span>
                          ) : null}
                        </span>
                        {selectedOrganization?.id === organization.id ? (
                          <Check aria-hidden className="size-4 text-success" />
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-4 text-sm text-muted">Geen organisatie gevonden.</p>
                  )}
                </div>
              ) : null}
            </div>
          </Field>

          <Field
            label="Boeking"
            htmlFor="booking_id"
            hint={
              selectedOrganization
                ? `Alleen boekingen van ${selectedOrganization.name}.`
                : "Kies eerst een organisatie."
            }
          >
            <div className="relative">
              <Select
                id="booking_id"
                name="booking_id"
                value={bookingId}
                onChange={(event) => selectBooking(event.target.value)}
                disabled={!selectedOrganization || loadingBookings}
              >
                <option value="">
                  {loadingBookings
                    ? "Boekingen laden…"
                    : selectedOrganization && bookings.length === 0
                      ? "Geen boekingen gevonden"
                      : "Kies een boeking"}
                </option>
                {bookings.map((booking) => (
                  <option key={booking.id} value={booking.id}>
                    {bookingLabel(booking)}
                    {booking.contactEmail ? ` · ${booking.contactEmail}` : ""}
                  </option>
                ))}
              </Select>
              {loadingBookings ? (
                <LoaderCircle
                  aria-hidden
                  className="absolute right-10 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted"
                />
              ) : null}
            </div>
            {bookingError ? <p className="text-sm text-danger">{bookingError}</p> : null}
          </Field>
        </div>

        <Field label="Titel" htmlFor="title" required>
          <Input
            id="title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            placeholder="Bijvoorbeeld: Cultuurdag 14 maart"
          />
        </Field>

        <Field label="Toelichting" htmlFor="description">
          <Textarea
            id="description"
            name="description"
            rows={3}
            placeholder="Korte tekst die de klant bij de bestanden ziet."
          />
        </Field>

        <SubmitButton />
        {state.status === "error" ? <Alert tone="danger">{state.message}</Alert> : null}
      </form>

      {state.status === "ok" && state.resultId ? (
        <div className="space-y-4 rounded-card border border-line-soft bg-surface-2 p-4">
          <Alert tone="success" title="De conceptset staat klaar">
            {state.message} Je kunt meerdere bestanden selecteren. Voor bestanden buiten Supabase
            kun je een rechtstreekse downloadlink, WeTransfer-link of Drive-link toevoegen.
          </Alert>

          <ActionForm action={addResultLinkAction} submitLabel="Downloadlink toevoegen">
            <input type="hidden" name="result_id" value={state.resultId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Bestandsnaam" htmlFor={`new-file-name-${state.resultId}`}>
                <Input
                  id={`new-file-name-${state.resultId}`}
                  name="file_name"
                  required
                  placeholder="Bijvoorbeeld: Foto's cultuurdag"
                />
              </Field>
              <Field label="Downloadlink" htmlFor={`new-url-${state.resultId}`}>
                <Input
                  id={`new-url-${state.resultId}`}
                  name="url"
                  type="url"
                  required
                  placeholder="https://we.tl/..."
                />
              </Field>
              <Field label="Omschrijving" htmlFor={`new-description-${state.resultId}`}>
                <Input
                  id={`new-description-${state.resultId}`}
                  name="description"
                  placeholder="Bijvoorbeeld: foto's in hoge resolutie"
                />
              </Field>
            </div>
          </ActionForm>

          <details className="rounded-card border border-line-soft bg-surface-1 p-4">
            <summary className="cursor-pointer font-semibold">Toch een bestand uploaden</summary>
            <p className="mb-3 mt-2 text-sm text-muted">
              Gebruik dit alleen als er geen veilige externe downloadlink beschikbaar is.
            </p>
            <ResultUploader resultId={state.resultId} maxMb={maxMb} />
          </details>

          <p className="text-sm text-muted">
            De conceptset staat ook direct in de lijst hieronder. Daar kun je controleren,
            verwijderen en uiteindelijk publiceren en mailen.
          </p>
        </div>
      ) : null}
    </div>
  );
}
