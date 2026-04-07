"use client";

import { Badge } from "@/components/ui/badge";
import { TaskPriority, PRIORITY_LABELS, PRIORITY_COLORS } from "@/lib/constants";

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <Badge variant="secondary" className={PRIORITY_COLORS[priority]}>
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}
