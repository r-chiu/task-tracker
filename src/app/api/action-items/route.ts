import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

/** Create a stable hash from action item text for dedup */
function hashContent(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

/**
 * GET /api/action-items?hashes=hash1,hash2,...&descriptions=desc1|||desc2|||...
 * Returns which of the provided hashes are already dismissed/used.
 * Also does fuzzy matching against stored descriptions if exact hash doesn't match.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hashesParam = searchParams.get("hashes");

  if (!hashesParam) {
    const items = await prisma.dismissedActionItem.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ items });
  }

  const hashes = hashesParam.split(",").filter(Boolean);

  // Exact hash match
  const dismissed = await prisma.dismissedActionItem.findMany({
    where: { contentHash: { in: hashes } },
    select: { contentHash: true, reason: true },
  });

  const dismissedMap: Record<string, string> = {};
  for (const d of dismissed) {
    dismissedMap[d.contentHash] = d.reason;
  }

  // If some hashes didn't match, try fuzzy matching with descriptions
  const unmatchedHashes = hashes.filter((h) => !dismissedMap[h]);
  if (unmatchedHashes.length > 0) {
    const descriptionsParam = searchParams.get("descriptions");
    if (descriptionsParam) {
      const descriptions = descriptionsParam.split("|||");
      // Load all dismissed items for fuzzy comparison
      const allDismissed = await prisma.dismissedActionItem.findMany({
        select: { description: true, reason: true },
        take: 1000,
      });

      // For each unmatched item, check if its description fuzzy-matches any dismissed item
      for (let i = 0; i < hashes.length; i++) {
        if (dismissedMap[hashes[i]]) continue; // Already matched
        const desc = descriptions[i];
        if (!desc) continue;
        const normalizedDesc = desc.toLowerCase().replace(/\s+/g, " ").trim();

        for (const dismissed of allDismissed) {
          const normalizedDismissed = dismissed.description.toLowerCase().replace(/\s+/g, " ").trim();

          // Check if one contains the other (handles AI rewording)
          // Or if they share a long common substring (>60% of shorter text)
          if (
            normalizedDesc.includes(normalizedDismissed) ||
            normalizedDismissed.includes(normalizedDesc) ||
            fuzzyMatch(normalizedDesc, normalizedDismissed, 0.6)
          ) {
            dismissedMap[hashes[i]] = dismissed.reason;
            break;
          }
        }
      }
    }
  }

  return NextResponse.json({ dismissed: dismissedMap });
}

/**
 * Fuzzy match: check if two strings share enough common words.
 * Returns true if the ratio of shared words exceeds the threshold.
 */
function fuzzyMatch(a: string, b: string, threshold: number): boolean {
  const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared++;
  }

  const smaller = Math.min(wordsA.size, wordsB.size);
  return shared / smaller >= threshold;
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

export { hashContent };
