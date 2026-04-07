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
  const isActive = status !== "COMPLETED" && status !== "CANCELLED";

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge
        variant="secondary"
        className={`${STATUS_COLORS[status] || "bg-gray-100 text-gray-600"} ${isOverdue && isActive ? "ring-2 ring-red-400 bg-red-50 text-red-700" : ""}`}
      >
        {isOverdue && isActive
          ? "Overdue"
          : STATUS_LABELS[status] || status}
      </Badge>
      {isOverdue && status === "WAITING_ON_OTHERS" && (
        <Badge variant="outline" className="border-yellow-200 bg-yellow-100 text-yellow-700 text-xs">
          Waiting
        </Badge>
      )}
      {hasRevision && (
        <Badge variant="outline" className="border-purple-300 text-purple-600 text-xs">
          Rescheduled
        </Badge>
      )}
    </div>
  );
}
