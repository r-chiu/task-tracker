import { NextResponse } from "next/server";
import { fetchChannelMessages } from "@/lib/slack";
import { scoreSlackMessages } from "@/lib/slack-parser";

export async function POST(req: Request) {
  const { channelId, limit } = await req.json();
  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  }

  try {
    const messages = await fetchChannelMessages(channelId, limit || 50);
    const items = scoreSlackMessages(messages);

    return NextResponse.json({
      items,
      messagesScanned: messages.length,
    });
  } catch (err) {
    console.error("Failed to detect action items from Slack:", err);
    return NextResponse.json(
      { error: "Failed to fetch Slack messages. Ensure the bot is in the channel." },
      { status: 500 },
    );
  }
}
