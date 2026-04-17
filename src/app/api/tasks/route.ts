import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/mock-user";
import { humanizeTasks, isTaskOverdue } from "@/lib/task-utils";
import { sendSlackDM } from "@/lib/slack";
import { buildTaskConfirmationBlocks } from "@/lib/slack-blocks";
import { PRIORITY_LABELS } from "@/lib/constants";
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
  slackMessageLink: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET(req: Request) {
  // Auto-migrate legacy statuses (NOT_STARTED, IN_PROGRESS → ACTIVE)
  // This is idempotent and fast (no-op after first run)
  await prisma.task.updateMany({
    where: { status: { in: ["NOT_STARTED", "IN_PROGRESS"] } },
    data: { status: "ACTIVE" },
  }).catch(() => {}); // Ignore errors silently

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
  // Always exclude soft-deleted tasks unless explicitly requested
  if (owner) where.ownerId = owner;
  if (status) {
    const statuses = status.split(",");
    where.status = { in: statuses };
  } else {
    where.status = { not: "DELETED" };
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

  const includeSummary = searchParams.get("includeSummary") === "true";

  const queries: Promise<unknown>[] = [
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
  ];

  // Fetch all active tasks + recently completed for summary computation
  if (includeSummary) {
    queries.push(
      prisma.task.findMany({
        where: {
          OR: [
            { status: { in: ["ACTIVE", "WAITING_ON_OTHERS"] } },
            {
              status: "COMPLETED",
              completionDate: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            },
          ],
        },
        select: { status: true, deadline: true, revisedDeadline: true, completionDate: true },
      })
    );
  }

  const results = await Promise.all(queries);
  const tasks = results[0] as Record<string, unknown>[];
  const total = results[1] as number;

  const humanized = await humanizeTasks(tasks);
  const result: Record<string, unknown> = { tasks: humanized, total, page, limit };

  if (includeSummary) {
    const allTasks = results[2] as { status: string; deadline: Date; revisedDeadline: Date | null; completionDate: Date | null }[];
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const activeStatuses = ["ACTIVE", "WAITING_ON_OTHERS"];

    let totalActive = 0, overdue = 0, dueSoon = 0, completedThisWeek = 0;
    for (const t of allTasks) {
      if (activeStatuses.includes(t.status)) {
        totalActive++;
        if (isTaskOverdue(t)) {
          overdue++;
        } else {
          const effective = t.revisedDeadline ?? t.deadline;
          if (effective >= now && effective <= threeDaysFromNow) {
            dueSoon++;
          }
        }
      }
      if (t.status === "COMPLETED" && t.completionDate) {
        completedThisWeek++;
      }
    }
    result.summary = { totalActive, overdue, dueSoon, completedThisWeek };
  }

  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = await req.json();
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const { title, description, ownerId, deadline, priority, sourceType, sourceReference, slackChannel, slackMessageLink, notes } = parsed.data;

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
        slackMessageLink,
        slackChannel,
        notes,
      },
      include: {
        owner: { select: { id: true, name: true, email: true, slackId: true, slackDisplayName: true } },
        creator: { select: { id: true, name: true, email: true, slackId: true } },
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

    // Fire-and-forget: DM the owner if different from creator (web UI task creation)
    if (task.owner.slackId && task.owner.id !== task.creator.id) {
      const priorityLabel =
        PRIORITY_LABELS[(task.priority ?? "MEDIUM") as keyof typeof PRIORITY_LABELS] ||
        (task.priority ?? "MEDIUM");
      const deadlineStr = new Date(task.deadline).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
      const appUrl = process.env.NEXTAUTH_URL || "";
      const taskTitle = task.title || (task.description || "").slice(0, 80) || "New task";
      const blocks = buildTaskConfirmationBlocks({
        title: taskTitle,
        ownerName: task.owner.slackDisplayName || task.owner.name || task.owner.email,
        deadline: deadlineStr,
        priority: priorityLabel,
        id: task.id,
        creatorName: task.creator.name || task.creator.email,
        appUrl,
      });
      const dmText = `📋 New task assigned to you: *${taskTitle}*\nDeadline: ${deadlineStr} | Priority: ${priorityLabel}`;
      sendSlackDM(task.owner.slackId, dmText, blocks).catch((e) => {
        console.error("Failed to send task assignment DM:", e);
      });
    }

    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    console.error("Task creation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create task" },
      { status: 500 }
    );
  }
}
