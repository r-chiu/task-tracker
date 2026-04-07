import { NextResponse } from "next/server";
import { aiParseText } from "@/lib/ai-parser";
import { parseSlackMessage, generateTitle } from "@/lib/slack-parser";

export async function POST(req: Request) {
  const { text } = await req.json();
  if (!text?.trim()) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }

  // Try AI-powered parsing first
  const aiItems = await aiParseText(text);
  if (aiItems && aiItems.length > 0) {
    // Convert to the format consumers expect
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
    return NextResponse.json({ items, parser: "ai" });
  }

  // AI returned empty or unavailable — check if it returned [] (no action items)
  if (aiItems !== null && aiItems.length === 0) {
    return NextResponse.json({ items: [], parser: "ai" });
  }

  // Fall back to regex-based parser
  const items = parseSlackMessage(text);
  return NextResponse.json({ items, parser: "regex" });
}
