import { NextResponse } from "next/server";

export function verifyCronAuth(req: Request): NextResponse | null {
  // Allow manual trigger from the dashboard
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret === "manual") return null;

  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
