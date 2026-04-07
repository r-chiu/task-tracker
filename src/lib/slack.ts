import { WebClient } from "@slack/web-api";

// Bot token for sending messages/notifications
export const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const slack = slackClient;
// User token for reading channels, group DMs, and message history
const slackUser = new WebClient(process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN);

export async function sendSlackDM(userId: string, text: string, blocks?: unknown[]) {
  const conversation = await slack.conversations.open({ users: userId });
  if (!conversation.channel?.id) throw new Error("Failed to open DM channel");

  await slack.chat.postMessage({
    channel: conversation.channel.id,
    text,
    blocks: blocks as never[],
  });
}

export async function sendSlackMessage(channel: string, text: string, blocks?: unknown[]) {
  await slack.chat.postMessage({
    channel,
    text,
    blocks: blocks as never[],
  });
}

export async function fetchSlackMembers() {
  const members: {
    slackId: string;
    displayName: string | null;
    realName: string | null;
    email: string | null;
    isBot: boolean;
    isActive: boolean;
  }[] = [];

  let cursor: string | undefined;
  do {
    const result = await slack.users.list({ cursor, limit: 200 });
    for (const member of result.members ?? []) {
      if (member.id === "USLACKBOT") continue;
      members.push({
        slackId: member.id!,
        displayName: member.profile?.display_name || null,
        realName: member.real_name || null,
        email: member.profile?.email || null,
        isBot: member.is_bot ?? false,
        isActive: !member.deleted,
      });
    }
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return members;
}

export async function fetchChannelMessages(channel: string, limit = 50, daysBack = 30) {
  // Only fetch messages from the past N days
  const oldest = String(Math.floor(Date.now() / 1000) - daysBack * 24 * 60 * 60);

  // Try user token first (needed for group DMs), fall back to bot token
  let result;
  try {
    result = await slackUser.conversations.history({ channel, limit, oldest });
  } catch {
    result = await slack.conversations.history({ channel, limit, oldest });
  }
  const messages: { text: string; user: string | null; ts: string }[] = [];
  for (const msg of result.messages ?? []) {
    if (msg.subtype) continue; // skip join/leave/etc
    messages.push({
      text: msg.text || "",
      user: msg.user || null,
      ts: msg.ts || "",
    });
  }
  return messages;
}

// --- Channel list cache (persisted to disk + in-memory for instant loads) ---
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

type ChannelEntry = { id: string; name: string; type: "channel" | "group_dm" };
let channelCache: ChannelEntry[] | null = null;
let channelCacheTime = 0;
const CHANNEL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const CHANNEL_CACHE_FILE = join(process.cwd(), ".channel-cache.json");
let backgroundRefreshInProgress = false;

// Load from disk cache on first access
function loadDiskCache(): ChannelEntry[] | null {
  try {
    if (existsSync(CHANNEL_CACHE_FILE)) {
      const data = JSON.parse(readFileSync(CHANNEL_CACHE_FILE, "utf-8"));
      if (data.channels && data.time && Date.now() - data.time < 24 * 60 * 60 * 1000) {
        return data.channels;
      }
    }
  } catch { /* ignore corrupt cache */ }
  return null;
}

function saveDiskCache(channels: ChannelEntry[]) {
  try {
    writeFileSync(CHANNEL_CACHE_FILE, JSON.stringify({ channels, time: Date.now() }));
  } catch { /* ignore write errors */ }
}

export async function listChannels(forceRefresh = false) {
  // Return memory cache if fresh
  if (!forceRefresh && channelCache && Date.now() - channelCacheTime < CHANNEL_CACHE_TTL) {
    return channelCache;
  }

  // Return disk cache instantly while refreshing in background
  if (!forceRefresh && !channelCache) {
    const diskData = loadDiskCache();
    if (diskData) {
      channelCache = diskData;
      channelCacheTime = Date.now() - CHANNEL_CACHE_TTL + 60_000; // Expire in 1 min to trigger background refresh
      // Trigger background refresh
      if (!backgroundRefreshInProgress) {
        backgroundRefreshInProgress = true;
        _fetchChannelsFromSlack().then((channels) => {
          channelCache = channels;
          channelCacheTime = Date.now();
          saveDiskCache(channels);
        }).catch(() => {}).finally(() => { backgroundRefreshInProgress = false; });
      }
      return diskData;
    }
  }

  // Stale memory cache — return it and refresh in background
  if (!forceRefresh && channelCache && !backgroundRefreshInProgress) {
    backgroundRefreshInProgress = true;
    _fetchChannelsFromSlack().then((channels) => {
      channelCache = channels;
      channelCacheTime = Date.now();
      saveDiskCache(channels);
    }).catch(() => {}).finally(() => { backgroundRefreshInProgress = false; });
    return channelCache;
  }

  // Force refresh or no cache at all — blocking fetch
  const channels = await _fetchChannelsFromSlack();
  channelCache = channels;
  channelCacheTime = Date.now();
  saveDiskCache(channels);
  return channels;
}

async function _fetchChannelsFromSlack() {
  const channels: ChannelEntry[] = [];

  // Fetch public + private channels
  // Use user token first (can see all private channels Ray is in),
  // fall back to bot token (only sees private channels bot is invited to)
  const seenIds = new Set<string>();
  const channelToken = slackUser || slack;

  for (const token of [channelToken, slack]) {
    let cursor: string | undefined;
    try {
      do {
        const result = await token.conversations.list({
          cursor,
          limit: 200,
          types: "public_channel,private_channel",
          exclude_archived: true,
        });
        for (const ch of result.channels ?? []) {
          if (ch.id && ch.name && !seenIds.has(ch.id)) {
            seenIds.add(ch.id);
            channels.push({ id: ch.id, name: ch.name, type: "channel" });
          }
        }
        cursor = result.response_metadata?.next_cursor || undefined;
      } while (cursor);
      break; // First token succeeded, no need for fallback
    } catch {
      continue; // Try next token
    }
  }

  // Fetch group DMs (mpim) — requires mpim:read scope
  // Note: Slack's `updated` field on mpim is unreliable, so we check actual
  // message history to find recently active DMs.
  const raySlackId = process.env.RAY_SLACK_USER_ID;
  try {
    const allGroupDms: { id: string; name: string }[] = [];
    let mpimCursor: string | undefined;
    do {
      const result = await slackUser.conversations.list({
        cursor: mpimCursor,
        limit: 200,
        types: "mpim",
        exclude_archived: true,
      });
      for (const ch of result.channels ?? []) {
        if (ch.id) {
          allGroupDms.push({
            id: ch.id,
            name: ch.name || ch.id,
          });
        }
      }
      mpimCursor = result.response_metadata?.next_cursor || undefined;
    } while (mpimCursor);

    // Check actual message history to find recently active DMs (last 90 days)
    // Process in batches of 10 to stay within rate limits
    const ninetyDaysAgo = String(Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60);
    const recentDms: { id: string; name: string; lastTs: number }[] = [];

    for (let i = 0; i < allGroupDms.length; i += 10) {
      const batch = allGroupDms.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(async (dm) => {
          const hist = await slackUser.conversations.history({
            channel: dm.id,
            limit: 1,
            oldest: ninetyDaysAgo,
          });
          const lastMsg = hist.messages?.[0];
          if (lastMsg?.ts) {
            return { ...dm, lastTs: parseFloat(lastMsg.ts) };
          }
          return null;
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          recentDms.push(r.value);
        }
      }
      // Stop early if we have enough — 50 recent DMs is plenty
      if (recentDms.length >= 50) break;
    }

    // Sort by most recent message first
    recentDms.sort((a, b) => b.lastTs - a.lastTs);

    // Pre-load all workspace members for fast name resolution
    const { prisma: _prisma } = await import("@/lib/prisma");
    const allMembers = await _prisma.slackMember.findMany({
      where: { isActive: true, isBot: false },
      select: { slackId: true, displayName: true, realName: true },
    });
    const memberNameMap = new Map<string, string>();
    for (const m of allMembers) {
      memberNameMap.set(m.slackId, m.displayName || m.realName || m.slackId);
    }

    // Resolve member names for each group DM (cap at 50 DMs)
    const dmsToResolve = recentDms.slice(0, 50);
    const resolvedDms = await Promise.allSettled(
      dmsToResolve.map(async (dm) => {
        try {
          const info = await slackUser.conversations.members({ channel: dm.id, limit: 20 });
          const memberIds = (info.members ?? []).filter((id) => id !== raySlackId);
          const memberNames = memberIds
            .map((mid) => memberNameMap.get(mid) || mid)
            .filter(Boolean);
          const friendlyName = memberNames.length > 0
            ? memberNames.join(", ")
            : dm.name;
          return { ...dm, name: friendlyName };
        } catch {
          return dm;
        }
      })
    );

    for (const r of resolvedDms) {
      if (r.status === "fulfilled") {
        channels.push({ id: r.value.id, name: r.value.name, type: "group_dm" });
      }
    }
  } catch {
    // mpim:read scope may not be granted — skip silently
  }

  return channels;
}

export function buildReminderBlocks(task: {
  id: string;
  title?: string;
  description: string;
  ownerName: string;
  deadline: string;
  priority: string;
}) {
  const appUrl = process.env.NEXTAUTH_URL || "";
  const taskLabel = task.title || task.description.slice(0, 200);
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `⏰ *Task Reminder*\n\n*${taskLabel}*\nThis task is due soon.`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Owner:*\n${task.ownerName}` },
        { type: "mrkdwn", text: `*Priority:*\n${task.priority}` },
        { type: "mrkdwn", text: `*Deadline:*\n${task.deadline}` },
        { type: "mrkdwn", text: `*Status:*\n🟡 Due Soon` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "📋 View Task", emoji: true },
          url: `${appUrl}/tasks/${task.id}`,
          style: "primary" as const,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔄 Request Extension", emoji: true },
          action_id: "request_extension",
          value: task.id,
        },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: "Sent by Calyx Task Tracker" },
      ],
    },
  ];
}

export function buildOverdueBlocks(task: {
  id: string;
  title?: string;
  description: string;
  ownerName: string;
  deadline: string;
  priority: string;
  daysOverdue: number;
}) {
  const appUrl = process.env.NEXTAUTH_URL || "";
  const taskLabel = task.title || task.description.slice(0, 200);
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🔴 *Overdue Task*\n\n*${taskLabel}*\nThis task is *${task.daysOverdue} day${task.daysOverdue > 1 ? "s" : ""} overdue*.`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Owner:*\n${task.ownerName}` },
        { type: "mrkdwn", text: `*Priority:*\n${task.priority}` },
        { type: "mrkdwn", text: `*Deadline:*\n${task.deadline}` },
        { type: "mrkdwn", text: `*Status:*\n🔴 Overdue` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "📋 View Task", emoji: true },
          url: `${appUrl}/tasks/${task.id}`,
          style: "primary" as const,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔄 Request Extension", emoji: true },
          action_id: "request_extension",
          value: task.id,
        },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: "Sent by Calyx Task Tracker" },
      ],
    },
  ];
}
