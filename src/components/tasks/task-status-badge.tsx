"use client";

import { Badge } from "@/components/ui/badge";
import { TaskStatus, STATUS_LABELS, STATUS_COLORS } from "@/lib/constants";

export function TaskStatusBadge({
  status,
  isOverdue,
  hasRevision,
}: {
  status: TaskStatus;
  isOverdue?: boolean;
  hasRevision?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Badge
        variant="secondary"
        className={`${STATUS_COLORS[status]} ${isOverdue ? "ring-2 ring-red-400 bg-red-50 text-red-700" : ""}`}
      >
        {isOverdue && status !== "COMPLETED" && status !== "CANCELLED"
          ? "Overdue"
          : STATUS_LABELS[status]}
      </Badge>
      {hasRevision && (
        <Badge variant="outline" className="border-purple-300 text-purple-600 text-xs">
          Rescheduled
        </Badge>
      )}
    </div>
  );
}
