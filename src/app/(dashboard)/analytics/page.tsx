"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface PersonMetric {
  userId: string;
  userName: string;
  totalAssigned: number;
  completed: number;
  completedOnTime: number;
  completedLate: number;
  currentlyOverdue: number;
  extendedBeforeDeadline: number;
  extendedAfterDeadline: number;
  fulfillmentRate: number;
  onTimeRate: number;
}

interface TeamMetrics {
  totalActive: number;
  overdueCount: number;
  completedCount: number;
}

const COLORS = ["#22c55e", "#f97316", "#ef4444", "#6366f1", "#8b5cf6"];

export default function AnalyticsPage() {
  const currentYear = new Date().getFullYear();
  const [personMetrics, setPersonMetrics] = useState<PersonMetric[]>([]);
  const [teamMetrics, setTeamMetrics] = useState<TeamMetrics | null>(null);
  const [period, setPeriod] = useState("yearly");
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [loading, setLoading] = useState(true);

  // Generate year options (from 2024 to current year)
  const yearOptions = Array.from({ length: currentYear - 2023 }, (_, i) => String(currentYear - i));

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (period === "yearly") params.set("year", selectedYear);
    fetch(`/api/analytics?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setPersonMetrics(data.personMetrics || []);
        setTeamMetrics(data.teamMetrics || null);
        setLoading(false);
      });
  }, [period, selectedYear]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const barData = personMetrics.map((m) => ({
    name: m.userName.split(" ")[0] || m.userName,
    "On Time": m.completedOnTime,
    Late: m.completedLate,
    Overdue: m.currentlyOverdue,
  }));

  const totalCompleted = personMetrics.reduce((s, m) => s + m.completed, 0);
  const totalOnTime = personMetrics.reduce((s, m) => s + m.completedOnTime, 0);
  const totalLate = personMetrics.reduce((s, m) => s + m.completedLate, 0);
  const totalOverdue = personMetrics.reduce((s, m) => s + m.currentlyOverdue, 0);

  const pieData = [
    { name: "On Time", value: totalOnTime },
    { name: "Late", value: totalLate },
    { name: "Overdue", value: totalOverdue },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Performance Analytics</h1>
        <div className="flex items-center gap-2">
          {period === "yearly" && (
            <Select value={selectedYear} onValueChange={(v) => v && setSelectedYear(v)}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={period} onValueChange={(v) => v && setPeriod(v)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yearly">Annual</SelectItem>
              <SelectItem value="lifetime">Lifetime</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Team summary cards */}
      {teamMetrics && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Tasks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">{teamMetrics.totalActive}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Currently Overdue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{teamMetrics.overdueCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Completed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{teamMetrics.completedCount}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Completion by Person</CardTitle>
          </CardHeader>
          <CardContent>
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="On Time" fill="#22c55e" />
                  <Bar dataKey="Late" fill="#f97316" />
                  <Bar dataKey="Overdue" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground py-12 text-center">No data yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overall Completion Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground py-12 text-center">No data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Person metrics table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Individual Performance {period === "yearly" ? `(${selectedYear})` : "(All Time)"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="text-center">Assigned</TableHead>
                <TableHead className="text-center">Completed</TableHead>
                <TableHead className="text-center">On Time</TableHead>
                <TableHead className="text-center">Late</TableHead>
                <TableHead className="text-center">Overdue</TableHead>
                <TableHead className="text-center">Fulfillment Rate</TableHead>
                <TableHead className="text-center">On-Time Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {personMetrics.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No data yet
                  </TableCell>
                </TableRow>
              )}
              {personMetrics.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">{m.userName}</TableCell>
                  <TableCell className="text-center">{m.totalAssigned}</TableCell>
                  <TableCell className="text-center">{m.completed}</TableCell>
                  <TableCell className="text-center text-green-600">{m.completedOnTime}</TableCell>
                  <TableCell className="text-center text-orange-600">{m.completedLate}</TableCell>
                  <TableCell className="text-center text-red-600">{m.currentlyOverdue}</TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="secondary"
                      className={m.fulfillmentRate >= 80 ? "bg-green-100 text-green-700" : m.fulfillmentRate >= 50 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}
                    >
                      {m.fulfillmentRate}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="secondary"
                      className={m.onTimeRate >= 80 ? "bg-green-100 text-green-700" : m.onTimeRate >= 50 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}
                    >
                      {m.onTimeRate}%
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
