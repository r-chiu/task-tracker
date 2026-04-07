import { NextResponse } from "next/server";
import { aiParseText, aiGenerateTitle } from "@/lib/ai-parser";
import { parseSlackMessage } from "@/lib/slack-parser";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

function hashContent(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

async function isDismissed(description: string, allDismissed: { contentHash: string; description: string }[]): Promise<boolean> {
  const hash = hashContent(description);
  if (allDismissed.some((d) => d.contentHash === hash)) return true;
  const normalized = description.toLowerCase().replace(/\s+/g, " ").trim();
  for (const d of allDismissed) {
    const dNorm = d.description.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalized.includes(dNorm) || dNorm.includes(normalized)) return true;
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
  const { text } = await req.json();
  if (!text?.trim()) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let items: any[];
  let parser: string;

  // Try AI-powered parsing first
  const aiItems = await aiParseText(text);
  if (aiItems && aiItems.length > 0) {
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
  } else if (aiItems !== null && aiItems.length === 0) {
    return NextResponse.json({ items: [], parser: "ai" });
  } else {
    items = parseSlackMessage(text);
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

  // Filter out dismissed/used items server-side
  const allDismissed = await prisma.dismissedActionItem.findMany({
    select: { contentHash: true, description: true },
    take: 1000,
  });
  const filtered = [];
  for (const item of items) {
    if (!(await isDismissed((item.description as string) || "", allDismissed))) {
      filtered.push(item);
    }
  }

  return NextResponse.json({ items: filtered, parser });
}
