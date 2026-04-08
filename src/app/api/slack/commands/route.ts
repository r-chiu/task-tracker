import { NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack-verify";
import { resolveSlackUser } from "@/lib/slack-user-resolver";
import { slackClient, sendSlackMessage } from "@/lib/slack";
import { buildTaskModal, buildTaskConfirmationBlocks, buildErrorBlocks } from "@/lib/slack-blocks";
import { generateTitle } from "@/lib/slack-parser";
import { aiGenerateTitle } from "@/lib/ai-parser";
import { prisma } from "@/lib/prisma";
import { PRIORITY_LABELS } from "@/lib/constants";

/**
 * Resolve a plain @name (e.g. "@tiffany", "@bensonfan") to a Slack user ID
 * by searching the SlackMember table.
 */
async function resolveNameToSlackId(name: string): Promise<string | null> {
  const lower = name.toLowerCase();

  // Fetch all active non-bot members and do case-insensitive matching in JS
  // (SQLite `equals` is case-sensitive)
  const allMembers = await prisma.slackMember.findMany({
    where: { isActive: true, isBot: false },
    select: { slackId: true, displayName: true, realName: true, email: true },
  });

  // Exact match (case-insensitive) on displayName, realName, or email prefix
  for (const m of allMembers) {
    const dn = (m.displayName || "").toLowerCase();
    const rn = (m.realName || "").toLowerCase();
    const emailPrefix = (m.email || "").split("@")[0].toLowerCase();
    if (dn === lower || rn === lower || emailPrefix === lower) return m.slackId;
    // Also match without spaces/dots (e.g. "timchen" → "Tim Chen", "tim.chen1108" → "timchen1108")
    const lowerClean = lower.replace(/[\s.]+/g, "");
    if (rn.replace(/\s+/g, "") === lowerClean || dn.replace(/[\s.]+/g, "") === lowerClean) return m.slackId;
    if (emailPrefix.replace(/\./g, "") === lowerClean) return m.slackId;
  }

  // Also check system users by name
  const allUsers = await prisma.user.findMany({
    where: { isActive: true, slackId: { not: null } },
    select: { slackId: true, name: true, email: true },
  });
  for (const u of allUsers) {
    if (!u.slackId || !u.name) continue;
    const un = u.name.toLowerCase();
    const ue = (u.email || "").split("@")[0].toLowerCase();
    if (un === lower || un.replace(/\s+/g, "") === lower || un.includes(lower)) return u.slackId;
    if (ue === lower) return u.slackId;
  }

  // Fuzzy: partial/prefix match on displayName, realName, or email prefix
  for (const m of allMembers) {
    const dn = (m.displayName || "").toLowerCase();
    const rn = (m.realName || "").toLowerCase();
    const emailPrefix = (m.email || "").split("@")[0].toLowerCase();
    if (dn.startsWith(lower) || rn.startsWith(lower) || rn.includes(lower) || dn.includes(lower)) return m.slackId;
    if (emailPrefix.startsWith(lower) || lower.startsWith(emailPrefix)) return m.slackId;
  }

  return null;
}

/**
 * POST /api/slack/commands
 *
 * Receives the /task slash command from Slack.
 *
 * Two modes:
 *   1. `/task` (no text) → opens a modal form
 *   2. `/task @owner description text priority:high` → inline creation
 */
export async function POST(req: Request) {
  // Verify Slack signature
  const verification = await verifySlackRequest(req);
  if (!verification.ok) return verification.response;

  // Parse URL-encoded body
  const params = new URLSearchParams(verification.rawBody);
  const text = (params.get("text") || "").trim();
  const triggerId = params.get("trigger_id") || "";
  const userId = params.get("user_id") || "";
  const channelId = params.get("channel_id") || "";
  const channelName = params.get("channel_name") || "";

  // ── Mode 1: No text → open modal ──
  if (!text) {
    try {
      const metadata = JSON.stringify({ channelId, channelName, userId });
      await slackClient.views.open({
        trigger_id: triggerId,
        view: buildTaskModal(metadata) as never,
      });
      // Return empty 200 (Slack shows nothing in the channel)
      return new Response("", { status: 200 });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errData = (err as Record<string, unknown>)?.data;
      console.error("Failed to open modal:", errMsg, errData);
      return NextResponse.json({
        response_type: "ephemeral",
        text: `Failed to open task form: ${errMsg}`,
      });
    }
  }

  // ── Mode 2: Inline text → parse and create ──
  try {
    const parsed = await parseInlineCommand(text);

    // Resolve owner
    if (!parsed.ownerSlackId) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: `Could not find owner in: \`${text}\`\nParsed: ${JSON.stringify({ owner: parsed.ownerSlackId, desc: parsed.description.slice(0, 50) })}\n\nPlease tag an owner: \`/task @someone description\``,
      });
    }

    const owner = await resolveSlackUser(parsed.ownerSlackId);
    const creator = await resolveSlackUser(userId);

    // Default deadline to end of week if not specified
    const deadline = parsed.deadline || getEndOfWeek();

    // Generate smart title
    const title = (await aiGenerateTitle(parsed.description)) || generateTitle(parsed.description);

    // Create the task
    const deadlineDate = new Date(deadline + "T23:59:59.000Z");
    const task = await prisma.task.create({
      data: {
        title,
        description: parsed.description,
        ownerId: owner.userId,
        creatorId: creator.userId,
        deadline: deadlineDate,
        originalDeadline: deadlineDate,
        priority: parsed.priority,
        status: "ACTIVE",
        sourceType: "SLACK_MESSAGE",
        slackChannel: channelName ? `#${channelName}` : null,
      },
    });

    // Record task creation in history
    await prisma.taskHistory.create({
      data: {
        taskId: task.id,
        userId: creator.userId,
        field: "created",
        newValue: "Task created via /task command in Slack",
      },
    });

    // Build confirmation
    const priorityLabel =
      PRIORITY_LABELS[parsed.priority as keyof typeof PRIORITY_LABELS] || parsed.priority;
    const appUrl = process.env.NEXTAUTH_URL || "";
    const blocks = buildTaskConfirmationBlocks({
      title,
      ownerName: owner.userName,
      deadline,
      priority: priorityLabel,
      id: task.id,
      creatorName: creator.userName,
      appUrl,
    });

    // Post confirmation in the channel (visible to everyone)
    try {
      await sendSlackMessage(
        channelId,
        `✅ Task created: ${title} | Owner: ${owner.userName} | Due: ${deadline}`,
        blocks
      );
    } catch {
      // Channel post failed (bot may not be in channel) — that's ok
    }

    // Return ephemeral confirmation to the user
    return NextResponse.json({
      response_type: "ephemeral",
      text: `✅ Task created: *${title}*\nOwner: ${owner.userName} | Due: ${deadline} | Priority: ${priorityLabel}`,
    });
  } catch (err) {
    console.error("Inline task creation error:", err);
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Failed to create task. Please try again.",
      blocks: buildErrorBlocks(
        err instanceof Error ? err.message : "An unexpected error occurred"
      ),
    });
  }
}

