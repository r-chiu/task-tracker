import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const SETTING_KEY = "cached_action_items";

/**
 * GET /api/action-items/cache
 * Returns cached action items from the last detection run.
 */
export async function GET() {
  const setting = await prisma.appSetting.findUnique({
    where: { key: SETTING_KEY },
  });

  if (!setting) {
    return NextResponse.json({ items: [], cachedAt: null });
  }

  try {
    const data = JSON.parse(setting.value);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ items: [], cachedAt: null });
  }
}

/**
 * PUT /api/action-items/cache
 * Save detected action items to cache.
 * Body: { items: any[] }
 */
export async function PUT(req: Request) {
  const { items } = await req.json();

  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }

  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    update: {
      value: JSON.stringify({ items, cachedAt: new Date().toISOString() }),
      updatedAt: new Date(),
    },
    create: {
      key: SETTING_KEY,
      value: JSON.stringify({ items, cachedAt: new Date().toISOString() }),
    },
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/action-items/cache
 * Clear the cache.
 */
export async function DELETE() {
  await prisma.appSetting.deleteMany({ where: { key: SETTING_KEY } });
  return NextResponse.json({ ok: true });
}
