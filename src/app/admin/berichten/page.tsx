import { redirect } from "next/navigation";

/** Het losse beheerscherm Berichten is vervallen. */
export default function RemovedAdminMessagesPage() {
  redirect("/admin/boekingen");
}
