"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { STATUS_LABELS, PRIORITY_LABELS } from "@/lib/constants";

interface User {
  id: string;
  name: string | null;
  email: string;
}

interface Filters {
  search: string;
  owner: string;
  status: string;
  priority: string;
}

export function TaskFilters({
  filters,
  users,
  onChange,
  onClear,
}: {
  filters: Filters;
  users: User[];
  onChange: (key: keyof Filters, value: string) => void;
  onClear: () => void;
}) {
  const hasFilters = filters.search || filters.owner || filters.status || filters.priority;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search tasks..."
          value={filters.search}
          onChange={(e) => onChange("search", e.target.value)}
          className="pl-9"
        />
      </div>

      <Select value={filters.owner} onValueChange={(v) => v && onChange("owner", v)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All Owners">
            {filters.owner && filters.owner !== "all"
              ? (users.find((u) => u.id === filters.owner)?.name || users.find((u) => u.id === filters.owner)?.email || undefined)
              : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Owners</SelectItem>
          {users.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name || u.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.status} onValueChange={(v) => v && onChange("status", v)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All Statuses">
            {filters.status && filters.status !== "all"
              ? (STATUS_LABELS[filters.status as keyof typeof STATUS_LABELS] || undefined)
              : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.priority} onValueChange={(v) => v && onChange("priority", v)}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All Priorities">
            {filters.priority && filters.priority !== "all"
              ? (PRIORITY_LABELS[filters.priority as keyof typeof PRIORITY_LABELS] || undefined)
              : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Priorities</SelectItem>
          {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="mr-1 h-4 w-4" /> Clear
        </Button>
      )}
    </div>
  );
}
