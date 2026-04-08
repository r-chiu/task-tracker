"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { TAIPEI_TIMEZONE } from "@/lib/constants";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ActivityLog {
  id: string;
  taskId: string;
  taskLabel: string;
  userId: string;
  userName: string;
  field: string;
  description: string;
  note: string | null;
  createdAt: string;
}

const FIELD_COLORS: Record<string, string> = {
  created: "bg-[#E0F5F5] text-[#3AACAC]",
  status: "bg-blue-100 text-blue-700",
  priority: "bg-orange-100 text-orange-700",
  ownerId: "bg-purple-100 text-purple-700",
  deadline: "bg-yellow-100 text-yellow-700",
  extension_requested: "bg-blue-100 text-blue-700",
  extension_denied: "bg-red-100 text-red-700",
  title: "bg-slate-100 text-slate-600",
  description: "bg-slate-100 text-slate-600",
  notes: "bg-slate-100 text-slate-600",
};

const FIELD_LABELS: Record<string, string> = {
  created: "Create",
  status: "Status",
  priority: "Priority",
  ownerId: "Reassign",
  deadline: "Deadline",
  extension_requested: "📝 Extension",
  extension_denied: "❌ Denied",
  title: "Title",
  description: "Description",
  notes: "Notes",
};

export default function ActivityPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const limit = 30;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/activity?page=${page}&limit=${limit}`)
      .then((r) => r.json())
      .then((data) => {
        setLogs(data.logs || []);
        setTotal(data.total || 0);
        setLoading(false);
      });
  }, [page]);

  const totalPages = Math.ceil(total / limit);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Activity Log</h1>
        <span className="text-sm text-muted-foreground">{total} total entries</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Changes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Time</TableHead>
                <TableHead className="w-[130px]">User</TableHead>
                <TableHead className="w-[90px]">Type</TableHead>
                <TableHead className="w-[200px]">Task</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No activity yet
                  </TableCell>
                </TableRow>
              )}
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {format(
                      toZonedTime(new Date(log.createdAt), TAIPEI_TIMEZONE),
                      "yyyy-MM-dd HH:mm"
                    )}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {log.userName}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      // Extension approved gets special green badge
                      const isApproval = log.field === "deadline" && log.description.startsWith("Extension approved");
                      const badgeField = isApproval ? "extension_approved" : log.field;
                      const badgeColor = isApproval
                        ? "bg-green-100 text-green-700"
                        : (FIELD_COLORS[log.field] || "bg-slate-100 text-slate-600");
                      const badgeLabel = isApproval
                        ? "✅ Approved"
                        : (FIELD_LABELS[badgeField] || log.field.charAt(0).toUpperCase() + log.field.slice(1));
                      return (
                        <Badge variant="secondary" className={badgeColor}>
                          {badgeLabel}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link
                      href={`/tasks/${log.taskId}`}
                      className="text-primary hover:underline truncate block max-w-[200px]"
                    >
                      {log.taskLabel}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    <span>{log.description}</span>
                    {log.note && (log.field === "extension_requested" || log.field === "extension_denied" || (log.field === "deadline" && log.note.startsWith("Extension"))) && (
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {log.note
                          .replace(/^Extension requested:\s*/, "Reason: ")
                          .replace(/^Extension approved:\s*/, "Reason: ")
                          .replace(/^Extension denied\.\s*Requested reason:\s*/, "Reason: ")}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t mt-4">
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
