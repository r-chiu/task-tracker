import { NextResponse } from "next/server";
import { listChannels } from "@/lib/slack";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const forceRefresh = searchParams.get("refresh") === "1";
    const channels = await listChannels(forceRefresh);
    return NextResponse.json(channels);
  } catch (err) {
    console.error("Failed to list Slack channels:", err);
    return NextResponse.json(
      { error: "Failed to list Slack channels. Check SLACK_BOT_TOKEN." },
      { status: 500 }
    );
  }
}
