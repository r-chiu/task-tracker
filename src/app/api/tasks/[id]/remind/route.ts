import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendSlackDM, buildReminderBlocks, buildOverdueBlocks } from "@/lib/slack";
import { isTaskOverdue, getEffectiveDeadline, humanizeSlackText } from "@/lib/task-utils";
import { PRIORITY_LABELS, TaskPriority } from "@/lib/constants";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

/**
 * POST /api/tasks/[id]/remind
 * Send a Slack reminder DM to the task owner for a specific task.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, email: true, slackId: true } },
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!task.owner.slackId) {
    return NextResponse.json({ error: "Task owner has no Slack ID linked" }, { status: 400 });
  }

  const TAIPEI = "Asia/Taipei";
  const effective = getEffectiveDeadline(task);
  const overdue = isTaskOverdue(task);
  const humanTitle = await humanizeSlackText(task.title);
  const humanDesc = await humanizeSlackText(task.description);
  const taskLabel = humanTitle || humanDesc.slice(0, 100);
  const deadlineStr = format(toZonedTime(effective, TAIPEI), "yyyy-MM-dd");
  const priorityLabel = PRIORITY_LABELS[task.priority as TaskPriority] || task.priority;

  try {
    if (overdue) {
      const daysOverdue = Math.floor(
        (Date.now() - effective.getTime()) / (1000 * 60 * 60 * 24)
      );
      const blocks = buildOverdueBlocks({
        id: task.id,
        title: humanTitle,
        description: humanDesc,
        ownerName: task.owner.name || task.owner.email,
        deadline: deadlineStr,
        priority: priorityLabel,
        daysOverdue,
      });
      await sendSlackDM(
        task.owner.slackId,
        `Overdue: "${taskLabel}" is ${daysOverdue} days past deadline.`,
        blocks
      );
    } else {
      const blocks = buildReminderBlocks({
        id: task.id,
        title: humanTitle,
        description: humanDesc,
        ownerName: task.owner.name || task.owner.email,
        deadline: deadlineStr,
        priority: priorityLabel,
      });
      await sendSlackDM(
        task.owner.slackId,
        `Reminder: "${taskLabel}" is due ${deadlineStr}.`,
        blocks
      );
    }

    // Update lastFollowUp
    await prisma.task.update({
      where: { id },
      data: { lastFollowUp: new Date() },
    });

    return NextResponse.json({ sent: true, to: task.owner.name || task.owner.email });
  } catch (err) {
    console.error(`Failed to send reminder for task ${id}:`, err);
    return NextResponse.json(
      { error: "Failed to send reminder: " + (err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
