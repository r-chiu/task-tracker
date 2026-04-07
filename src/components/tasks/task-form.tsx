"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRIORITY_LABELS, SOURCE_LABELS } from "@/lib/constants";
import { generateTitle } from "@/lib/slack-parser";
import { RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { hashContent } from "@/lib/action-item-hash";

interface SlackMember {
  id: string;
  slackId: string;
  displayName: string | null;
  realName: string | null;
  email: string | null;
  isBot?: boolean;
  isActive?: boolean;
}

interface SlackChannel {
  id: string;
  name: string;
  type?: "channel" | "group_dm";
}

const CHANNEL_CATEGORIES: Record<string, { label: string; color: string }> = {
  "m-": { label: "Management", color: "bg-indigo-100 text-indigo-800" },
  "b-": { label: "Business / Sales", color: "bg-amber-100 text-amber-800" },
  "e-": { label: "Engineering", color: "bg-blue-100 text-blue-800" },
  "ai-": { label: "AI", color: "bg-purple-100 text-purple-800" },
  "d-": { label: "Project Development", color: "bg-cyan-100 text-cyan-800" },
  "r-": { label: "R&D Sensor", color: "bg-green-100 text-green-800" },
  "t-": { label: "Testing", color: "bg-orange-100 text-orange-800" },
};

function categorizeChannels(channels: SlackChannel[]) {
  const categorized: Record<string, SlackChannel[]> = {};
  const uncategorized: SlackChannel[] = [];
  const groupDms: SlackChannel[] = [];

  for (const ch of channels) {
    if (ch.type === "group_dm") {
      groupDms.push(ch);
      continue;
    }
    let matched = false;
    for (const prefix of Object.keys(CHANNEL_CATEGORIES)) {
      if (ch.name.startsWith(prefix)) {
        if (!categorized[prefix]) categorized[prefix] = [];
        categorized[prefix].push(ch);
        matched = true;
        break;
      }
    }
    if (!matched) uncategorized.push(ch);
  }

  return { categorized, uncategorized, groupDms };
}

interface User {
  id: string;
  name: string | null;
  email: string;
  slackId?: string | null;
}

export function TaskForm() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [slackMembers, setSlackMembers] = useState<SlackMember[]>([]);
  const [allSlackMembers, setAllSlackMembers] = useState<SlackMember[]>([]);
  const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [selectedChannels, _setSelectedChannels] = useState<string[]>([]);
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  // Persist channel selection to server (shared across all users)
  const setSelectedChannels = (value: string[] | ((prev: string[]) => string[])) => {
    _setSelectedChannels((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      // Save to server in background
      const names = next
        .map((id) => slackChannels.find((ch) => ch.id === id)?.name)
        .filter(Boolean);
      fetch("/api/settings/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next, names }),
      }).catch(() => {});
      return next;
    });
  };
  const [detecting, setDetecting] = useState(false);
  const [refreshingChannels, setRefreshingChannels] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Suggested owners from the selected action item (sender + @mentioned active users)
  const [suggestedOwners, setSuggestedOwners] = useState<{ slackId: string; name: string; role: string }[]>([]);
  // Track the raw (un-humanized) description of the currently selected action item
  const [rawSelectedDescription, setRawSelectedDescription] = useState<string>("");

  const [form, setForm] = useState({
    title: "",
    description: "",
    ownerId: "",
    deadline: "",
    priority: "MEDIUM",
    sourceType: "MANUAL",
    sourceReference: "",
    slackChannel: "",
    notes: "",
  });

  // Parse from source text
  const [sourceText, setSourceText] = useState("");
  const [parsedItems, setParsedItems] = useState<any[]>([]);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  // Custom titles edited on action item cards (keyed by index)
  const [itemTitles, setItemTitles] = useState<Record<number, string>>({});
  // Track dismissed/used action item hashes (content hash → reason)
  const [dismissedHashes, setDismissedHashes] = useState<Record<string, string>>({});

  // Resolve a Slack user ID or @handle to a display name (searches all members including bots/deactivated)
  const resolveSlackName = (idOrHandle: string | null): string | null => {
    if (!idOrHandle) return null;
    const pool = allSlackMembers.length > 0 ? allSlackMembers : slackMembers;
    const member = pool.find(
      (m) =>
        m.slackId === idOrHandle ||
        m.displayName?.toLowerCase() === idOrHandle.toLowerCase() ||
        m.realName?.toLowerCase() === idOrHandle.toLowerCase()
    );
    return member?.displayName || member?.realName || null;
  };

  // Replace all <@UXXXX> Slack mention markup in text with @displayName
  const humanizeSlackText = (text: string): string => {
    const pool = allSlackMembers.length > 0 ? allSlackMembers : slackMembers;
    return text.replace(/<@(\w+)>/g, (match, userId) => {
      const member = pool.find((m) => m.slackId === userId);
      if (!member) return match;
      const name = member.displayName || member.realName;
      if (!name) return match;
      // Mark deactivated users so it's clear they're no longer active
      if (member.isActive === false) return `@${name} (deactivated)`;
      if (member.isBot) return `@${name} (bot)`;
      return `@${name}`;
    });
  };

  // Fallback defaults for first-time users (before any selection is saved)
  const DEFAULT_ACTIVE_CHANNELS = [
    "m-marketing",
    "m-camera-committee",
    "m-camera-monitoring",
    "m-founding-team",
    "b-customer-support-tyson",
    "b-customer-support-simmonsfood",
  ];

  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setUsers(Array.isArray(d) ? d : []));
    fetch("/api/slack/members").then((r) => r.json()).then((d) => setSlackMembers(Array.isArray(d) ? d : []));
    // Fetch all members (including bots/deactivated) for name resolution
    fetch("/api/slack/members?all=1").then((r) => r.json()).then((d) => setAllSlackMembers(Array.isArray(d) ? d : []));
    fetch("/api/slack/channels").then((r) => r.json()).then(async (d) => {
      const channels = Array.isArray(d) ? d : [];
      setSlackChannels(channels);
      setLoadingChannels(false);
      if (!defaultsApplied && channels.length > 0) {
        // Restore saved selection from server (shared across all users)
        let restored = false;
        try {
          const settingsRes = await fetch("/api/settings/channels");
          const settings = await settingsRes.json();
          if (settings.ids?.length > 0) {
            const validIds = new Set(channels.map((ch: SlackChannel) => ch.id));
            const filtered = settings.ids.filter((id: string) => validIds.has(id));
            if (filtered.length > 0) {
              _setSelectedChannels(filtered);
              restored = true;
            } else if (settings.names?.length > 0) {
              // IDs changed — try matching by name
              const nameSet = new Set(settings.names);
              const matchedIds = channels
                .filter((ch: SlackChannel) => nameSet.has(ch.name))
                .map((ch: SlackChannel) => ch.id);
              if (matchedIds.length > 0) {
                _setSelectedChannels(matchedIds);
                restored = true;
              }
            }
          }
        } catch {}
        // If server has no saved selection, try migrating from localStorage (one-time)
        if (!restored) {
          try {
            const localIds = localStorage.getItem("task-tracker:selected-channels");
            const localNames = localStorage.getItem("task-tracker:selected-channel-names");
            if (localIds) {
              const ids = JSON.parse(localIds) as string[];
              const validIds = new Set(channels.map((ch: SlackChannel) => ch.id));
              const filtered = ids.filter((id) => validIds.has(id));
              if (filtered.length > 0) {
                _setSelectedChannels(filtered);
                // Migrate to server
                const names = filtered
                  .map((id) => channels.find((ch: SlackChannel) => ch.id === id)?.name)
                  .filter(Boolean);
                fetch("/api/settings/channels", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ids: filtered, names }),
                }).catch(() => {});
                restored = true;
              }
            }
            if (!restored && localNames) {
              const names = JSON.parse(localNames) as string[];
              const nameSet = new Set(names);
              const matchedIds = channels
                .filter((ch: SlackChannel) => nameSet.has(ch.name))
                .map((ch: SlackChannel) => ch.id);
              if (matchedIds.length > 0) {
                _setSelectedChannels(matchedIds);
                fetch("/api/settings/channels", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ids: matchedIds, names }),
                }).catch(() => {});
                restored = true;
              }
            }
          } catch {}
        }
        if (!restored) {
          const defaultIds = channels
            .filter((ch: SlackChannel) => DEFAULT_ACTIVE_CHANNELS.includes(ch.name))
            .map((ch: SlackChannel) => ch.id);
          _setSelectedChannels(defaultIds);
        }
        setDefaultsApplied(true);
      }
    });
  }, [defaultsApplied]);

  // Load cached action items on mount
  useEffect(() => {
    fetch("/api/action-items/cache")
      .then((r) => r.json())
      .then(async (data) => {
        if (data.items?.length > 0) {
          const items = await filterDismissedItems(data.items);
          if (items.length > 0) {
            setParsedItems(items);
            setCachedAt(data.cachedAt);
          }
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save items to cache
  const saveItemsToCache = (items: any[]) => {
    fetch("/api/action-items/cache", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }).catch(() => {});
  };

  const handleRefreshChannels = async () => {
    setRefreshingChannels(true);
    try {
      // Sync members from Slack first, then refresh channels
      await fetch("/api/slack/members", { method: "POST" });
      const [membersRes, allMembersRes, channelsRes] = await Promise.all([
        fetch("/api/slack/members"),
        fetch("/api/slack/members?all=1"),
        fetch("/api/slack/channels?refresh=1"),
      ]);
      const members = await membersRes.json();
      const allMembers = await allMembersRes.json();
      const channels = await channelsRes.json();
      setSlackMembers(Array.isArray(members) ? members : []);
      setAllSlackMembers(Array.isArray(allMembers) ? allMembers : []);
      setSlackChannels(Array.isArray(channels) ? channels : []);
      toast.success(`Refreshed ${channels.length} channels and ${members.length} members from Slack.`);
    } catch {
      toast.error("Failed to refresh from Slack.");
    } finally {
      setRefreshingChannels(false);
    }
  };

  // Match a Slack user ID to a system User (for owner assignment)
  const matchSlackIdToUser = (slackId: string): string | null => {
    // Direct match by slackId on the User model
    const bySlackId = users.find((u) => u.slackId === slackId);
    if (bySlackId) return bySlackId.id;

    const pool = allSlackMembers.length > 0 ? allSlackMembers : slackMembers;
    const member = pool.find((m) => m.slackId === slackId);
    if (!member) return null;
    // Try to find a matching system user by email, name, or display name
    if (member.email) {
      const byEmail = users.find((u) => u.email === member.email);
      if (byEmail) return byEmail.id;
    }
    const name = (member.displayName || member.realName || "").toLowerCase();
    if (name) {
      const byName = users.find(
        (u) => u.name?.toLowerCase() === name || u.email.split("@")[0].toLowerCase() === name
      );
      if (byName) return byName.id;
    }
    return null;
  };

  // Auto-create a system user from a Slack member and return their user ID
  // Also updates local users state and optionally sets form ownerId
  const ensureUserForSlackId = async (slackId: string, autoSetOwner = false): Promise<string | null> => {
    // Already exists?
    const existing = matchSlackIdToUser(slackId);
    if (existing) {
      if (autoSetOwner) setForm((f) => ({ ...f, ownerId: existing }));
      return existing;
    }

    // Find Slack member info
    const pool = allSlackMembers.length > 0 ? allSlackMembers : slackMembers;
    const member = pool.find((m) => m.slackId === slackId);
    if (!member) return null;

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slackId: member.slackId,
          name: member.realName || member.displayName,
          email: member.email,
          slackDisplayName: member.displayName,
        }),
      });
      if (!res.ok) return null;
      const newUser = await res.json();
      const userEntry: User = { id: newUser.id, name: newUser.name, email: newUser.email, slackId: newUser.slackId };
      // Add to local users state AND set ownerId in a single batch to avoid stale render
      setUsers((prev) => {
        // Avoid duplicates
        if (prev.some((u) => u.id === newUser.id)) return prev;
        return [...prev, userEntry];
      });
      if (autoSetOwner) setForm((f) => ({ ...f, ownerId: newUser.id }));
      return newUser.id;
    } catch {
      return null;
    }
  };

  // Generate a title for an action item (used for preview and form fill)
  const getItemTitle = (item: Record<string, unknown>, index?: number): string => {
    // Use custom-edited title if available
    if (index !== undefined && itemTitles[index]) return itemTitles[index];
    // AI-generated title or regex fallback
    const rawDesc = (item.description as string) || "";
    const desc = humanizeSlackText(rawDesc);
    return (item.title as string) || generateTitle(desc);
  };

  // Auto-fill form from a parsed action item
  const applyParsedItem = (item: Record<string, unknown>, itemIndex?: number) => {
    const pool = allSlackMembers.length > 0 ? allSlackMembers : slackMembers;

    // Humanize the text (replace <@UXXXX> with @name)
    const rawDesc = (item.description as string) || "";
    const desc = humanizeSlackText(rawDesc);

    // Save the raw description for dismiss/used tracking (before humanization)
    setRawSelectedDescription(rawDesc);

    // Get immediate title (AI from item or regex fallback)
    const immediateTitle = getItemTitle(item, itemIndex);

    // If no AI title on the item, request one from the API asynchronously
    const hasAiTitle = !!(item.title as string);
    if (!hasAiTitle && desc.length > 10) {
      fetch("/api/tasks/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: desc }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.title && data.source === "ai") {
            setForm((f) => ({ ...f, title: data.title }));
          }
        })
        .catch(() => {});
    }

    setForm((f) => {
      const updates: Partial<typeof f> = {};

      // Title — use custom title if edited, then AI title, then regex
      updates.title = immediateTitle;
      updates.description = desc;

      // Deadline
      if (item.suggestedDeadline) {
        const dl = item.suggestedDeadline as string;
        if (/^\d{4}-\d{2}-\d{2}$/.test(dl)) updates.deadline = dl;
      }

      // Priority — map CRITICAL → URGENT (form only supports LOW/MEDIUM/HIGH/URGENT)
      if (item.suggestedPriority) {
        const p = (item.suggestedPriority as string).toUpperCase();
        const validPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
        const mapped = p === "CRITICAL" ? "URGENT" : p;
        updates.priority = validPriorities.includes(mapped) ? mapped : "MEDIUM";
      }

      // Channel
      if (item.channel) {
        updates.slackChannel = item.channel as string;
        updates.sourceType = "SLACK_MESSAGE";
      }

      return { ...f, ...updates };
    });

    // Build suggested owners: sender + all @mentioned active users
    const candidates: { slackId: string; name: string; role: string }[] = [];
    const seen = new Set<string>();

    // Add sender
    if (item.sender) {
      const senderId = item.sender as string;
      const senderMember = pool.find((m) => m.slackId === senderId);
      if (senderMember && senderMember.isActive !== false && !senderMember.isBot) {
        const name = senderMember.displayName || senderMember.realName || senderId;
        candidates.push({ slackId: senderId, name, role: "sender" });
        seen.add(senderId);
      }
    }

    // Add all @mentioned users
    const mentionedIds = [...rawDesc.matchAll(/<@(\w+)>/g)].map((m) => m[1]);
    for (const mid of mentionedIds) {
      if (seen.has(mid)) continue;
      const member = pool.find((m) => m.slackId === mid);
      if (member && member.isActive !== false && !member.isBot) {
        const name = member.displayName || member.realName || mid;
        candidates.push({ slackId: mid, name, role: "mentioned" });
        seen.add(mid);
      }
    }

    setSuggestedOwners(candidates);

    // Auto-select owner: pick first mentioned, or sender. Auto-create if needed.
    const mentioned = candidates.filter((c) => c.role === "mentioned");
    const autoOwner = mentioned.length > 0 ? mentioned[0] : candidates[0];
    if (autoOwner) {
      // ensureUserForSlackId handles both existing and new users, and sets ownerId
      ensureUserForSlackId(autoOwner.slackId, true);
    }
  };

  // Filter out already-dismissed/used items from a list
  const filterDismissedItems = async (items: any[]): Promise<any[]> => {
    if (items.length === 0) return items;
    // Hash all descriptions
    const hashPairs = await Promise.all(
      items.map(async (item) => ({
        item,
        hash: await hashContent(item.description || ""),
      }))
    );
    // Check which are dismissed — pass both hashes and descriptions for fuzzy matching
    const hashes = hashPairs.map((p) => p.hash).join(",");
    const descriptions = hashPairs.map((p) => (p.item.description || "").slice(0, 500)).join("|||");
    try {
      const res = await fetch(
        `/api/action-items?hashes=${hashes}&descriptions=${encodeURIComponent(descriptions)}`
      );
      const data = await res.json();
      const dismissed: Record<string, string> = data.dismissed || {};
      setDismissedHashes((prev) => ({ ...prev, ...dismissed }));
      return hashPairs
        .filter((p) => !dismissed[p.hash])
        .map((p) => p.item);
    } catch {
      return items; // On error, show all
    }
  };

  // Dismiss an action item (remove from list, mark in DB)
  const handleDismissItem = async (item: any, index: number) => {
    const description = item.description || "";
    const hash = await hashContent(description);

    // Immediately remove from UI and update cache
    const remaining = parsedItems.filter((_, i) => i !== index);
    setParsedItems(remaining);
    setDismissedHashes((prev) => ({ ...prev, [hash]: "dismissed" }));
    saveItemsToCache(remaining);

    // Persist to DB
    fetch("/api/action-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ description, reason: "dismissed", channel: item.channel || null }],
      }),
    }).catch(() => {});

    toast.info("Item dismissed — it won't show up again.");
  };

  // Mark an item as "used" when a task is created from it
  const markItemAsUsed = async (description: string, taskId: string, channel?: string) => {
    const hash = await hashContent(description);
    setDismissedHashes((prev) => ({ ...prev, [hash]: "used" }));

    fetch("/api/action-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ description, reason: "used", taskId, channel }],
      }),
    }).catch(() => {});
  };

  const handleParseSource = async () => {
    if (!sourceText.trim()) return;
    const res = await fetch("/api/slack/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sourceText }),
    });
    const data = await res.json();
    const rawItems = data.items || [];
    const items = await filterDismissedItems(rawItems);
    setParsedItems(items);
    setCachedAt(new Date().toISOString());
    saveItemsToCache(items);
    if (items.length > 0) {
      applyParsedItem(items[0]);
      toast.success(`Found ${items.length} actionable item(s). Task details auto-filled.`);
    } else {
      toast.info("No actionable items detected. You can enter the task manually.");
    }
  };

  const toggleChannel = (channelId: string) => {
    setSelectedChannels((prev) =>
      prev.includes(channelId) ? prev.filter((id) => id !== channelId) : [...prev, channelId]
    );
  };

  const handleDetectFromSlack = async () => {
    if (selectedChannels.length === 0) {
      toast.error("Please select at least one Slack channel.");
      return;
    }
    setDetecting(true);
    try {
      let allItems: typeof parsedItems = [];
      let totalScanned = 0;
      for (const channelId of selectedChannels) {
        const res = await fetch("/api/slack/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId, limit: 50 }),
        });
        const data = await res.json();
        if (res.ok) {
          const channelName = slackChannels.find((c) => c.id === channelId)?.name;
          const items = (data.items || []).map((item: Record<string, unknown>) => ({
            ...item,
            channel: channelName ? `#${channelName}` : channelId,
          }));
          allItems = [...allItems, ...items];
          totalScanned += data.messagesScanned || 0;
        }
      }
      // Filter out messages from bots/deactivated senders,
      // and messages where all mentioned users are deactivated/bots
      const pool = allSlackMembers.length > 0 ? allSlackMembers : slackMembers;
      const isActiveUser = (userId: string) => {
        const m = pool.find((x) => x.slackId === userId);
        return !m || (m.isActive !== false && !m.isBot);
      };
      const filtered = allItems.filter((item: Record<string, unknown>) => {
        // Filter by sender
        if (item.sender) {
          if (!isActiveUser(item.sender as string)) return false;
        }
        // Filter by mentioned users — if message has @mentions and ALL are deactivated/bots, skip it
        const desc = (item.description as string) || "";
        const mentionedIds = [...desc.matchAll(/<@(\w+)>/g)].map((m) => m[1]);
        if (mentionedIds.length > 0) {
          const hasActiveRecipient = mentionedIds.some((id) => isActiveUser(id));
          if (!hasActiveRecipient) return false;
        }
        return true;
      });
      // Filter out previously used/dismissed items
      const finalItems = await filterDismissedItems(filtered);
      setParsedItems(finalItems);
      setCachedAt(new Date().toISOString());
      saveItemsToCache(finalItems);
      if (finalItems.length > 0) {
        applyParsedItem(finalItems[0]);
        toast.success(`Scanned ${totalScanned} messages across ${selectedChannels.length} channel(s), found ${finalItems.length} actionable message(s). Task details auto-filled.`);
      } else {
        toast.info(`Scanned ${totalScanned} messages across ${selectedChannels.length} channel(s). No actionable messages detected.`);
      }
    } catch {
      toast.error("Failed to connect to Slack.");
    } finally {
      setDetecting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent, createAnother = false) => {
    e.preventDefault();
    if (!form.title || !form.ownerId || !form.deadline) {
      toast.error("Task name, owner, and deadline are required.");
      return;
    }
    // Safety: resolve any unresolved slack: prefix
    let ownerId = form.ownerId;
    if (ownerId.startsWith("slack:")) {
      const resolved = await ensureUserForSlackId(ownerId.slice(6), true);
      if (!resolved) { toast.error("Failed to create user for owner"); return; }
      ownerId = resolved;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ownerId }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Failed to create task");
        return;
      }
      const task = await res.json();

      // Mark the current description as "used" so it won't show up again
      // Use the raw (un-humanized) description so the hash matches future detections
      const descToMark = rawSelectedDescription || form.description;
      if (descToMark) {
        markItemAsUsed(descToMark, task.id, form.slackChannel || undefined);
        // Also mark the humanized version in case of direct text input
        if (rawSelectedDescription && form.description !== rawSelectedDescription) {
          markItemAsUsed(form.description, task.id, form.slackChannel || undefined);
        }
      }

      // Also remove the used item from the parsed items list and update cache
      const rawDesc = rawSelectedDescription || form.description;
      const remainingItems = parsedItems.filter((item) =>
        item.description !== rawDesc && item.description !== form.description
      );
      setParsedItems(remainingItems);
      saveItemsToCache(remainingItems);

      if (createAnother) {
        // Reset form but keep channel selection and source type
        toast.success("Task created! Fill in the next one.");
        setForm({
          title: "",
          description: "",
          ownerId: "",
          deadline: "",
          priority: "MEDIUM",
          sourceType: form.sourceType,
          sourceReference: "",
          slackChannel: "",
          notes: "",
        });
        setSuggestedOwners([]);
        setRawSelectedDescription("");
        // If there are remaining parsed items, auto-fill the next one
        if (remainingItems.length > 0) {
          setTimeout(() => applyParsedItem(remainingItems[0]), 100);
        }
      } else {
        toast.success("Task created successfully");
        router.push("/");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
      {/* Detect from Slack */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detect Action Items from Slack</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Slack Channels</Label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={handleRefreshChannels}
                  disabled={refreshingChannels}
                >
                  <RefreshCw className={`h-3 w-3 mr-1 ${refreshingChannels ? "animate-spin" : ""}`} />
                  {refreshingChannels ? "Refreshing..." : "Refresh"}
                </Button>
                {selectedChannels.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSelectedChannels([])}
                  >
                    Clear all ({selectedChannels.length})
                  </button>
                )}
              </div>
            </div>
            {loadingChannels ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading Slack channels...
              </div>
            ) : slackChannels.length > 0 ? (
              <ChannelSelector
                channels={slackChannels}
                selectedChannels={selectedChannels}
                onToggle={toggleChannel}
                onToggleCategory={(ids) => {
                  setSelectedChannels((prev) => {
                    const allSelected = ids.every((id) => prev.includes(id));
                    if (allSelected) return prev.filter((id) => !ids.includes(id));
                    return [...new Set([...prev, ...ids])];
                  });
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No channels found. Check your Slack bot token.</p>
            )}
          </div>
          <Button type="button" onClick={handleDetectFromSlack} disabled={detecting || selectedChannels.length === 0}>
            {detecting ? "Scanning..." : `Detect from ${selectedChannels.length || ""} Channel${selectedChannels.length !== 1 ? "s" : ""}`}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or paste text manually</span>
            </div>
          </div>

          <Textarea
            placeholder="Paste a Slack message, meeting notes, or any text to auto-detect action items..."
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            rows={3}
          />
          <Button type="button" variant="secondary" onClick={handleParseSource} disabled={!sourceText.trim()}>
            Parse Pasted Text
          </Button>

          {parsedItems.length > 0 && (() => {
            const confidenceOrder = { high: 0, medium: 1, low: 2 };
            const sorted = [...parsedItems].sort((a, b) => {
              // Primary: confidence (high → medium → low)
              const confDiff = (confidenceOrder[a.confidence as keyof typeof confidenceOrder] ?? 2) - (confidenceOrder[b.confidence as keyof typeof confidenceOrder] ?? 2);
              if (confDiff !== 0) return confDiff;
              // Secondary: most recent timestamp first
              const tsA = a.timestamp ? parseFloat(a.timestamp) : 0;
              const tsB = b.timestamp ? parseFloat(b.timestamp) : 0;
              return tsB - tsA;
            });

            // Group by ownerGroup if present (structured notes)
            const hasGroups = sorted.some((item) => item.ownerGroup);
            const groups: { label: string | null; items: typeof sorted }[] = [];
            if (hasGroups) {
              const seen = new Map<string | null, typeof sorted>();
              for (const item of sorted) {
                const key = item.ownerGroup || null;
                if (!seen.has(key)) seen.set(key, []);
                seen.get(key)!.push(item);
              }
              for (const [label, items] of seen) groups.push({ label, items });
            } else {
              groups.push({ label: null, items: sorted });
            }

            return (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Actionable Items ({sorted.length}):</p>
                  {cachedAt && (
                    <span className="text-xs text-muted-foreground">
                      Cached {(() => {
                        const d = new Date(cachedAt);
                        const now = new Date();
                        const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
                        if (diffMin < 1) return "just now";
                        if (diffMin < 60) return `${diffMin}m ago`;
                        const diffHrs = Math.floor(diffMin / 60);
                        if (diffHrs < 24) return `${diffHrs}h ago`;
                        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                      })()}
                    </span>
                  )}
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {groups.map((group, gi) => (
                    <div key={gi}>
                      {group.label && (
                        <div className="flex items-center gap-2 mt-2 mb-1.5">
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                            {group.label}
                          </span>
                          <span className="text-xs text-muted-foreground">({group.items.length})</span>
                        </div>
                      )}
                      {group.items.map((item, i) => {
                        const senderName = resolveSlackName(item.sender);
                        // For structured text, suggestedOwner may be a person name (not a Slack ID)
                        const ownerName = resolveSlackName(item.suggestedOwner) || item.suggestedOwner;
                        const pool = allSlackMembers.length > 0 ? allSlackMembers : slackMembers;
                        const ownerMember = item.suggestedOwner ? pool.find((m: SlackMember) => m.slackId === item.suggestedOwner) : null;
                        const showOwner = ownerName && (!ownerMember || (ownerMember.isActive !== false && !ownerMember.isBot));
                        // Find the real index in parsedItems for dismiss
                        const realIndex = parsedItems.indexOf(item);
                        return (
                          <div
                            key={i}
                            className="group relative text-sm p-3 rounded-md border cursor-pointer hover:bg-muted/50 hover:border-primary/30 transition-colors"
                            onClick={() => applyParsedItem(item, realIndex >= 0 ? realIndex : undefined)}
                          >
                            {/* Dismiss button */}
                            <button
                              type="button"
                              className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-red-100 text-muted-foreground hover:text-red-600"
                              title="Dismiss — won't show again"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDismissItem(item, realIndex >= 0 ? realIndex : i);
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap pr-6">
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                                item.confidence === "high" ? "bg-red-100 text-red-700" :
                                item.confidence === "medium" ? "bg-orange-100 text-orange-700" :
                                "bg-gray-100 text-gray-600"
                              }`}>
                                {item.confidence}
                              </span>
                              {item.channel && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{item.channel}</span>}
                              {senderName && <span className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded">From: {senderName}</span>}
                              {showOwner && <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{ownerName}</span>}
                              {item.suggestedDeadline && <span className="text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">Due: {item.suggestedDeadline}</span>}
                              {item.suggestedPriority && <span className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">{item.suggestedPriority}</span>}
                              {item.timestamp && (() => {
                                const d = new Date(parseFloat(item.timestamp) * 1000);
                                const now = new Date();
                                const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
                                const label = diffDays === 0 ? "Today" : diffDays === 1 ? "Yesterday" : diffDays < 7 ? `${diffDays}d ago` : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                                return <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{label}</span>;
                              })()}
                            </div>
                            <p className="text-sm whitespace-pre-wrap leading-relaxed">{humanizeSlackText(item.description)}</p>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Click an item to auto-fill the task details below.</p>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Task details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Task Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Task Name *</Label>
            <Input
              id="title"
              placeholder="Short task name, e.g. 'Prepare Q2 sales report'"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe the task in detail..."
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="owner">Owner *</Label>
              {suggestedOwners.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground">Suggested:</span>
                  {suggestedOwners.map((s) => {
                    const userId = matchSlackIdToUser(s.slackId);
                    const isSelected = userId && form.ownerId === userId;
                    return (
                      <button
                        key={s.slackId}
                        type="button"
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary"
                            : s.role === "sender"
                            ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                            : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                        }`}
                        onClick={async () => {
                          if (userId) {
                            setForm((f) => ({ ...f, ownerId: userId }));
                          } else {
                            const id = await ensureUserForSlackId(s.slackId, true);
                            if (id) {
                              toast.success(`Auto-created system user for ${s.name}`);
                            } else {
                              toast.error(`Could not create user for ${s.name}`);
                            }
                          }
                        }}
                      >
                        {s.name} {s.role === "sender" ? "(sender)" : "(mentioned)"}
                      </button>
                    );
                  })}
                </div>
              )}
              <Select
                value={form.ownerId}
                onValueChange={async (v) => {
                  if (!v) return;
                  if (v.startsWith("slack:")) {
                    const slackId = v.slice(6);
                    const id = await ensureUserForSlackId(slackId, true);
                    if (id) {
                      const pool = allSlackMembers.length > 0 ? allSlackMembers : slackMembers;
                      const member = pool.find((m) => m.slackId === slackId);
                      toast.success(`Auto-created system user for ${member?.displayName || member?.realName || slackId}`);
                    } else {
                      toast.error("Failed to create user");
                    }
                  } else {
                    setForm((f) => ({ ...f, ownerId: v }));
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select owner...">
                    {/* Explicit label: @base-ui Select can't resolve item text when popup is closed */}
                    {form.ownerId
                      ? (users.find((u) => u.id === form.ownerId)?.name ||
                         users.find((u) => u.id === form.ownerId)?.email ||
                         undefined)
                      : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name || u.email}
                    </SelectItem>
                  ))}
                  {/* Slack members not yet system users */}
                  {(() => {
                    const userSlackIds = new Set(users.map((u) => u.slackId).filter(Boolean));
                    const userEmails = new Set(users.map((u) => u.email.toLowerCase()));
                    const unlinked = slackMembers.filter(
                      (m) =>
                        m.slackId &&
                        !userSlackIds.has(m.slackId) &&
                        (!m.email || !userEmails.has(m.email.toLowerCase()))
                    );
                    if (unlinked.length === 0) return null;
                    return (
                      <>
                        <SelectItem value="__divider__" disabled>
                          ── Slack Members (auto-create) ──
                        </SelectItem>
                        {unlinked.map((m) => (
                          <SelectItem key={m.slackId} value={`slack:${m.slackId}`}>
                            {m.displayName || m.realName || m.email || m.slackId}
                          </SelectItem>
                        ))}
                      </>
                    );
                  })()}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deadline">Deadline *</Label>
              <Input
                id="deadline"
                type="date"
                value={form.deadline}
                onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={form.priority}
                onValueChange={(v) => v && setForm((f) => ({ ...f, priority: v }))}
              >
                <SelectTrigger>
                  <SelectValue>
                    {PRIORITY_LABELS[form.priority as keyof typeof PRIORITY_LABELS] || undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Source Type</Label>
              <Select
                value={form.sourceType}
                onValueChange={(v) => v && setForm((f) => ({ ...f, sourceType: v }))}
              >
                <SelectTrigger>
                  <SelectValue>
                    {SOURCE_LABELS[form.sourceType as keyof typeof SOURCE_LABELS] || undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Source Reference</Label>
              <Input
                placeholder="URL or reference ID..."
                value={form.sourceReference}
                onChange={(e) => setForm((f) => ({ ...f, sourceReference: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Slack Channel</Label>
              <ChannelSearchInput
                channels={slackChannels}
                value={form.slackChannel}
                onChange={(v) => setForm((f) => ({ ...f, slackChannel: v }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              placeholder="Additional notes..."
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating..." : "Create Task"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={submitting}
          onClick={(e) => handleSubmit(e as unknown as React.FormEvent, true)}
        >
          Save & Create Another
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ChannelSelector({
  channels,
  selectedChannels,
  onToggle,
  onToggleCategory,
}: {
  channels: SlackChannel[];
  selectedChannels: string[];
  onToggle: (id: string) => void;
  onToggleCategory: (ids: string[]) => void;
}) {
  const { categorized, uncategorized, groupDms } = categorizeChannels(channels);

  // Sort category prefixes by label
  const sortedPrefixes = Object.keys(CHANNEL_CATEGORIES).filter(
    (prefix) => categorized[prefix]?.length
  );

  return (
    <div className="space-y-3 max-h-72 overflow-y-auto rounded-md border p-3">
      {sortedPrefixes.map((prefix) => {
        const cat = CHANNEL_CATEGORIES[prefix];
        const chans = categorized[prefix];
        const ids = chans.map((c) => c.id);
        const allSelected = ids.every((id) => selectedChannels.includes(id));
        const someSelected = ids.some((id) => selectedChannels.includes(id));

        return (
          <div key={prefix}>
            <div className="flex items-center gap-2 mb-1.5">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                onChange={() => onToggleCategory(ids)}
                className="rounded border-input accent-primary"
              />
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cat.color}`}>
                {cat.label}
              </span>
              <span className="text-xs text-muted-foreground">({chans.length})</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 ml-5 mb-2">
              {chans
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((ch) => (
                  <label key={ch.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                    <input
                      type="checkbox"
                      checked={selectedChannels.includes(ch.id)}
                      onChange={() => onToggle(ch.id)}
                      className="rounded border-input accent-primary"
                    />
                    #{ch.name}
                  </label>
                ))}
            </div>
          </div>
        );
      })}

      {groupDms.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <input
              type="checkbox"
              checked={groupDms.every((c) => selectedChannels.includes(c.id))}
              ref={(el) => {
                if (el) {
                  const some = groupDms.some((c) => selectedChannels.includes(c.id));
                  const all = groupDms.every((c) => selectedChannels.includes(c.id));
                  el.indeterminate = some && !all;
                }
              }}
              onChange={() => onToggleCategory(groupDms.map((c) => c.id))}
              className="rounded border-input accent-primary"
            />
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">
              Group DMs
            </span>
            <span className="text-xs text-muted-foreground">({groupDms.length})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 ml-5">
            {groupDms.map((ch) => (
              <label key={ch.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                <input
                  type="checkbox"
                  checked={selectedChannels.includes(ch.id)}
                  onChange={() => onToggle(ch.id)}
                  className="rounded border-input accent-primary"
                />
                {ch.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {uncategorized.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <input
              type="checkbox"
              checked={uncategorized.every((c) => selectedChannels.includes(c.id))}
              ref={(el) => {
                if (el) {
                  const some = uncategorized.some((c) => selectedChannels.includes(c.id));
                  const all = uncategorized.every((c) => selectedChannels.includes(c.id));
                  el.indeterminate = some && !all;
                }
              }}
              onChange={() => onToggleCategory(uncategorized.map((c) => c.id))}
              className="rounded border-input accent-primary"
            />
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-800">
              Other
            </span>
            <span className="text-xs text-muted-foreground">({uncategorized.length})</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 ml-5">
            {uncategorized
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((ch) => (
                <label key={ch.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                  <input
                    type="checkbox"
                    checked={selectedChannels.includes(ch.id)}
                    onChange={() => onToggle(ch.id)}
                    className="rounded border-input accent-primary"
                  />
                  #{ch.name}
                </label>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelSearchInput({
  channels,
  value,
  onChange,
}: {
  channels: SlackChannel[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Sync external value changes (e.g. from applyParsedItem)
  useEffect(() => { setQuery(value); }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const normalized = query.replace(/^#/, "").toLowerCase().trim();
  const filtered = normalized
    ? channels.filter((ch) => ch.name.toLowerCase().includes(normalized))
    : channels;

  return (
    <div ref={ref} className="relative">
      <Input
        placeholder="#channel-name"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
          {filtered.slice(0, 30).map((ch) => (
            <button
              key={ch.id}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors ${
                value === `#${ch.name}` ? "bg-muted font-medium" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                const val = `#${ch.name}`;
                setQuery(val);
                onChange(val);
                setOpen(false);
              }}
            >
              #{ch.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
