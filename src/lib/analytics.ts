import { prisma } from "./prisma";
import { startOfYear } from "date-fns";
import { isTaskOverdue } from "./task-utils";

export interface PersonMetrics {
  userId: string;
  userName: string;
  totalAssigned: number;
  completed: number;
  completedOnTime: number;
  completedLate: number;
  currentlyOverdue: number;
  totalExtensions: number;      // total number of extensions across all tasks
  tasksWithExtensions: number;  // how many tasks needed at least one extension
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

    // On Time = completed within effective deadline (revised if extended, otherwise original)
    const completedOnTime = ownerTasks.filter((t) => {
      if (t.status !== "COMPLETED" || !t.completionDate) return false;
      const effectiveDeadline = t.revisedDeadline ?? t.originalDeadline;
      return t.completionDate <= effectiveDeadline;
    }).length;
    const completedLate = completed - completedOnTime;
    const currentlyOverdue = ownerTasks.filter((t) => isTaskOverdue(t)).length;

    // Extension tracking
    const totalExtensions = ownerTasks.reduce((sum, t) => sum + t.extensions.length, 0);
    const tasksWithExtensions = ownerTasks.filter((t) => t.extensions.length > 0).length;

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
      totalExtensions,
      tasksWithExtensions,
      fulfillmentRate: Math.round(fulfillmentRate * 10) / 10,
      onTimeRate: Math.round(onTimeRate * 10) / 10,
    });
  }

  return results.sort((a, b) => b.totalAssigned - a.totalAssigned);
}

export async function getTeamMetrics(since?: Date) {
  const where: Record<string, unknown> = {};
  if (since) where.createdAt = { gte: since };

  const [activeTasks, completedCount] = await Promise.all([
    prisma.task.findMany({
      where: { ...where, status: { in: ["ACTIVE", "WAITING_ON_OTHERS"] } },
      select: { status: true, deadline: true, revisedDeadline: true },
    }),
    prisma.task.count({ where: { ...where, status: "COMPLETED" } }),
  ]);

  const totalActive = activeTasks.length;
  const overdueCount = activeTasks.filter((t) => isTaskOverdue(t)).length;

  return { totalActive, overdueCount, completedCount };
}

export async function getYearlyMetrics(ownerId?: string, yearStart?: Date) {
  return getPersonMetrics(ownerId, yearStart || startOfYear(new Date()));
}

export async function getLifetimeMetrics(ownerId?: string) {
  return getPersonMetrics(ownerId);
}
