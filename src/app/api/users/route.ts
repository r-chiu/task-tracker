import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatDisplayName } from "@/lib/name-utils";

export async function GET() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      slackId: true,
      slackDisplayName: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(users);
}

/** Create a system user from a Slack member (auto-provision) */
export async function POST(req: Request) {
  const { slackId, name, email, slackDisplayName } = await req.json();
  if (!slackId) return NextResponse.json({ error: "slackId required" }, { status: 400 });

  // Check if a user with this slackId already exists
  const existing = await prisma.user.findFirst({
    where: { OR: [{ slackId }, ...(email ? [{ email }] : [])] },
    select: { id: true, email: true, name: true, slackId: true },
  });
  if (existing) {
    // Link slackId if not yet linked
    if (!existing.slackId) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { slackId, slackDisplayName: slackDisplayName || null },
      });
    }
    return NextResponse.json(existing);
  }

  // Auto-create with VIEWER role (no real access — just a trackable record)
  const rawName = name || slackDisplayName || slackId;
  const properName = formatDisplayName(rawName, email);
  const user = await prisma.user.create({
    data: {
      email: email || `${slackId}@slack.local`,
      name: properName,
      slackId,
      slackDisplayName: slackDisplayName || null,
      role: "VIEWER",
    },
    select: { id: true, email: true, name: true, slackId: true },
  });
  return NextResponse.json(user, { status: 201 });
}

export async function PUT(req: Request) {
  const { userId, role, slackId, email, name } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (role && ["ADMIN", "MANAGER", "VIEWER"].includes(role)) data.role = role;
  if (slackId !== undefined) {
    data.slackId = slackId || null;
    // Auto-populate slackDisplayName from SlackMember table when linking
    if (slackId) {
      const member = await prisma.slackMember.findUnique({ where: { slackId } });
      if (member) {
        data.slackDisplayName = member.displayName || member.realName || null;
      }
    } else {
      data.slackDisplayName = null;
    }
  }
  if (email !== undefined) data.email = email;
  if (name !== undefined) data.name = name || null;

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, email: true, name: true, role: true, slackId: true, slackDisplayName: true },
  });
  return NextResponse.json(user);
}
