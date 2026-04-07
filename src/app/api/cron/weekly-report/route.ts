import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { generateWeeklyReport } from "@/lib/report-generator";
import { sendSlackDM } from "@/lib/slack";

export async function GET(req: Request) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const raySlackId = process.env.RAY_SLACK_USER_ID;
  if (!raySlackId) {
    return NextResponse.json({ error: "RAY_SLACK_USER_ID not configured" }, { status: 500 });
  }

  const report = await generateWeeklyReport();
  await sendSlackDM(raySlackId, report.text, report.blocks);

  return NextResponse.json({ sent: true });
}
