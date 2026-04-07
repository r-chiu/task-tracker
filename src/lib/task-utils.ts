import { prisma } from "./prisma";
import { ACTIVE_STATUSES, TaskStatus } from "./constants";

// --- Slack ID humanization (server-side) ---

let slackNameCache: Map<string, string> | null = null;
let slackNameCacheTime = 0;
const SLACK_NAME_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getSlackNameMap(): Promise<Map<string, string>> {
  if (slackNameCache && Date.now() - slackNameCacheTime < SLACK_NAME_CACHE_TTL) {
    return slackNameCache;
  }
  const members = await prisma.slackMember.findMany({
    select: { slackId: true, displayName: true, realName: true },
  });
  const map = new Map<string, string>();
  for (const m of members) {
    const name = m.displayName || m.realName;
    if (name) map.set(m.slackId, name);
  }
  slackNameCache = map;
  slackNameCacheTime = Date.now();
  return map;
}

/** Replace all <@UXXXX> Slack mentions in text with @displayName using DB lookup */
export async function humanizeSlackText(text: string): Promise<string> {
  if (!text || !text.includes("<@")) return text;
  const nameMap = await getSlackNameMap();
  return text.replace(/<@(\w+)>/g, (match, userId) => {
    const name = nameMap.get(userId);
    return name ? `@${name}` : match;
  });
}

/** Humanize Slack mentions in all text fields of a task object */
export async function humanizeTask<T extends Record<string, unknown>>(task: T): Promise<T> {
  const result = { ...task } as Record<string, unknown>;
  if (typeof result.title === "string") result.title = await humanizeSlackText(result.title);
  if (typeof result.description === "string") result.description = await humanizeSlackText(result.description);
  if (typeof result.notes === "string") result.notes = await humanizeSlackText(result.notes);
  return result as T;
}

/** Humanize an array of tasks */
export async function humanizeTasks<T extends Record<string, unknown>>(tasks: T[]): Promise<T[]> {
  return Promise.all(tasks.map(humanizeTask));
}

export function getEffectiveDeadline(task: { deadline: Date; revisedDeadline: Date | null }): Date {
  return task.revisedDeadline ?? task.deadline;
}

export function isTaskOverdue(task: { status: string; deadline: Date; revisedDeadline: Date | null }): boolean {
  if (!ACTIVE_STATUSES.includes(task.status as TaskStatus)) return false;
  const effective = getEffectiveDeadline(task);
  return new Date() > effective;
}

export function shouldSendFollowUp(
  task: { lastFollowUp: Date | null; status: string; deadline: Date; revisedDeadline: Date | null },
  intervalDays: number = 4
): boolean {
  if (!isTaskOverdue(task)) return false;
  if (!task.lastFollowUp) return true;

  const daysSinceFollowUp =
    (Date.now() - task.lastFollowUp.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceFollowUp >= intervalDays;
}

export async function recordTaskChange(
  taskId: string,
  userId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  note?: string
) {
  return prisma.taskHistory.create({
    data: { taskId, userId, field, oldValue, newValue, note },
  });
}
