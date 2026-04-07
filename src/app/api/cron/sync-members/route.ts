import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { fetchSlackMembers } from "@/lib/slack";

export async function GET(req: Request) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const members = await fetchSlackMembers();
  const now = new Date();

  for (const member of members) {
    await prisma.slackMember.upsert({
      where: { slackId: member.slackId },
      update: {
        displayName: member.displayName,
        realName: member.realName,
        email: member.email,
        isBot: member.isBot,
        isActive: true,
        lastSyncedAt: now,
      },
      create: {
        slackId: member.slackId,
        displayName: member.displayName,
        realName: member.realName,
        email: member.email,
        isBot: member.isBot,
        lastSyncedAt: now,
      },
    });
  }

  return NextResponse.json({ synced: members.length });
}
