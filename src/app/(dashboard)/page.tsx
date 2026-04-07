"use client";

import { useCallback, useEffect, useState } from "react";
import { TaskSummaryCards } from "@/components/tasks/task-summary-cards";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskTable } from "@/components/tasks/task-table";
import { Skeleton } from "@/components/ui/skeleton";

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

    const res = await fetch(`/api/tasks?${params}`);
    const data = await res.json();
    setTasks(data.tasks || []);

    // Calculate summary from all tasks (unfiltered)
    const allRes = await fetch("/api/tasks?limit=1000");
    const allData = await allRes.json();
    const allTasks = allData.tasks || [];
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    setSummary({
      totalActive: allTasks.filter((t: any) =>
        ["NOT_STARTED", "IN_PROGRESS", "WAITING_ON_OTHERS"].includes(t.status)
      ).length,
      overdue: allTasks.filter((t: any) => t.isOverdue).length,
      dueSoon: allTasks.filter(
        (t: any) =>
          !t.isOverdue &&
          ["NOT_STARTED", "IN_PROGRESS", "WAITING_ON_OTHERS"].includes(t.status) &&
          new Date(t.deadline) <= threeDaysFromNow &&
          new Date(t.deadline) >= now
      ).length,
      completedThisWeek: allTasks.filter(
        (t: any) =>
          t.status === "COMPLETED" &&
          t.completionDate &&
          new Date(t.completionDate) >= oneWeekAgo
      ).length,
    });

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

  return (
    <div className="space-y-6">
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
      />
    </div>
  );
}
