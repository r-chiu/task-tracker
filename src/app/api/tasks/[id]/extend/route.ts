import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/mock-user";
import { recordTaskChange } from "@/lib/task-utils";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  const { id } = await params;
  const { revisedDeadline, reason } = await req.json();

  if (!revisedDeadline) {
    return NextResponse.json({ error: "Revised deadline is required" }, { status: 400 });
  }

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const newDeadline = new Date(revisedDeadline);

  await prisma.deadlineExtension.create({
    data: {
      taskId: id,
      originalDeadline: task.deadline,
      revisedDeadline: newDeadline,
      reason: reason || null,
      extendedById: user.id,
    },
  });

  const updated = await prisma.task.update({
    where: { id },
    data: {
      deadline: newDeadline,
      revisedDeadline: newDeadline,
      extensionReason: reason || null,
      isOverdue: false,
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      extensions: {
        include: { extendedBy: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  await recordTaskChange(
    id,
    user.id,
    "deadline",
    task.deadline.toISOString(),
    newDeadline.toISOString(),
    reason ? `Extended: ${reason}` : "Deadline extended"
  );

  return NextResponse.json(updated);
}
