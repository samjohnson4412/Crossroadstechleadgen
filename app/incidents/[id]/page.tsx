import { IncidentReport } from "@/components/Incidents";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <IncidentReport id={(await params).id} />;
}
