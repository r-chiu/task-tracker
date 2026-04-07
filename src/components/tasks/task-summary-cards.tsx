"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle, Clock, ListTodo } from "lucide-react";

interface SummaryData {
  totalActive: number;
  overdue: number;
  dueSoon: number;
  completedThisWeek: number;
}

export function TaskSummaryCards({ data }: { data: SummaryData }) {
  const cards = [
    {
      title: "Active Tasks",
      value: data.totalActive,
      icon: ListTodo,
      color: "text-primary",
    },
    {
      title: "Overdue",
      value: data.overdue,
      icon: AlertTriangle,
      color: "text-red-600",
    },
    {
      title: "Due Within 3 Days",
      value: data.dueSoon,
      icon: Clock,
      color: "text-orange-600",
    },
    {
      title: "Completed This Week",
      value: data.completedThisWeek,
      icon: CheckCircle,
      color: "text-green-600",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
            <card.icon className={`h-4 w-4 ${card.color}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
