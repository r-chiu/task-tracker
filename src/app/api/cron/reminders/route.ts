import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { sendSlackDM, buildReminderBlocks, buildOverdueBlocks } from "@/lib/slack";
import { isTaskOverdue, shouldSendFollowUp, getEffectiveDeadline, humanizeSlackText } from "@/lib/task-utils";
import { PRIORITY_LABELS, TaskPriority } from "@/lib/constants";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

export async function GET(req: Request) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const TAIPEI = "Asia/Taipei";

  // 1. Pre-deadline reminders: tasks due in ~3 days
  const upcomingTasks = await prisma.task.findMany({
    where: {
      status: { in: ["ACTIVE", "WAITING_ON_OTHERS"] },
      deadline: { gte: now, lte: threeDaysFromNow },
      isOverdue: false,
    },
    include: {
      owner: { select: { name: true, email: true, slackId: true } },
    },
  });

  let remindersSent = 0;
  for (const task of upcomingTasks) {
    if (!task.owner.slackId) continue;
    try {
      const humanTitle = await humanizeSlackText(task.title);
      const humanDesc = await humanizeSlackText(task.description);
      const blocks = buildReminderBlocks({
        id: task.id,
        title: humanTitle,
        description: humanDesc,
        ownerName: task.owner.name || task.owner.email,
        deadline: format(toZonedTime(getEffectiveDeadline(task), TAIPEI), "yyyy-MM-dd"),
        priority: PRIORITY_LABELS[task.priority as TaskPriority],
      });
      const taskLabel = humanTitle || humanDesc.slice(0, 100);
      await sendSlackDM(
        task.owner.slackId,
        `Reminder: "${taskLabel}" is due in 3 days.`,
        blocks
      );
      remindersSent++;
    } catch (err) {
      console.error(`Failed to send reminder for task ${task.id}:`, err);
    }
  }

  // 2. Overdue follow-ups
  const activeTasks = await prisma.task.findMany({
    where: {
      status: { in: ["ACTIVE", "WAITING_ON_OTHERS"] },
    },
    include: {
      owner: { select: { name: true, email: true, slackId: true } },
    },
  });

  let followUpsSent = 0;
  for (const task of activeTasks) {
    const overdue = isTaskOverdue(task);

    // Update overdue flag
    if (overdue && !task.isOverdue) {
      await prisma.task.update({
        where: { id: task.id },
        data: { isOverdue: true, deadlineMissed: true },
      });
    }

    // Send follow-up if needed
    if (overdue && shouldSendFollowUp(task) && task.owner.slackId) {
      const effective = getEffectiveDeadline(task);
      const daysOverdue = Math.floor(
        (now.getTime() - effective.getTime()) / (1000 * 60 * 60 * 24)
      );

      try {
        const humanTitle = await humanizeSlackText(task.title);
        const humanDesc = await humanizeSlackText(task.description);
        const blocks = buildOverdueBlocks({
          id: task.id,
          title: humanTitle,
          description: humanDesc,
          ownerName: task.owner.name || task.owner.email,
          deadline: format(toZonedTime(effective, TAIPEI), "yyyy-MM-dd"),
          priority: PRIORITY_LABELS[task.priority as TaskPriority],
          daysOverdue,
        });
        const taskLabel = humanTitle || humanDesc.slice(0, 100);
        await sendSlackDM(
          task.owner.slackId,
          `Overdue: "${taskLabel}" is ${daysOverdue} days past deadline.`,
          blocks
        );
        await prisma.task.update({
          where: { id: task.id },
          data: { lastFollowUp: now },
        });
        followUpsSent++;
      } catch (err) {
        console.error(`Failed to send follow-up for task ${task.id}:`, err);
      }
    }
  }

  return NextResponse.json({ remindersSent, followUpsSent });
}
