import { NextResponse } from "next/server";
import { parseSlackMessage } from "@/lib/slack-parser";

export async function POST(req: Request) {
  const { text } = await req.json();
  if (!text?.trim()) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }
  const items = parseSlackMessage(text);
  return NextResponse.json({ items });
}
