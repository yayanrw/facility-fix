import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, type Status } from "@/lib/domain";

const VARIANT: Record<Status, "secondary" | "success" | "destructive"> = {
  pending_review: "secondary",
  pending_approval: "secondary",
  approved: "success",
  rejected: "destructive",
};

export function StatusBadge({ status }: { status: Status }) {
  return <Badge variant={VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
