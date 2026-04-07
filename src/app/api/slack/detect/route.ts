import { NextResponse } from "next/server";
import { fetchChannelMessages } from "@/lib/slack";
import { aiParseText, aiGenerateTitle } from "@/lib/ai-parser";
import { scoreSlackMessages } from "@/lib/slack-parser";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

/** Server-side hash — must match the one in action-items/route.ts */
function hashContent(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

/** Check if an item is dismissed (exact hash or fuzzy match) */
async function isDismissed(description: string, allDismissed: { contentHash: string; description: string }[]): Promise<boolean> {
  const hash = hashContent(description);
  // Exact match
  if (allDismissed.some((d) => d.contentHash === hash)) return true;
  // Fuzzy match
  const normalized = description.toLowerCase().replace(/\s+/g, " ").trim();
  for (const d of allDismissed) {
    const dNorm = d.description.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalized.includes(dNorm) || dNorm.includes(normalized)) return true;
    // Word overlap
    const wordsA = new Set(normalized.split(/\s+/).filter((w) => w.length > 3));
    const wordsB = new Set(dNorm.split(/\s+/).filter((w) => w.length > 3));
    if (wordsA.size > 0 && wordsB.size > 0) {
      let shared = 0;
      for (const w of wordsA) if (wordsB.has(w)) shared++;
      if (shared / Math.min(wordsA.size, wordsB.size) >= 0.6) return true;
    }
  }
  return false;
}

export async function POST(req: Request) {
  const { channelId, limit } = await req.json();
  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  }

  try {
    const messages = await fetchChannelMessages(channelId, limit || 50);

    let items: {
      description: string;
      suggestedOwner: string | null;
      suggestedDeadline: string | null;
      suggestedPriority: string | null;
      confidence: string;
      sender: string | null;
      timestamp: string | null;
      ownerGroup: string | null;
      title?: string;
    }[];
    let parser: string;

    // Try AI-powered detection: combine messages into text blocks
    if (process.env.ANTHROPIC_API_KEY) {
      const combinedText = messages
        .map((m) => m.text)
        .filter(Boolean)
        .join("\n\n");

      const aiItems = await aiParseText(combinedText);
      if (aiItems !== null) {
        items = aiItems.map((item) => ({
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
        parser = "ai";
      } else {
        items = scoreSlackMessages(messages);
        parser = "regex";
      }
    } else {
      items = scoreSlackMessages(messages);
      parser = "regex";
    }

    // Generate AI titles for items that don't have one (regex fallback)
    const needsTitles = items.filter((item) => !item.title);
    if (needsTitles.length > 0) {
      const titleResults = await Promise.allSettled(
        needsTitles.map((item) => aiGenerateTitle(item.description))
      );
      titleResults.forEach((result, idx) => {
        if (result.status === "fulfilled" && result.value) {
          needsTitles[idx].title = result.value;
        }
      });
    }

    // Filter out dismissed/used items server-side (single source of truth)
    const allDismissed = await prisma.dismissedActionItem.findMany({
      select: { contentHash: true, description: true },
      take: 1000,
    });
    const filtered = [];
    for (const item of items) {
      if (!(await isDismissed(item.description, allDismissed))) {
        filtered.push(item);
      }
    }

    return NextResponse.json({
      items: filtered,
      messagesScanned: messages.length,
      parser,
    });
  } catch (err) {
    console.error("Failed to detect action items from Slack:", err);
    return NextResponse.json(
      { error: "Failed to fetch Slack messages. Ensure the bot is in the channel." },
      { status: 500 },
    );
  }
}
