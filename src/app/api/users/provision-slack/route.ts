import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatDisplayName } from "@/lib/name-utils";

/**
 * POST /api/users/provision-slack
 *
 * Bulk-provisions system User accounts for all active, non-bot Slack members
 * that don't already have a corresponding User record.
 *
 * Matching logic:
 *   1. Existing User with same slackId → backfill display name + format name
 *   2. Existing User with same email → link slackId + update display name + format name
 *   3. No match → create new User with VIEWER role and properly formatted name
 */
export async function POST() {
  // Fetch all active, non-bot Slack members
  const slackMembers = await prisma.slackMember.findMany({
    where: { isActive: true, isBot: false },
  });

  // Fetch all existing users for matching
  const existingUsers = await prisma.user.findMany({
    select: { id: true, email: true, name: true, slackId: true },
  });

  const usersBySlackId = new Map(
    existingUsers.filter((u) => u.slackId).map((u) => [u.slackId!, u])
  );
  const usersByEmail = new Map(
    existingUsers.map((u) => [u.email.toLowerCase(), u])
  );

  let created = 0;
  let linked = 0;
  let skipped = 0;

  for (const member of slackMembers) {
    const displayName = member.displayName || member.realName || null;
    const rawName = member.realName || member.displayName || member.slackId;
    const properName = formatDisplayName(rawName, member.email);

    // 1. Already has a User with this slackId — backfill display name & format name
    const existingBySlack = usersBySlackId.get(member.slackId);
    if (existingBySlack) {
      const updates: Record<string, string | null> = {};
      if (displayName) updates.slackDisplayName = displayName;
      // Update name if it's still a raw handle (no space) and we can improve it
      const currentName = existingBySlack.name || "";
      if (!currentName.includes(" ") && properName.includes(" ")) {
        updates.name = properName;
      }
      if (Object.keys(updates).length > 0) {
        await prisma.user.update({
          where: { id: existingBySlack.id },
          data: updates,
        });
      }
      skipped++;
      continue;
    }

    // 2. Match by email → link slackId + format name
    if (member.email) {
      const byEmail = usersByEmail.get(member.email.toLowerCase());
      if (byEmail) {
        const updates: Record<string, string | null> = {
          slackId: member.slackId,
          slackDisplayName: displayName,
        };
        const currentName = byEmail.name || "";
        if (!currentName.includes(" ") && properName.includes(" ")) {
          updates.name = properName;
        }
        await prisma.user.update({
          where: { id: byEmail.id },
          data: updates,
        });
        usersBySlackId.set(member.slackId, byEmail);
        linked++;
        continue;
      }
    }

    // 3. Create new User with properly formatted name
    const newUser = await prisma.user.create({
      data: {
        email: member.email || `${member.slackId}@slack.local`,
        name: properName,
        slackId: member.slackId,
        slackDisplayName: displayName,
        role: "VIEWER",
        isActive: true,
      },
      select: { id: true, email: true, name: true, slackId: true },
    });

    usersBySlackId.set(member.slackId, newUser);
    usersByEmail.set(newUser.email.toLowerCase(), newUser);
    created++;
  }

  return NextResponse.json({
    total: slackMembers.length,
    created,
    linked,
    skipped,
  });
}
