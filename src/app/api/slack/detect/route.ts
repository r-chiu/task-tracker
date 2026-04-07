import { NextResponse } from "next/server";
import { fetchChannelMessages } from "@/lib/slack";
import { aiParseText } from "@/lib/ai-parser";
import { scoreSlackMessages } from "@/lib/slack-parser";

export async function POST(req: Request) {
  const { channelId, limit } = await req.json();
  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  }

  try {
    const messages = await fetchChannelMessages(channelId, limit || 50);

    // Try AI-powered detection: combine messages into text blocks
    if (process.env.ANTHROPIC_API_KEY) {
      const combinedText = messages
        .map((m) => m.text)
        .filter(Boolean)
        .join("\n\n");

      const aiItems = await aiParseText(combinedText);
      if (aiItems !== null) {
        const items = aiItems.map((item) => ({
          description: item.description,
          suggestedOwner: item.suggestedOwner,
          suggestedDeadline: item.suggestedDeadline,
          suggestedPriority: item.suggestedPriority,
          confidence: item.confidence,
          sender: null,
          timestamp: null,
          ownerGroup: null,
          title: item.title,
        }));
        return NextResponse.json({
          items,
          messagesScanned: messages.length,
          parser: "ai",
        });
      }
    }

    // Fall back to regex-based scoring
    const items = scoreSlackMessages(messages);
    return NextResponse.json({
      items,
      messagesScanned: messages.length,
      parser: "regex",
    });
  } catch (err) {
    console.error("Failed to detect action items from Slack:", err);
    return NextResponse.json(
      { error: "Failed to fetch Slack messages. Ensure the bot is in the channel." },
      { status: 500 },
    );
  }
}
