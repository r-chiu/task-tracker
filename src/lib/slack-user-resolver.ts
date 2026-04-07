import { prisma } from "@/lib/prisma";
import { formatDisplayName } from "@/lib/name-utils";

/**
 * Resolve a Slack user ID to a system User record.
 *
 * Matching logic:
 *   1. Direct match on User.slackId
 *   2. Look up SlackMember → match User by email
 *   3. Look up SlackMember → match User by name
 *   4. Auto-create User from SlackMember info
 *   5. If no SlackMember exists, create a minimal placeholder
 *
 * Always returns a valid system user ID.
 */
export async function resolveSlackUser(
  slackId: string
): Promise<{ userId: string; userName: string }> {
  // 1. Direct match on User.slackId
  const bySlackId = await prisma.user.findFirst({
    where: { slackId },
    select: { id: true, name: true, email: true },
  });
  if (bySlackId) {
    return { userId: bySlackId.id, userName: bySlackId.name || bySlackId.email };
  }

  // Look up SlackMember for more info
  const member = await prisma.slackMember.findUnique({
    where: { slackId },
  });

  if (member) {
    // 2. Match User by email
    if (member.email) {
      const byEmail = await prisma.user.findFirst({
        where: { email: { equals: member.email } },
        select: { id: true, name: true, email: true },
      });
      if (byEmail) {
        // Link slackId to existing user
        await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            slackId,
            slackDisplayName: member.displayName || member.realName || null,
          },
        });
        return { userId: byEmail.id, userName: byEmail.name || byEmail.email };
      }
    }

    // 3. Match User by name
    const memberName = (member.displayName || member.realName || "").toLowerCase();
    if (memberName) {
      const allUsers = await prisma.user.findMany({
        where: { slackId: null },
        select: { id: true, name: true, email: true },
      });
      const byName = allUsers.find(
        (u) =>
          u.name?.toLowerCase() === memberName ||
          u.email.split("@")[0].toLowerCase() === memberName
      );
      if (byName) {
        await prisma.user.update({
          where: { id: byName.id },
          data: {
            slackId,
            slackDisplayName: member.displayName || member.realName || null,
          },
        });
        return { userId: byName.id, userName: byName.name || byName.email };
      }
    }

    // 4. Auto-create User from SlackMember info
    const rawName = member.realName || member.displayName || slackId;
    const properName = formatDisplayName(rawName, member.email);
    const newUser = await prisma.user.create({
      data: {
        email: member.email || `${slackId}@slack.local`,
        name: properName,
        slackId,
        slackDisplayName: member.displayName || member.realName || null,
        role: "VIEWER",
        isActive: true,
      },
      select: { id: true, name: true, email: true },
    });
    return { userId: newUser.id, userName: newUser.name || newUser.email };
  }

  // 5. No SlackMember record — create a minimal placeholder user
  const placeholderUser = await prisma.user.create({
    data: {
      email: `${slackId}@slack.local`,
      name: slackId,
      slackId,
      role: "VIEWER",
      isActive: true,
    },
    select: { id: true, name: true, email: true },
  });
  return { userId: placeholderUser.id, userName: placeholderUser.name || slackId };
}
