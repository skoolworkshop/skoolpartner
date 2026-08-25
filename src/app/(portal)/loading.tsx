import { Skeleton } from "@/components/ui/feedback";

export default function PortalLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Gegevens worden geladen</span>
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
