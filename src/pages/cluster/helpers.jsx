import { Badge } from "../../components/ui";

export function statusTone(status) {
  if (status === "Approved") return "success";
  if (status === "Rejected") return "danger";
  if (status === "Pending Review" || status === "Revision Needed") return "warn";
  if (status === "Published") return "blue";
  return "neutral";
}

export function StatusBadge({ status }) {
  return <Badge tone={statusTone(status)}>{status}</Badge>;
}

export function exportToast(type) {
  return `${type} export prepared`;
}
