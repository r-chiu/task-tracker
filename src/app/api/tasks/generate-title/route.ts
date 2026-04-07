import { NextResponse } from "next/server";
import { aiGenerateTitle } from "@/lib/ai-parser";
import { generateTitle } from "@/lib/slack-parser";

export async function POST(req: Request) {
  const { text } = await req.json();
  if (!text?.trim()) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }

  // Try AI first, fall back to regex
  const aiTitle = await aiGenerateTitle(text);
  const title = aiTitle || generateTitle(text);

  return NextResponse.json({ title, source: aiTitle ? "ai" : "regex" });
}
