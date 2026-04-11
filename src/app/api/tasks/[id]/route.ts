import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/mock-user";
import { recordTaskChange, humanizeTask } from "@/lib/task-utils";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, email: true, slackDisplayName: true } },
      creator: { select: { id: true, name: true, email: true } },
      comments: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      },
      history: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      },
      extensions: {
        include: { extendedBy: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const humanized = await humanizeTask(task as unknown as Record<string, unknown>);
  return NextResponse.json(humanized);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  const { id } = await params;
  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  const trackableFields = [
    "title", "description", "ownerId", "priority", "status", "notes", "slackChannel",
  ] as const;

  for (const field of trackableFields) {
    if (body[field] !== undefined && body[field] !== (existing as Record<string, unknown>)[field]) {
      updates[field] = body[field];
      await recordTaskChange(
        id,
        user.id,
        field,
        String((existing as Record<string, unknown>)[field] ?? ""),
        String(body[field])
      );
    }
  }

  if (body.deadline && new Date(body.deadline).getTime() !== existing.deadline.getTime()) {
    updates.deadline = new Date(body.deadline);
  }

  if (body.status === "COMPLETED" && existing.status !== "COMPLETED") {
    updates.completionDate = new Date();
  }
  if (body.status && body.status !== "COMPLETED" && existing.status === "COMPLETED") {
    updates.completionDate = null;
  }

  const task = await prisma.task.update({
    where: { id },
    data: updates,
    include: {
      owner: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json(task);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  const { id } = await params;

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // Soft delete: mark as DELETED and record who deleted it
  await prisma.task.update({
    where: { id },
    data: { status: "DELETED" },
  });

  await recordTaskChange(
    id,
    user.id,
    "status",
    task.status,
    "DELETED",
    `Deleted task "${task.title || task.description.slice(0, 50)}"`
  );

  return NextResponse.json({ success: true });
}
