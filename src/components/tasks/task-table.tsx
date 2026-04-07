"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TaskStatusBadge } from "./task-status-badge";
import { TaskPriorityBadge } from "./task-priority-badge";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { TAIPEI_TIMEZONE, STATUS_LABELS, TaskStatus } from "@/lib/constants";
import { ArrowUpDown, Bell, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TaskRow {
  id: string;
  title?: string;
  description: string;
  status: "ACTIVE" | "WAITING_ON_OTHERS" | "COMPLETED" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  deadline: string;
  isOverdue: boolean;
  revisedDeadline: string | null;
  createdAt: string;
  owner: { id: string; name: string | null; email: string };
}

function deadlineColor(deadline: string, isOverdue: boolean, status: string): string {
  if (status === "COMPLETED" || status === "CANCELLED") return "text-muted-foreground";
  if (isOverdue) return "text-red-600 font-semibold";
  const daysUntil =
    (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysUntil <= 3) return "text-orange-600 font-medium";
  return "";
}

export function TaskTable({
  tasks,
  sortBy,
  sortOrder,
  onSort,
  onDelete,
  onStatusChange,
}: {
  tasks: TaskRow[];
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSort: (field: string) => void;
  onDelete?: (taskId: string) => void;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const allSelected = tasks.length > 0 && selected.size === tasks.length;
  const someSelected = selected.size > 0 && selected.size < tasks.length;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tasks.map((t) => t.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    const count = selected.size;
    if (!confirm(`Delete ${count} selected task${count > 1 ? "s" : ""}?`)) return;

    setDeleting(true);
    try {
      const results = await Promise.allSettled(
        Array.from(selected).map((id) =>
          fetch(`/api/tasks/${id}`, { method: "DELETE" })
        )
      );
      const succeeded = results.filter(
        (r) => r.status === "fulfilled" && (r.value as Response).ok
      ).length;
      const failed = count - succeeded;

      if (succeeded > 0) {
        toast.success(`Deleted ${succeeded} task${succeeded > 1 ? "s" : ""}`);
        setSelected(new Set());
        onDelete?.("");
      }
      if (failed > 0) {
        toast.error(`Failed to delete ${failed} task${failed > 1 ? "s" : ""}`);
      }
    } catch {
      toast.error("Failed to delete tasks");
    } finally {
      setDeleting(false);
    }
  };

  const SortHeader = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8"
      onClick={() => onSort(field)}
    >
      {children}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  );

  return (
    <div className="space-y-2">
      {/* Bulk action bar — appears when items are selected */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2">
          <span className="text-sm font-medium">
            {selected.size} task{selected.size > 1 ? "s" : ""} selected
          </span>
          <Button
            variant="destructive"
            size="sm"
            className="h-7"
            onClick={handleBulkDelete}
            disabled={deleting}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {deleting ? "Deleting..." : `Delete${selected.size > 1 ? " All" : ""}`}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-muted-foreground"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </Button>
        </div>
      )}

      <div className="rounded-md border overflow-hidden">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                  className="rounded border-input accent-primary"
                  aria-label="Select all tasks"
                />
              </TableHead>
              <TableHead className="w-[30%]">
                <SortHeader field="title">Task Name</SortHeader>
              </TableHead>
              <TableHead className="w-[14%]">Status</TableHead>
              <TableHead className="w-[10%]">Owner</TableHead>
              <TableHead className="w-[8%]">
                <SortHeader field="priority">Priority</SortHeader>
              </TableHead>
              <TableHead className="w-[11%]">
                <SortHeader field="deadline">Deadline</SortHeader>
              </TableHead>
              <TableHead className="w-[11%]">
                <SortHeader field="createdAt">Created</SortHeader>
              </TableHead>
              <TableHead className="w-[72px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No tasks found
                </TableCell>
              </TableRow>
            )}
            {tasks.map((task) => (
              <TableRow
                key={task.id}
                className={`${task.isOverdue ? "bg-red-50/50" : ""} ${selected.has(task.id) ? "bg-[#61D6D6]/10" : ""}`}
              >
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.has(task.id)}
                    onChange={() => toggleOne(task.id)}
                    className="rounded border-input accent-primary"
                    aria-label={`Select ${task.title || task.description.slice(0, 30)}`}
                  />
                </TableCell>
                <TableCell className="max-w-0">
                  <Link
                    href={`/tasks/${task.id}`}
                    className="font-medium hover:underline text-primary block truncate"
                  >
                    {task.title || task.description}
                  </Link>
                  {task.title && task.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {task.description}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="cursor-pointer focus:outline-none">
                      <TaskStatusBadge
                        status={task.status}
                        isOverdue={task.isOverdue}
                        hasRevision={!!task.revisedDeadline}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
                        <DropdownMenuItem
                          key={s}
                          onClick={() => onStatusChange?.(task.id, s)}
                          className={task.status === s ? "font-semibold" : ""}
                        >
                          {STATUS_LABELS[s]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
                <TableCell className="text-sm truncate">
                  {task.owner.name || task.owner.email}
                </TableCell>
                <TableCell>
                  <TaskPriorityBadge priority={task.priority} />
                </TableCell>
                <TableCell
                  className={`text-sm ${deadlineColor(task.deadline, task.isOverdue, task.status)}`}
                >
                  {format(
                    toZonedTime(new Date(task.deadline), TAIPEI_TIMEZONE),
                    "yyyy-MM-dd"
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(
                    toZonedTime(new Date(task.createdAt), TAIPEI_TIMEZONE),
                    "yyyy-MM-dd"
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-0.5">
                    {task.status !== "COMPLETED" && task.status !== "CANCELLED" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-blue-600"
                        title="Send Slack reminder"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const res = await fetch(`/api/tasks/${task.id}/remind`, { method: "POST" });
                            const data = await res.json();
                            if (res.ok) {
                              toast.success(`Reminder sent to ${data.to}`);
                            } else {
                              toast.error(data.error || "Failed to send reminder");
                            }
                          } catch {
                            toast.error("Failed to send reminder");
                          }
                        }}
                      >
                        <Bell className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                      title="Delete task"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete "${task.title || task.description.slice(0, 40)}"?`)) return;
                        try {
                          const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
                          if (res.ok) {
                            toast.success("Task deleted");
                            setSelected((prev) => { const next = new Set(prev); next.delete(task.id); return next; });
                            onDelete?.(task.id);
                          } else {
                            toast.error("Failed to delete task");
                          }
                        } catch {
                          toast.error("Failed to delete task");
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
