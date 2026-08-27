import { redirect } from "next/navigation";

/** Oude bladwijzers blijven veilig werken zonder het verwijderde scherm te tonen. */
export default function RemovedAdminMessageDetailPage() {
  redirect("/admin/boekingen");
}
