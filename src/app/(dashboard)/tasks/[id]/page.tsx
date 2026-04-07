"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { TaskStatusBadge } from "@/components/tasks/task-status-badge";
import { TaskPriorityBadge } from "@/components/tasks/task-priority-badge";
import { TaskComments } from "@/components/tasks/task-comments";
import { TaskHistory } from "@/components/tasks/task-history";
import { DeadlineExtensionDialog } from "@/components/tasks/deadline-extension-dialog";
import { STATUS_LABELS, PRIORITY_LABELS, SOURCE_LABELS } from "@/lib/constants";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  const fetchTask = useCallback(async () => {
    const res = await fetch(`/api/tasks/${id}`);
    if (!res.ok) {
      toast.error("Task not found");
      router.push("/");
      return;
    }
    setTask(await res.json());
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  const updateField = async (field: string, value: string) => {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) {
      toast.success(`${field} updated`);
      fetchTask();
    } else {
      toast.error("Update failed");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this task?")) return;
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Task deleted");
      router.push("/");
    } else {
      toast.error("Delete failed");
    }
  };

  // Auth disabled — all users have full access. Re-enable role checks with auth.
  const isEditable = true;
  const isAdmin = true;
  const formatDate = (d: string) =>
    format(toZonedTime(new Date(d), "Asia/Taipei"), "yyyy-MM-dd");

  if (loading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!task) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <div className="flex gap-2">
          {isEditable && (
            <DeadlineExtensionDialog
              taskId={task.id}
              currentDeadline={task.deadline}
              extensions={task.extensions}
              onExtended={fetchTask}
            />
          )}
          {isAdmin && (
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {editingTitle ? (
                <input
                  type="text"
                  className="w-full text-xl font-semibold bg-transparent border-b-2 border-primary focus:outline-none px-0 py-0.5"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onBlur={() => {
                    const trimmed = titleValue.trim();
                    if (trimmed && trimmed !== (task.title || task.description)) {
                      updateField("title", trimmed);
                    }
                    setEditingTitle(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  autoFocus
                />
              ) : (
                <div className="group flex items-center gap-2">
                  <CardTitle
                    className="text-xl cursor-pointer hover:text-primary/80 transition-colors"
                    title="Click to edit task name"
                    onClick={() => {
                      setTitleValue(task.title || task.description);
                      setEditingTitle(true);
                    }}
                  >
                    {task.title || task.description}
                  </CardTitle>
                  <button
                    type="button"
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-1"
                    title="Edit task name"
                    onClick={() => {
                      setTitleValue(task.title || task.description);
                      setEditingTitle(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
              )}
              {task.title && task.description && !editingTitle && (
                <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <TaskStatusBadge
                status={task.status}
                isOverdue={task.isOverdue}
                hasRevision={!!task.revisedDeadline}
              />
              <TaskPriorityBadge priority={task.priority} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-y-3 gap-x-8 text-sm">
            <div>
              <span className="text-muted-foreground">Owner:</span>{" "}
              <span className="font-medium">{task.owner.name || task.owner.email}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Created by:</span>{" "}
              <span>{task.creator.name || task.creator.email}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Deadline:</span>{" "}
              <span className={task.isOverdue ? "text-red-600 font-semibold" : "font-medium"}>
                {formatDate(task.deadline)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Original Deadline:</span>{" "}
              <span>{formatDate(task.originalDeadline)}</span>
            </div>
            {task.revisedDeadline && (
              <>
                <div>
                  <span className="text-muted-foreground">Revised Deadline:</span>{" "}
                  <span className="text-purple-600 font-medium">
                    {formatDate(task.revisedDeadline)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Extension Reason:</span>{" "}
                  <span>{task.extensionReason || "Not specified"}</span>
                </div>
              </>
            )}
            <div>
              <span className="text-muted-foreground">Source:</span>{" "}
              <span>{SOURCE_LABELS[task.sourceType as keyof typeof SOURCE_LABELS]}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Created:</span>{" "}
              <span>{formatDate(task.createdAt)}</span>
            </div>
            {task.slackChannel && (
              <div>
                <span className="text-muted-foreground">Slack Channel:</span>{" "}
                <span>{task.slackChannel}</span>
              </div>
            )}
            {task.completionDate && (
              <div>
                <span className="text-muted-foreground">Completed:</span>{" "}
                <span className="text-green-600">{formatDate(task.completionDate)}</span>
              </div>
            )}
          </div>

          {task.notes && (
            <div className="mt-4">
              <span className="text-sm text-muted-foreground">Notes:</span>
              <p className="mt-1 text-sm whitespace-pre-wrap">{task.notes}</p>
            </div>
          )}

          {/* Quick status/priority update */}
          {isEditable && (
            <>
              <Separator className="my-4" />
              <div className="flex gap-4">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Update Status</span>
                  <Select
                    value={task.status}
                    onValueChange={(v) => v && updateField("status", v)}
                  >
                    <SelectTrigger className="w-[180px] h-8 text-sm">
                      <SelectValue>
                        {STATUS_LABELS[task.status as keyof typeof STATUS_LABELS] || task.status}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Update Priority</span>
                  <Select
                    value={task.priority}
                    onValueChange={(v) => v && updateField("priority", v)}
                  >
                    <SelectTrigger className="w-[140px] h-8 text-sm">
                      <SelectValue>
                        {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS] || task.priority}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Tabs: Comments + Activity */}
      <Tabs defaultValue="comments">
        <TabsList>
          <TabsTrigger value="comments">
            Comments ({task.comments?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="activity">
            Activity ({task.history?.length || 0})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="comments" className="mt-4">
          <TaskComments
            taskId={task.id}
            comments={task.comments || []}
            canPost={isEditable}
          />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <TaskHistory history={task.history || []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
