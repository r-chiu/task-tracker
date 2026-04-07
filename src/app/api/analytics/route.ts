import { NextResponse } from "next/server";
import { getYearlyMetrics, getLifetimeMetrics, getTeamMetrics } from "@/lib/analytics";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ownerId = searchParams.get("ownerId") || undefined;
  const period = searchParams.get("period") || "yearly";
  const yearParam = searchParams.get("year");

  // Determine start of year — use selected year or current year
  const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();
  const yearStart = new Date(year, 0, 1);

  const [personMetrics, teamMetrics] = await Promise.all([
    period === "yearly"
      ? getYearlyMetrics(ownerId, yearStart)
      : getLifetimeMetrics(ownerId),
    getTeamMetrics(period === "yearly" ? yearStart : undefined),
  ]);

  return NextResponse.json({ personMetrics, teamMetrics });
}
