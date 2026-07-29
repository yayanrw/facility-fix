import { Badge } from "@/components/ui/badge";
import { DEADLINE_WARNING_DAYS, daysUntil, type Status } from "@/lib/domain";

/**
 * Remaining-days indicator. Hidden for `approved` — the flow is terminal there,
 * so a countdown would imply work that nobody is expected to do.
 */
export function DeadlineBadge({
  deadline,
  status,
}: {
  deadline: string;
  status?: Status;
}) {
  if (status === "approved") return null;

  const days = daysUntil(deadline);

  if (days < 0) {
    return <Badge variant="destructive">Terlambat {-days} hari</Badge>;
  }
  if (days <= DEADLINE_WARNING_DAYS) {
    return (
      <Badge variant="warning">
        {days === 0 ? "Jatuh tempo hari ini" : `${days} hari lagi`}
      </Badge>
    );
  }
  return <Badge variant="outline">{days} hari lagi</Badge>;
}
