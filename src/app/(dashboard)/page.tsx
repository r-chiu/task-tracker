"use client";

import { useCallback, useEffect, useState } from "react";
import { TaskSummaryCards } from "@/components/tasks/task-summary-cards";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskTable } from "@/components/tasks/task-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TaskStatus } from "@/lib/constants";
import { toast } from "sonner";
import { Bell } from "lucide-react";

interface Filters {
  search: string;
  owner: string;
  status: string;
  priority: string;
}

const defaultFilters: Filters = { search: "", owner: "", status: "", priority: "" };

export default function DashboardPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [sortBy, setSortBy] = useState("deadline");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [sendingReminders, setSendingReminders] = useState(false);
  const [summary, setSummary] = useState({
    totalActive: 0,
    overdue: 0,
    dueSoon: 0,
    completedThisWeek: 0,
  });

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.owner && filters.owner !== "all") params.set("owner", filters.owner);
    if (filters.status && filters.status !== "all") params.set("status", filters.status);
    if (filters.priority && filters.priority !== "all") params.set("priority", filters.priority);
    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);
    params.set("includeSummary", "true");

    const res = await fetch(`/api/tasks?${params}`);
    const data = await res.json();
    setTasks(data.tasks || []);
    if (data.summary) setSummary(data.summary);
    setLoading(false);
  }, [filters, sortBy, sortOrder]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((data) => setUsers(Array.isArray(data) ? data : []));
  }, []);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-10" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const handleSendReminders = async () => {
    setSendingReminders(true);
    try {
      const res = await fetch("/api/cron/reminders", {
        headers: { "x-cron-secret": "manual" },
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Sent ${data.remindersSent} reminder(s) and ${data.followUpsSent} follow-up(s)`);
      } else {
        toast.error(data.error || "Failed to send reminders");
      }
    } catch {
      toast.error("Failed to send reminders");
    } finally {
      setSendingReminders(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Button
          variant="outline"
          onClick={handleSendReminders}
          disabled={sendingReminders}
        >
          <Bell className="mr-2 h-4 w-4" />
          {sendingReminders ? "Sending..." : "Send All Reminders"}
        </Button>
      </div>
      <TaskSummaryCards data={summary} />
      <TaskFilters
        filters={filters}
        users={users}
        onChange={(key, value) => setFilters((f) => ({ ...f, [key]: value }))}
        onClear={() => setFilters(defaultFilters)}
      />
      <TaskTable
        tasks={tasks}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        onDelete={() => fetchTasks()}
        onStatusChange={async (taskId: string, newStatus: TaskStatus) => {
          try {
            const res = await fetch(`/api/tasks/${taskId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: newStatus }),
            });
            if (res.ok) {
              toast.success("Status updated");
              fetchTasks();
            } else {
              toast.error("Failed to update status");
            }
          } catch {
            toast.error("Failed to update status");
          }
        }}
      />
    </div>
  );
}
