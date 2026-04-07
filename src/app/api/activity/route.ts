import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { STATUS_LABELS, PRIORITY_LABELS } from "@/lib/constants";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const userId = searchParams.get("userId");

  const where: Record<string, unknown> = {};
  if (userId) where.userId = userId;

  const [logs, total] = await Promise.all([
    prisma.taskHistory.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        task: { select: { id: true, title: true, description: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.taskHistory.count({ where }),
  ]);

  // Format the logs for display
  const formatted = logs.map((log) => {
    const taskLabel = log.task?.title || log.task?.description?.slice(0, 60) || "Unknown task";
    let description = "";

    if (log.field === "created") {
      description = `Created task "${taskLabel}"`;
    } else if (log.field === "status") {
      const oldLabel = STATUS_LABELS[log.oldValue as keyof typeof STATUS_LABELS] || log.oldValue;
      const newLabel = STATUS_LABELS[log.newValue as keyof typeof STATUS_LABELS] || log.newValue;
      description = `Changed status from "${oldLabel}" to "${newLabel}"`;
    } else if (log.field === "priority") {
      const oldLabel = PRIORITY_LABELS[log.oldValue as keyof typeof PRIORITY_LABELS] || log.oldValue;
      const newLabel = PRIORITY_LABELS[log.newValue as keyof typeof PRIORITY_LABELS] || log.newValue;
      description = `Changed priority from "${oldLabel}" to "${newLabel}"`;
    } else if (log.field === "ownerId") {
      description = `Reassigned task`;
    } else if (log.field === "deadline") {
      if (log.note?.startsWith("Extension approved")) {
        description = `Extension approved: deadline changed from ${log.oldValue} to ${log.newValue}`;
      } else {
        description = `Changed deadline from ${log.oldValue} to ${log.newValue}`;
      }
    } else if (log.field === "extension_requested") {
      description = `Requested deadline extension from ${log.oldValue} to ${log.newValue}`;
    } else if (log.field === "extension_denied") {
      description = `Extension request denied (requested: ${log.newValue})`;
    } else {
      description = `Updated ${log.field}`;
      if (log.oldValue && log.newValue) {
        description += `: "${log.oldValue?.slice(0, 40)}" → "${log.newValue?.slice(0, 40)}"`;
      }
    }

    return {
      id: log.id,
      taskId: log.taskId,
      taskLabel,
      userId: log.userId,
      userName: log.user?.name || log.user?.email || "System",
      field: log.field,
      description,
      note: log.note,
      createdAt: log.createdAt,
    };
  });

  return NextResponse.json({ logs: formatted, total, page, limit });
}
