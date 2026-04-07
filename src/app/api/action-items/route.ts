import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

/** Create a stable hash from action item text for dedup */
function hashContent(text: string): string {
  // Normalize: lowercase, collapse whitespace, trim
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

/**
 * GET /api/action-items?hashes=hash1,hash2,...
 * Returns which of the provided hashes are already dismissed/used.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hashesParam = searchParams.get("hashes");

  if (!hashesParam) {
    // Return all dismissed items
    const items = await prisma.dismissedActionItem.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ items });
  }

  const hashes = hashesParam.split(",").filter(Boolean);
  const dismissed = await prisma.dismissedActionItem.findMany({
    where: { contentHash: { in: hashes } },
    select: { contentHash: true, reason: true },
  });

  const dismissedMap: Record<string, string> = {};
  for (const d of dismissed) {
    dismissedMap[d.contentHash] = d.reason;
  }

  return NextResponse.json({ dismissed: dismissedMap });
}

/**
 * POST /api/action-items
 * Mark action item(s) as used or dismissed.
 * Body: { items: [{ description, reason, taskId?, channel? }] }
 */
export async function POST(req: Request) {
  const { items } = await req.json();

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }

  let createdCount = 0;
  for (const item of items as { description: string; reason?: string; taskId?: string; channel?: string }[]) {
    const hash = hashContent(item.description);
    // Skip if already exists
    const existing = await prisma.dismissedActionItem.findFirst({
      where: { contentHash: hash },
    });
    if (existing) continue;

    await prisma.dismissedActionItem.create({
      data: {
        contentHash: hash,
        description: item.description.slice(0, 2000),
        reason: item.reason || "dismissed",
        taskId: item.taskId || null,
        channel: item.channel || null,
      },
    });
    createdCount++;
  }

  return NextResponse.json({ created: createdCount });
}

/**
 * DELETE /api/action-items?hash=xxx
 * Restore a dismissed item (remove it from the dismissed list).
 */
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const hash = searchParams.get("hash");

  if (!hash) {
    return NextResponse.json({ error: "hash parameter is required" }, { status: 400 });
  }

  await prisma.dismissedActionItem.deleteMany({
    where: { contentHash: hash },
  });

  return NextResponse.json({ ok: true });
}

// Export the hash function for use by other modules
export { hashContent };
