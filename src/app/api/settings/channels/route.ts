import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const SETTING_KEY = "selected_channels";

/**
 * GET /api/settings/channels
 * Returns the shared channel selection (channel IDs + names).
 */
export async function GET() {
  const setting = await prisma.appSetting.findUnique({
    where: { key: SETTING_KEY },
  });

  if (!setting) {
    return NextResponse.json({ ids: [], names: [] });
  }

  try {
    const data = JSON.parse(setting.value);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ ids: [], names: [] });
  }
}

/**
 * PUT /api/settings/channels
 * Save the shared channel selection.
 * Body: { ids: string[], names: string[] }
 */
export async function PUT(req: Request) {
  const { ids, names } = await req.json();

  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  }

  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    update: {
      value: JSON.stringify({ ids, names: names || [] }),
      updatedAt: new Date(),
    },
    create: {
      key: SETTING_KEY,
      value: JSON.stringify({ ids, names: names || [] }),
    },
  });

  return NextResponse.json({ ok: true });
}