// ── Inline text parser ──

interface ParsedCommand {
  ownerSlackId: string | null;
  description: string;
  deadline: string | null;
  priority: string;
}

/**
 * Parse inline /task command text.
 *
 * Format: /task @owner description text priority:level by deadline
 *
 * Examples:
 *   /task @benson Review the Q2 report by Friday priority:high
 *   /task <@U09F123> Fix the login bug by 2026-04-15
 *   /task @ray Prepare demo materials
 */
async function parseInlineCommand(text: string): Promise<ParsedCommand> {
  let remaining = text;

  // 1. Extract priority:level
  let priority = "MEDIUM";
  const priorityMatch = remaining.match(/\bpriority:\s*(low|medium|high|urgent|critical)\b/i);
  if (priorityMatch) {
    const p = priorityMatch[1].toUpperCase();
    priority = p === "CRITICAL" ? "URGENT" : p;
    remaining = remaining.replace(priorityMatch[0], "").trim();
  }

  // Also check shorthand: p:high, pri:high
  if (priority === "MEDIUM") {
    const shortMatch = remaining.match(/\b(?:p|pri):\s*(low|medium|high|urgent)\b/i);
    if (shortMatch) {
      priority = shortMatch[1].toUpperCase();
      remaining = remaining.replace(shortMatch[0], "").trim();
    }
  }

  // 2. Extract owner mention: <@U12345>, <@U12345|name>, or plain @name
  let ownerSlackId: string | null = null;
  const mentionMatch = remaining.match(/<@(U\w+)(?:\|[^>]*)?>/);
  if (mentionMatch) {
    ownerSlackId = mentionMatch[1];
    remaining = remaining.replace(mentionMatch[0], "").trim();
  } else {
    // Plain @name — Slack doesn't convert mentions in slash command text
    const plainMention = remaining.match(/@(\S+)/);
    if (plainMention) {
      const name = plainMention[1];
      ownerSlackId = await resolveNameToSlackId(name);
      if (ownerSlackId) {
        remaining = remaining.replace(plainMention[0], "").trim();
      }
    }
  }

  // 3. Extract deadline
  let deadline: string | null = null;

  // ISO date: 2026-04-15 (optionally preceded by "by", "before", "due")
  const isoMatch = remaining.match(/\b(?:by|before|due)\s+(\d{4}-\d{2}-\d{2})\b/i)
    || remaining.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    deadline = isoMatch[1];
    remaining = remaining.replace(isoMatch[0], "").trim();
  }

  // US-style date: 4/22, 04/22, by 4/22
  if (!deadline) {
    const usMatch = remaining.match(/\b(?:by|before|due)\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/i)
      || remaining.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (usMatch) {
      const month = usMatch[1].padStart(2, "0");
      const day = usMatch[2].padStart(2, "0");
      let year = usMatch[3]
        ? (usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3])
        : String(new Date().getFullYear());
      // If date already passed this year, assume next year
      const candidate = new Date(`${year}-${month}-${day}`);
      if (candidate < new Date() && !usMatch[3]) {
        year = String(new Date().getFullYear() + 1);
      }
      deadline = `${year}-${month}-${day}`;
      remaining = remaining.replace(usMatch[0], "").trim();
    }
  }

  // "by Friday", "by next week", "by tomorrow", etc.
  if (!deadline) {
    const byMatch = remaining.match(
      /\bby\s+(?:end\s+of\s+)?(today|tomorrow|eod|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next\s+week|end\s+of\s+(?:week|month)|this\s+(?:friday|week))\b/i
    );
    if (byMatch) {
      deadline = resolveRelativeDeadline(byMatch[1]);
      remaining = remaining.replace(byMatch[0], "").trim();
    }
  }

  // 4. Clean up description
  remaining = remaining
    .replace(/\s{2,}/g, " ")
    .replace(/^[-–—:,]\s*/, "")
    .replace(/[-–—:,]\s*$/, "")
    .trim();

  return {
    ownerSlackId,
    description: remaining,
    deadline,
    priority,
  };
}

