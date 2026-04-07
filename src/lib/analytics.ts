import { prisma } from "./prisma";
import { startOfYear } from "date-fns";

export interface PersonMetrics {
  userId: string;
  userName: string;
  totalAssigned: number;
  completed: number;
  completedOnTime: number;
  completedLate: number;
  currentlyOverdue: number;
  extendedBeforeDeadline: number;
  extendedAfterDeadline: number;
  fulfillmentRate: number;
  onTimeRate: number;
}

export async function getPersonMetrics(
  ownerId?: string,
  since?: Date
): Promise<PersonMetrics[]> {
  const where: Record<string, unknown> = {};
  if (ownerId) where.ownerId = ownerId;
  if (since) where.createdAt = { gte: since };

  const tasks = await prisma.task.findMany({
    where,
    include: {
      owner: { select: { id: true, name: true, email: true } },
      extensions: true,
    },
  });

  const byOwner = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const key = task.ownerId;
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key)!.push(task);
  }

  const results: PersonMetrics[] = [];
  for (const [userId, ownerTasks] of byOwner) {
    const owner = ownerTasks[0].owner;
    const totalAssigned = ownerTasks.length;
    const completed = ownerTasks.filter((t) => t.status === "COMPLETED").length;
    const completedOnTime = ownerTasks.filter(
      (t) =>
        t.status === "COMPLETED" &&
        t.completionDate &&
        t.completionDate <= t.originalDeadline
    ).length;
    const completedLate = completed - completedOnTime;
    const currentlyOverdue = ownerTasks.filter((t) => t.isOverdue).length;

    const extendedBeforeDeadline = ownerTasks.filter((t) =>
      t.extensions.some((e) => e.createdAt <= t.originalDeadline)
    ).length;
    const extendedAfterDeadline = ownerTasks.filter((t) =>
      t.extensions.some((e) => e.createdAt > t.originalDeadline)
    ).length;

    const fulfillmentRate =
      totalAssigned > 0 ? (completed / totalAssigned) * 100 : 0;
    const onTimeRate =
      completed > 0 ? (completedOnTime / completed) * 100 : 0;

    results.push({
      userId,
      userName: owner.name || owner.email,
      totalAssigned,
      completed,
      completedOnTime,
      completedLate,
      currentlyOverdue,
      extendedBeforeDeadline,
      extendedAfterDeadline,
      fulfillmentRate: Math.round(fulfillmentRate * 10) / 10,
      onTimeRate: Math.round(onTimeRate * 10) / 10,
    });
  }

  return results.sort((a, b) => b.totalAssigned - a.totalAssigned);
}

export async function getTeamMetrics(since?: Date) {
  const where: Record<string, unknown> = {};
  if (since) where.createdAt = { gte: since };

  const [totalActive, overdueCount, completedCount] = await Promise.all([
    prisma.task.count({
      where: { ...where, status: { in: ["NOT_STARTED", "IN_PROGRESS", "WAITING_ON_OTHERS"] } },
    }),
    prisma.task.count({ where: { ...where, isOverdue: true } }),
    prisma.task.count({ where: { ...where, status: "COMPLETED" } }),
  ]);

  return { totalActive, overdueCount, completedCount };
}

export async function getYearlyMetrics(ownerId?: string, yearStart?: Date) {
  return getPersonMetrics(ownerId, yearStart || startOfYear(new Date()));
}

export async function getLifetimeMetrics(ownerId?: string) {
  return getPersonMetrics(ownerId);
}
