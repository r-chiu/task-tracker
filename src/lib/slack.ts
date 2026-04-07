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
  // Only show recently active ones (last 30 days) to keep the list manageable
  const raySlackId = process.env.RAY_SLACK_USER_ID;
  try {
    const allGroupDms: { id: string; name: string; updated: number }[] = [];
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
          const name = ch.purpose?.value || ch.name || ch.id;
          allGroupDms.push({ id: ch.id, name, updated: ch.updated ?? 0 });
        }
      }
      mpimCursor = result.response_metadata?.next_cursor || undefined;
    } while (mpimCursor);

    // Filter: only group DMs with activity in the last 30 days
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    let recentDms = allGroupDms.filter((dm) => dm.updated > thirtyDaysAgo);

    // Sort by most recently active first
    recentDms.sort((a, b) => b.updated - a.updated);

    // If Ray's Slack ID is configured, boost DMs where Ray was recently active
    if (raySlackId && recentDms.length > 20) {
      // Sample up to 20 recent DMs — check in parallel (5 at a time) for speed
      const toCheck = recentDms.slice(0, 20);
      const results = await Promise.allSettled(
        toCheck.map(async (dm) => {
          const hist = await slackUser.conversations.history({ channel: dm.id, limit: 5 });
          const rayActive = (hist.messages ?? []).some((m) => m.user === raySlackId);
          return { dm, rayActive };
        })
      );

      const rayActiveDms: typeof recentDms = [];
      const otherDms: typeof recentDms = [];
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.rayActive) {
          rayActiveDms.push(r.value.dm);
        } else if (r.status === "fulfilled") {
          otherDms.push(r.value.dm);
        }
      }

      // Ray's active DMs first, then others, then any remaining beyond checked set
      recentDms = [
        ...rayActiveDms,
        ...otherDms,
        ...recentDms.slice(20),
      ];
    }

    // Cap at 25 group DMs max to keep the UI clean
    for (const dm of recentDms.slice(0, 25)) {
      channels.push({ id: dm.id, name: dm.name, type: "group_dm" });
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
  const taskLabel = task.title || task.description.slice(0, 200);
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Task Deadline Reminder", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Task:*\n${taskLabel}` },
        { type: "mrkdwn", text: `*Owner:*\n${task.ownerName}` },
        { type: "mrkdwn", text: `*Deadline:*\n${task.deadline}` },
        { type: "mrkdwn", text: `*Priority:*\n${task.priority}` },
      ],
    },
    { type: "divider" },
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
  const taskLabel = task.title || task.description.slice(0, 200);
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Overdue Task Follow-Up", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Task:*\n${taskLabel}` },
        { type: "mrkdwn", text: `*Owner:*\n${task.ownerName}` },
        { type: "mrkdwn", text: `*Deadline:*\n${task.deadline}` },
        { type: "mrkdwn", text: `*Days Overdue:*\n${task.daysOverdue}` },
      ],
    },
    { type: "divider" },
  ];
}