// ── Date helpers ──

function resolveRelativeDeadline(relative: string): string {
  const now = new Date();
  const lower = relative.toLowerCase().trim();

  if (lower === "today" || lower === "eod") return toISO(now);
  if (lower === "tomorrow") {
    now.setDate(now.getDate() + 1);
    return toISO(now);
  }

  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };

  const dayMatch = lower.match(/(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (dayMatch) {
    const target = dayMap[dayMatch[1]];
    let diff = target - now.getDay();
    if (diff <= 0) diff += 7;
    now.setDate(now.getDate() + diff);
    return toISO(now);
  }

  if (lower.includes("next week") || lower.includes("end of week") || lower.includes("this week")) {
    const diff = ((5 - now.getDay() + 7) % 7) || 7;
    now.setDate(now.getDate() + diff);
    return toISO(now);
  }

  if (lower.includes("this friday")) {
    let diff = 5 - now.getDay();
    if (diff <= 0) diff += 7;
    now.setDate(now.getDate() + diff);
    return toISO(now);
  }

  if (lower.includes("end of month")) {
    return toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }

  // Default: end of this week (Friday)
  const diff = ((5 - now.getDay() + 7) % 7) || 7;
  now.setDate(now.getDate() + diff);
  return toISO(now);
}

function getEndOfWeek(): string {
  const now = new Date();
  const diff = ((5 - now.getDay() + 7) % 7) || 7;
  now.setDate(now.getDate() + diff);
  return toISO(now);
}

function toISO(d: Date): string {
  return d.toISOString().split("T")[0];
}
