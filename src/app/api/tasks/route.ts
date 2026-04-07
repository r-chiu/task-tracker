import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/mock-user";
import { humanizeTasks } from "@/lib/task-utils";
import { z } from "zod/v4";

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  ownerId: z.string().min(1),
  deadline: z.string().transform((s) => new Date(s)),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  sourceType: z.enum(["MANUAL", "SLACK_MESSAGE", "MEETING_NOTES", "TRANSCRIPT", "VIDEO_RECORDING", "OTHER"]).optional(),
  sourceReference: z.string().optional(),
  slackChannel: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const search = searchParams.get("search");
  const sortBy = searchParams.get("sortBy") || "deadline";
  const sortOrder = (searchParams.get("sortOrder") || "asc") as "asc" | "desc";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");

  const where: Record<string, unknown> = {};
  if (owner) where.ownerId = owner;
  if (status) {
    const statuses = status.split(",");
    where.status = { in: statuses };
  }
  if (priority) {
    const priorities = priority.split(",");
    where.priority = { in: priorities };
  }
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { description: { contains: search } },
    ];
  }

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true, slackDisplayName: true } },
        creator: { select: { id: true, name: true, email: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.task.count({ where }),
  ]);

  const humanized = await humanizeTasks(tasks as unknown as Record<string, unknown>[]);
  return NextResponse.json({ tasks: humanized, total, page, limit });
}

export async function POST(req: Request) {
  const user = getCurrentUser();
  const body = await req.json();
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const { title, description, ownerId, deadline, priority, sourceType, sourceReference, slackChannel, notes } = parsed.data;

  try {
    const task = await prisma.task.create({
      data: {
        title: title || "",
        description,
        ownerId,
        creatorId: user.id,
        deadline,
        originalDeadline: deadline,
        priority: priority ?? "MEDIUM",
        sourceType: sourceType ?? "MANUAL",
        sourceReference,
        slackChannel,
        notes,
      },
      include: {
        owner: { select: { id: true, name: true, email: true } },
      },
    });

    await prisma.taskHistory.create({
      data: {
        taskId: task.id,
        userId: user.id,
        field: "created",
        oldValue: null,
        newValue: "Task created",
      },
    });

    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    console.error("Task creation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create task" },
      { status: 500 }
    );
  }
}
