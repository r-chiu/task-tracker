import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchSlackMembers } from "@/lib/slack";
import { formatDisplayName } from "@/lib/name-utils";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const all = searchParams.get("all") === "1";

  const members = await prisma.slackMember.findMany({
    where: all ? {} : { isActive: true, isBot: false },
    orderBy: { realName: "asc" },
  });
  return NextResponse.json(members);
}

export async function POST() {
  const members = await fetchSlackMembers();
  const now = new Date();

  // Upsert all Slack members
  for (const member of members) {
    await prisma.slackMember.upsert({
      where: { slackId: member.slackId },
      update: {
        displayName: member.displayName,
        realName: member.realName,
        email: member.email,
        isBot: member.isBot,
        isActive: member.isActive,
        lastSyncedAt: now,
      },
      create: {
        slackId: member.slackId,
        displayName: member.displayName,
        realName: member.realName,
        email: member.email,
        isBot: member.isBot,
        isActive: member.isActive,
        lastSyncedAt: now,
      },
    });
  }

  // Also update linked User records: backfill slackDisplayName + format names
  const activeMembersBySlackId = new Map(
    members
      .filter((m) => m.isActive && !m.isBot)
      .map((m) => [m.slackId, m])
  );

  const linkedUsers = await prisma.user.findMany({
    where: { slackId: { not: null } },
    select: { id: true, name: true, slackId: true, slackDisplayName: true },
  });

  let namesUpdated = 0;
  for (const user of linkedUsers) {
    if (!user.slackId) continue;
    const member = activeMembersBySlackId.get(user.slackId);
    if (!member) continue;

    const updates: Record<string, string | null> = {};

    // Backfill slackDisplayName
    const displayName = member.displayName || member.realName || null;
    if (displayName && !user.slackDisplayName) {
      updates.slackDisplayName = displayName;
    }

    // Format name if it's still a raw handle (no space)
    const currentName = user.name || "";
    if (!currentName.includes(" ")) {
      const rawName = member.realName || member.displayName || user.slackId;
      const properName = formatDisplayName(rawName, member.email);
      if (properName.includes(" ")) {
        updates.name = properName;
        namesUpdated++;
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: updates,
      });
    }
  }

  return NextResponse.json({ synced: members.length, namesUpdated });
}
