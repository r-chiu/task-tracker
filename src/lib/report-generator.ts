import { prisma } from "./prisma";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { TAIPEI_TIMEZONE, STATUS_LABELS, PRIORITY_LABELS } from "./constants";
import { humanizeSlackText } from "./task-utils";

export async function generateWeeklyReport() {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const [openTasks, overdueTasks, approachingTasks, recentlyCompleted, revisedTasks] =
    await Promise.all([
      prisma.task.findMany({
        where: { status: { in: ["ACTIVE", "WAITING_ON_OTHERS"] } },
        include: { owner: { select: { name: true, email: true } } },
        orderBy: { deadline: "asc" },
      }),
      prisma.task.findMany({
        where: { isOverdue: true },
        include: { owner: { select: { name: true, email: true } } },
        orderBy: { deadline: "asc" },
      }),
      prisma.task.findMany({
        where: {
          status: { in: ["ACTIVE", "WAITING_ON_OTHERS"] },
          deadline: { gte: now, lte: threeDaysFromNow },
          isOverdue: false,
        },
        include: { owner: { select: { name: true, email: true } } },
        orderBy: { deadline: "asc" },
      }),
      prisma.task.findMany({
        where: { status: "COMPLETED", completionDate: { gte: oneWeekAgo } },
        include: { owner: { select: { name: true, email: true } } },
      }),
      prisma.task.findMany({
        where: { revisedDeadline: { not: null }, updatedAt: { gte: oneWeekAgo } },
        include: { owner: { select: { name: true, email: true } } },
      }),
    ]);

  const formatDate = (d: Date) =>
    format(toZonedTime(d, TAIPEI_TIMEZONE), "yyyy-MM-dd");
  const ownerName = (o: { name: string | null; email: string }) =>
    o.name || o.email;

  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Weekly Task Summary - ${formatDate(now)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Open:* ${openTasks.length} | *Overdue:* ${overdueTasks.length} | *Due Soon:* ${approachingTasks.length} | *Completed This Week:* ${recentlyCompleted.length}`,
      },
    },
    { type: "divider" },
  ];

  if (overdueTasks.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Overdue Tasks:*\n" +
          (await Promise.all(overdueTasks
            .slice(0, 10)
            .map(async (t) =>
                `- ${await humanizeSlackText(t.title || t.description.slice(0, 80))} (${ownerName(t.owner)}, due ${formatDate(t.deadline)})`
            ))).join("\n"),
      },
    });
    blocks.push({ type: "divider" });
  }

  if (approachingTasks.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Approaching Deadline:*\n" +
          (await Promise.all(approachingTasks
            .slice(0, 10)
            .map(async (t) =>
                `- ${await humanizeSlackText(t.title || t.description.slice(0, 80))} (${ownerName(t.owner)}, due ${formatDate(t.deadline)})`
            ))).join("\n"),
      },
    });
    blocks.push({ type: "divider" });
  }

  if (recentlyCompleted.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Completed This Week:*\n" +
          (await Promise.all(recentlyCompleted
            .slice(0, 10)
            .map(async (t) =>
                `- ${await humanizeSlackText(t.title || t.description.slice(0, 80))} (${ownerName(t.owner)})`
            ))).join("\n"),
      },
    });
    blocks.push({ type: "divider" });
  }

  if (revisedTasks.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Revised Deadlines:*\n" +
          (await Promise.all(revisedTasks
            .slice(0, 10)
            .map(async (t) =>
                `- ${await humanizeSlackText(t.title || t.description.slice(0, 80))} (${ownerName(t.owner)}, new deadline: ${formatDate(t.revisedDeadline!)})`
            ))).join("\n"),
      },
    });
  }

  const summaryText = `Weekly Summary: ${openTasks.length} open, ${overdueTasks.length} overdue, ${approachingTasks.length} due soon, ${recentlyCompleted.length} completed this week.`;

  return { text: summaryText, blocks };
}
