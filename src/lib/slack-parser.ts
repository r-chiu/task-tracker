export interface ParsedActionItem {
  description: string;
  suggestedOwner: string | null;
  suggestedDeadline: string | null;
  suggestedPriority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | null;
  confidence: "high" | "medium" | "low";
  sender: string | null;
  timestamp: string | null;
  /** Owner group/section the item belongs to (e.g. "Calyx / Ray team") */
  ownerGroup: string | null;
}

// ============================================================================
// MODE DETECTION — structured meeting notes vs. raw Slack/chat
// ============================================================================

/** Header patterns that indicate structured meeting notes */
const SECTION_HEADER_PATTERNS = [
  /^#+\s+/,                                       // Markdown headers: ## Action Items
  /^(?:action\s+items?|tasks?|to-?do|follow[- ]?ups?|next\s+steps?|decisions?|takeaways?)\s*$/i,
  /^.*(?:team|group|department|side)\s*$/i,        // "Calyx / Ray team", "Engineering team"
  /^(?:joint|shared|combined|mutual|cross[- ]?team)\s*$/i,
  /^[A-Z][A-Za-z\s/&,]+(?:team|group|side)$/,     // Capitalized team name ending
  /^[A-Z][A-Za-z\s/&]+(?:\/\s*[A-Z][A-Za-z\s]+)$/, // "Calyx / Ray" pattern
];

/** Detect if a line is a section header (not an action item itself) */
function isSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  // Must not start with bullet/number indicators
  if (/^[-•*▪▸►◆●]\s/.test(trimmed)) return false;
  if (/^\d+[.)]\s/.test(trimmed)) return false;
  // Check header patterns
  return SECTION_HEADER_PATTERNS.some((p) => p.test(trimmed));
}

/** Detect if a line looks like a bullet or numbered list item */
function isBulletLine(line: string): boolean {
  const trimmed = line.trim();
  return /^[-•*▪▸►◆●]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed);
}

/** Strip bullet/number prefix from a line */
function stripBullet(line: string): string {
  return line.trim()
    .replace(/^[-•*▪▸►◆●]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

/** Check if a line looks like an actionable content line (not a header, not empty) */
function isContentLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 15) return false;
  if (isSectionHeader(trimmed)) return false;
  // Sentence-like: contains a verb-ish word and is reasonably long
  return true;
}

/**
 * Detect whether pasted text is structured (meeting notes, AI-generated summaries)
 * vs. free-form (Slack messages, emails, raw chat).
 */
function isStructuredText(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;

  let headerCount = 0;
  let bulletCount = 0;
  let contentAfterHeaders = 0;

  let lastWasHeader = false;
  for (const line of lines) {
    if (isSectionHeader(line)) {
      headerCount++;
      lastWasHeader = true;
    } else if (isBulletLine(line)) {
      bulletCount++;
      lastWasHeader = false;
    } else if (isContentLine(line)) {
      if (lastWasHeader || headerCount > 0) contentAfterHeaders++;
      lastWasHeader = false;
    }
  }

  // Structured if: has section headers with content lines under them
  if (headerCount >= 2 && (bulletCount + contentAfterHeaders) >= 3) return true;

  // Has section headers with bullets under them
  if (headerCount >= 1 && bulletCount >= 3) return true;

  // Mostly bullet lines (>60%) — typical AI-generated action list
  if (bulletCount / lines.length > 0.6 && bulletCount >= 4) return true;

  // Has clear "action items" / "next steps" header with content following
  const hasActionHeader = lines.some((l) =>
    /^(?:action\s+items?|next\s+steps?|to-?do|follow[- ]?ups?)\s*$/i.test(l.trim())
  );
  if (hasActionHeader && lines.length >= 4) return true;

  return false;
}

// ============================================================================
// STRUCTURED TEXT PARSER (meeting notes, AI summaries)
// ============================================================================

/** Known person name patterns — "Jared to...", "Ray should..." */
const PERSON_ACTION_PATTERN =
  /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:to|should|will|needs?\s+to|must|has\s+to|is\s+going\s+to)\s+/;

/** Deadline patterns embedded in text (broader than Slack-specific ones) */
const INLINE_DEADLINE_PATTERNS: { pattern: RegExp; resolve: (m: string) => string | null }[] = [
  { pattern: /(\d{4}-\d{2}-\d{2})/, resolve: (m) => m },
  { pattern: /\bby\s+(?:end\s+of\s+)?(today|tomorrow|eod)\b/i, resolve: (m) => resolveRelativeDate(m) },
  { pattern: /\bby\s+(?:end\s+of\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, resolve: (m) => resolveRelativeDate("next " + m) },
  { pattern: /\bby\s+(next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month))\b/i, resolve: (m) => resolveRelativeDate(m) },
  { pattern: /\b(?:by|before|due)\s+(end\s+of\s+(?:day|week|month|quarter|year))\b/i, resolve: (m) => resolveRelativeDate(m) },
  { pattern: /\b(?:by|before|due)\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(?:,?\s+\d{4})?)\b/i, resolve: (m) => parseFuzzyDate(m) },
  { pattern: /\b(?:by|before|due)\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i, resolve: (m) => parseFuzzyDate(m) },
  { pattern: /\b(this\s+(?:friday|week|month))\b/i, resolve: (m) => resolveRelativeDate(m) },
  // "the next day", "next sync", "tomorrow" standalone
  { pattern: /\b(?:the\s+)?next\s+day\b/i, resolve: () => resolveRelativeDate("tomorrow") },
  // "on Wednesday" (without "by")
  { pattern: /\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, resolve: (m) => resolveRelativeDate("next " + m) },
];

/** Priority signals for structured items */
function inferStructuredPriority(text: string, ownerGroup: string | null): ParsedActionItem["suggestedPriority"] {
  const lower = text.toLowerCase();

  // Explicit priority keywords
  if (/\b(?:urgent|asap|immediately|critical|emergency|blocker)\b/i.test(text)) return "CRITICAL";
  if (/\b(?:high\s*priority|important|time[- ]?sensitive)\b/i.test(text)) return "HIGH";
  if (/\b(?:low\s*priority|no\s*rush|whenever|fyi)\b/i.test(text)) return "LOW";

  // Has a deadline → higher priority
  if (INLINE_DEADLINE_PATTERNS.some(({ pattern }) => pattern.test(text))) return "HIGH";

  // "confirm", "verify", "finalize" → higher importance
  if (/\b(?:confirm|verify|finalize|ensure|must|critical)\b/i.test(lower)) return "HIGH";

  // "evaluate", "consider", "explore" → lower
  if (/\b(?:evaluate|consider|explore|look\s+into|brainstorm)\b/i.test(lower)) return "LOW";

  // Joint/shared items tend to be more important (coordination)
  if (ownerGroup && /\bjoint|shared|cross/i.test(ownerGroup)) return "HIGH";

  return "MEDIUM";
}

function extractInlineDeadline(text: string): string | null {
  for (const { pattern, resolve } of INLINE_DEADLINE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const resolved = resolve(match[1]);
      if (resolved) return resolved;
    }
  }
  return null;
}

function extractNamedOwner(text: string): string | null {
  const match = text.match(PERSON_ACTION_PATTERN);
  if (match) return match[1];
  return null;
}

/**
 * Parse structured text (meeting notes, AI summaries) into action items.
 * Detects section headers as ownership groups, each bullet = one task.
 */
function parseStructuredText(text: string): ParsedActionItem[] {
  const lines = text.split("\n");
  const items: ParsedActionItem[] = [];
  let currentGroup: string | null = null;

  // First pass: identify the top-level header (like "Action Items") to skip it
  let skipTopHeader = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Detect section headers
    if (isSectionHeader(trimmed)) {
      const clean = trimmed.replace(/^#+\s*/, "").trim();
      // Skip top-level headers like "Action Items", "Next Steps"
      if (/^(?:action\s+items?|next\s+steps?|to-?do|follow[- ]?ups?|takeaways?|decisions?)\s*$/i.test(clean)) {
        skipTopHeader = true;
        continue;
      }
      currentGroup = clean;
      continue;
    }

    // Process lines that look like action items:
    // - Bulleted/numbered lines anywhere
    // - Plain sentences under a section header (common in AI-generated notes)
    // - Indented lines
    const isBullet = isBulletLine(trimmed);

    // Skip very short lines
    const content = stripBullet(trimmed);
    if (content.length < 15) continue;

    // Skip lines that look like sub-headers within a section
    if (isSectionHeader(content)) {
      currentGroup = content;
      continue;
    }

    // Extract metadata
    const namedOwner = extractNamedOwner(content);
    const deadline = extractInlineDeadline(content);
    const priority = inferStructuredPriority(content, currentGroup);

    // Build owner string: named person > group name
    let owner: string | null = namedOwner;
    if (!owner && currentGroup) {
      // Try to extract a person name from the group (e.g. "Calyx / Ray team" → "Ray")
      const groupNameMatch = currentGroup.match(/\b([A-Z][a-z]+)\s+team\b/i);
      if (groupNameMatch) owner = groupNameMatch[1];
    }

    items.push({
      description: content,
      suggestedOwner: owner,
      suggestedDeadline: deadline,
      suggestedPriority: priority,
      confidence: "high", // All items in structured notes are high confidence
      sender: null,
      timestamp: null,
      ownerGroup: currentGroup,
    });
  }

  return items;
}

// ============================================================================
// SLACK MESSAGE SCORER (chat messages, real-time conversations)
// ============================================================================

const ACTION_VERBS =
  /\b(?:please|pls|need\s+to|must|should|have\s+to|make\s+sure|ensure|follow[- ]?up|send|submit|prepare|review|update|finalize|confirm|complete|finish|deliver|schedule|arrange|set\s+up|coordinate|check|handle|resolve|fix|address|prioritize|assign|create|draft|approve|sign|share|forward|respond|reply|reach\s+out|contact|call|meet|discuss|plan|organize|provide|report|investigate|escalate|tag|link|track|upload|download|move|transfer|collect|gather|compile|verify|validate|process|analyze|audit|monitor|configure|install|deploy|migrate|archive|backup|document|register|onboard|evaluate|implement|integrate|notify|inform|announce|publish|release|setup|clean\s*up|sort|label|categorize|catalog|inventory|map|align|sync|connect|attach|embed|log|record|file|scan|print|ship|pack|order|book|reserve|purchase|procure|source|negotiate|approve|reject|assess|benchmark|measure|test|debug|patch|refactor|optimize|design|prototype|mock\s*up|wireframe|sketch|outline|summarize|transcribe|translate|convert|format|rename|restructure|consolidate|merge|split|separate|filter|export|import|index|list|tally|count|reconcile|cross[- ]?reference|flag|mark|stamp|note|annotate|highlight|pin|bookmark|snapshot|clone|replicate|duplicate|mirror|route|dispatch|distribute|delegate|elevate|downgrade|reclassify|resubmit|refile|reissue|reassign)\b/i;

const DEADLINE_WORDS =
  /\b(?:by\s+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|eod|end\s+of|next\s+week|next\s+month)|deadline|due\s+(?:date|by|on)|asap|urgent|immediately|before\s+(?:the\s+)?meeting|this\s+week|this\s+month|end\s+of\s+(?:day|week|month)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}|\d{1,2}\/\d{1,2})\b/i;

const REQUEST_PATTERNS =
  /\b(?:can\s+you|could\s+you|will\s+you|would\s+you|i\s+need|we\s+need|let'?s|let\s+me\s+know|action\s+item|to-?do|task|reminder|don'?t\s+forget|remember\s+to|heads\s+up|fyi\s+.{10,}|important|attention|required|mandatory|@\w+)\b/i;

const QUESTION_ONLY = /^[^.!]*\?[\s]*$/;
const TRIVIAL =
  /^(?:ok|okay|sure|thanks|thank\s+you|got\s+it|sounds\s+good|lol|haha|👍|🙏|✅|great|nice|cool|yes|no|yep|nope|noted|will\s+do|on\s+it)[\s!.]*$/i;

const PRIORITY_PATTERNS: { pattern: RegExp; priority: "CRITICAL" | "HIGH" | "LOW" }[] = [
  { pattern: /\b(?:urgent|asap|immediately|critical|emergency|blocker|blocking)\b/i, priority: "CRITICAL" },
  { pattern: /\b(?:high\s*priority|important|priority\s*(?:is\s*)?high|time[- ]?sensitive)\b/i, priority: "HIGH" },
  { pattern: /\b(?:low\s*priority|whenever|no\s*rush|when\s*you\s*(?:get\s*a\s*)?chance|not\s+urgent|fyi\s+only)\b/i, priority: "LOW" },
];

/** Detect "To [verb] ..." pattern — a very common way to describe tasks */
const TO_VERB_PATTERN =
  /^to\s+[a-z]+\b/i;

function scoreMessage(text: string): number {
  if (!text || text.trim().length < 15) return 0;
  if (TRIVIAL.test(text.trim())) return 0;
  if (QUESTION_ONLY.test(text.trim()) && text.length < 80) return 0;

  let score = 0;

  // "To [verb] ..." is a strong task signal (e.g. "To tag the litter and link it...")
  if (TO_VERB_PATTERN.test(text.trim())) score += 5;

  const actionMatches = text.match(new RegExp(ACTION_VERBS.source, "gi"));
  if (actionMatches) score += Math.min(actionMatches.length * 3, 9);
  if (DEADLINE_WORDS.test(text)) score += 4;
  const requestMatches = text.match(new RegExp(REQUEST_PATTERNS.source, "gi"));
  if (requestMatches) score += Math.min(requestMatches.length * 2, 6);
  const mentions = text.match(/<@\w+>|@\w+/g);
  if (mentions) score += Math.min(mentions.length * 2, 4);
  for (const { pattern } of PRIORITY_PATTERNS) {
    if (pattern.test(text)) { score += 3; break; }
  }
  if (text.length > 100) score += 1;
  if (text.length > 250) score += 1;
  return score;
}

const ACTIONABLE_THRESHOLD = 5;

const MENTION_PATTERN = /<@(\w+)>/;
const PLAIN_MENTION_PATTERN = /@(\w+)/;

function extractOwner(text: string): string | null {
  const slackMention = text.match(MENTION_PATTERN);
  if (slackMention) return slackMention[1];
  const plain = text.match(PLAIN_MENTION_PATTERN);
  if (plain) return plain[1];
  return null;
}

function extractDeadline(text: string): string | null {
  return extractInlineDeadline(text);
}

function extractPriority(text: string): ParsedActionItem["suggestedPriority"] {
  for (const { pattern, priority } of PRIORITY_PATTERNS) {
    if (pattern.test(text)) return priority;
  }
  return null;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Score and filter a list of Slack messages, returning only actionable ones.
 * Each message is evaluated as a whole — not broken into lines.
 */
export function scoreSlackMessages(
  messages: { text: string; user: string | null; ts: string }[]
): ParsedActionItem[] {
  const items: ParsedActionItem[] = [];

  for (const msg of messages) {
    const score = scoreMessage(msg.text);
    if (score < ACTIONABLE_THRESHOLD) continue;

    let confidence: "high" | "medium" | "low" = "low";
    if (score >= 10) confidence = "high";
    else if (score >= 7) confidence = "medium";

    items.push({
      description: msg.text.trim(),
      suggestedOwner: extractOwner(msg.text),
      suggestedDeadline: extractDeadline(msg.text),
      suggestedPriority: extractPriority(msg.text),
      confidence,
      sender: msg.user,
      timestamp: msg.ts,
      ownerGroup: null,
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => order[a.confidence] - order[b.confidence]);
  return items;
}

/**
 * Smart parser for pasted text. Auto-detects format:
 * - Structured (meeting notes, AI summaries) → section-aware line-by-line parsing
 * - Free-form (Slack messages, emails) → whole-block scoring
 */
export function parseSlackMessage(text: string): ParsedActionItem[] {
  // Try structured mode first
  if (isStructuredText(text)) {
    const items = parseStructuredText(text);
    if (items.length > 0) return items;
    // Fall through to free-form if structured parsing yields nothing
  }

  // Free-form mode: split into paragraphs, score each one
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim().length > 10);
  const messages = blocks.length > 1
    ? blocks.map((b) => ({ text: b.trim(), user: null, ts: "" }))
    : [{ text: text.trim(), user: null, ts: "" }];

  const items: ParsedActionItem[] = [];
  for (const msg of messages) {
    const score = scoreMessage(msg.text);
    if (score < 3) continue;

    let confidence: "high" | "medium" | "low" = "low";
    if (score >= 10) confidence = "high";
    else if (score >= 6) confidence = "medium";

    items.push({
      description: msg.text.trim(),
      suggestedOwner: extractOwner(msg.text),
      suggestedDeadline: extractDeadline(msg.text),
      suggestedPriority: extractPriority(msg.text),
      confidence,
      sender: null,
      timestamp: null,
      ownerGroup: null,
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => order[a.confidence] - order[b.confidence]);
  return items;
}

// ============================================================================
// TITLE GENERATION — concise subject from verbose action text
// ============================================================================

/** Common imperative verbs that start task descriptions — these should NOT be treated as person names */
const IMPERATIVE_VERBS = new Set([
  "take", "send", "give", "bring", "make", "get", "set", "put", "ask", "tell",
  "call", "meet", "check", "review", "update", "fix", "add", "move", "find",
  "help", "show", "share", "follow", "reach", "submit", "prepare", "schedule",
  "arrange", "coordinate", "handle", "resolve", "address", "draft", "approve",
  "sign", "forward", "respond", "reply", "contact", "plan", "organize", "provide",
  "report", "investigate", "escalate", "create", "deliver", "finish", "complete",
  "confirm", "ensure", "assign", "buy", "book", "pick", "drop", "invite",
  "remind", "notify", "inform", "discuss", "present", "demo", "test", "deploy",
  "push", "pull", "merge", "build", "run", "start", "stop", "cancel", "close",
  "open", "read", "write", "print", "order", "pay", "transfer", "clean", "file",
  "tag", "link", "track", "upload", "download", "collect", "gather", "compile",
  "verify", "validate", "process", "analyze", "audit", "monitor", "configure",
  "install", "migrate", "archive", "backup", "document", "register", "evaluate",
  "implement", "integrate", "publish", "release", "sort", "label", "categorize",
  "catalog", "inventory", "map", "align", "sync", "connect", "attach", "log",
  "record", "scan", "ship", "pack", "reserve", "purchase", "procure", "source",
  "negotiate", "assess", "measure", "debug", "patch", "refactor", "optimize",
  "design", "prototype", "outline", "summarize", "transcribe", "translate",
  "convert", "format", "rename", "restructure", "consolidate", "split",
  "separate", "filter", "export", "import", "index", "list", "reconcile",
  "flag", "mark", "stamp", "note", "annotate", "highlight", "pin",
]);

/** Phrases to strip from the beginning (person + action verb prefix, or bare "To [verb]") */
const PERSON_PREFIX =
  /^(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+)?(?:to|should|will|needs?\s+to|must|has\s+to|is\s+going\s+to|would\s+like\s+to|wants?\s+to)\s+/i;

/** @mention patterns to strip */
const MENTION_STRIP = /(?:<@\w+>|@\w+)\s*/g;

/** Deadline / time phrases to strip from the title */
const DEADLINE_STRIP =
  /\s*(?:by\s+(?:end\s+of\s+)?(?:today|tomorrow|eod|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+\w+|this\s+\w+|the\s+end\s+of\s+\w+)|by\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|before\s+(?:the\s+)?(?:meeting|deadline|end\s+of\s+\w+)|(?:due|on)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|(?:by|before|due)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(?:,?\s+\d{4})?|(?:by|before|due)\s+\d{4}-\d{2}-\d{2}|\b(?:asap|immediately|urgently|the\s+next\s+day)\b|\b(?:next|this)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)\b)\s*/gi;

/** Filler / hedge words to strip */
const FILLER_STRIP =
  /\b(?:please|pls|kindly|just|basically|actually|maybe|possibly|perhaps|if\s+possible|as\s+soon\s+as\s+possible)\b\s*/gi;

/** Priority / urgency tags to strip */
const PRIORITY_STRIP =
  /\s*\[?\b(?:urgent|high\s*priority|low\s*priority|critical|blocker)\b\]?\s*/gi;

/** Common trailing conjunctions/prepositions left after stripping */
const TRAILING_CLEANUP = /\s+(?:and|or|by|before|after|with|to|for|the|in|on|at|of|from|about|into)\s*$/i;

/**
 * Generate a concise, relevant task title from verbose action text.
 *
 * Examples:
 *   "Jared to speak with the Tyson procurement team about the next order of cameras by end of week"
 *     → "Speak with Tyson procurement team re camera order"
 *   "Confirm delivery schedule with Simmons Food by Friday"
 *     → "Confirm delivery schedule with Simmons Food"
 *   "Ray needs to prepare the Q2 sales presentation for the board meeting next Monday"
 *     → "Prepare Q2 sales presentation for board meeting"
 */
export function generateTitle(description: string): string {
  let text = description.trim();

  // 1. Strip @mentions
  text = text.replace(MENTION_STRIP, "").trim();

  // 2. Strip person + action verb prefix ("Jared to ...", "Ray needs to ...")
  //    But skip if the text starts with an imperative verb (e.g. "Take Zoe to dinner")
  const firstWord = text.split(/\s+/)[0]?.toLowerCase() || "";
  if (!IMPERATIVE_VERBS.has(firstWord)) {
    text = text.replace(PERSON_PREFIX, "").trim();
  }

  // 3. Strip deadline phrases
  text = text.replace(DEADLINE_STRIP, " ").trim();

  // 4. Strip filler words
  text = text.replace(FILLER_STRIP, " ").trim();

  // 5. Strip priority tags
  text = text.replace(PRIORITY_STRIP, " ").trim();

  // 6. Clean up multiple spaces
  text = text.replace(/\s{2,}/g, " ").trim();

  // 7. Clean up trailing conjunctions/prepositions
  text = text.replace(TRAILING_CLEANUP, "").trim();

  // 8. Remove trailing punctuation
  text = text.replace(/[.,;:!]+$/, "").trim();

  // 9. Capitalize first letter
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  // 10. Truncate intelligently — try to break at a word boundary
  const MAX_TITLE = 70;
  if (text.length > MAX_TITLE) {
    // Try to cut at a word boundary
    const truncated = text.slice(0, MAX_TITLE);
    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > MAX_TITLE * 0.5) {
      text = truncated.slice(0, lastSpace).trim();
    } else {
      text = truncated.trim();
    }
    // Clean trailing prepositions that truncation may have exposed
    let prev = "";
    while (prev !== text) {
      prev = text;
      text = text.replace(TRAILING_CLEANUP, "").trim();
    }
  }

  // 11. Fallback: if stripping removed everything meaningful, use first N chars of original
  if (text.length < 10) {
    const fallback = description.replace(MENTION_STRIP, "").trim();
    text = fallback.length > MAX_TITLE
      ? fallback.slice(0, MAX_TITLE).replace(/\s+\S*$/, "").trim()
      : fallback;
    if (text.length > 0) {
      text = text.charAt(0).toUpperCase() + text.slice(1);
    }
  }

  return text;
}

// ============================================================================
// DATE HELPERS
// ============================================================================

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function parseFuzzyDate(str: string): string | null {
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1]) - 1;
    const day = parseInt(slashMatch[2]);
    let year = slashMatch[3] ? parseInt(slashMatch[3]) : new Date().getFullYear();
    if (year < 100) year += 2000;
    return toISODate(new Date(year, month, day));
  }

  const namedMatch = str.match(/^(\w+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i);
  if (namedMatch) {
    const monthStr = namedMatch[1].toLowerCase();
    const month = MONTH_MAP[monthStr];
    if (month === undefined) return null;
    const day = parseInt(namedMatch[2]);
    const year = namedMatch[3] ? parseInt(namedMatch[3]) : new Date().getFullYear();
    return toISODate(new Date(year, month, day));
  }

  return null;
}

function resolveRelativeDate(str: string): string | null {
  const now = new Date();
  const lower = str.toLowerCase().trim();

  if (lower === "today" || lower === "eod") return toISODate(now);
  if (lower === "tomorrow") {
    now.setDate(now.getDate() + 1);
    return toISODate(now);
  }

  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };

  const nextDayMatch = lower.match(/(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (nextDayMatch) {
    const targetDay = dayMap[nextDayMatch[1]];
    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    now.setDate(now.getDate() + daysUntil);
    return toISODate(now);
  }

  if (lower.includes("this friday")) {
    const currentDay = now.getDay();
    let daysUntil = 5 - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    now.setDate(now.getDate() + daysUntil);
    return toISODate(now);
  }

  if (lower.includes("this week") || lower.includes("next week")) {
    const currentDay = now.getDay();
    const daysUntilFriday = ((5 - currentDay + 7) % 7) || 7;
    now.setDate(now.getDate() + daysUntilFriday);
    return toISODate(now);
  }

  if (lower.includes("this month")) {
    return toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }

  if (lower.includes("end of day")) return toISODate(now);

  if (lower.includes("end of week")) {
    const currentDay = now.getDay();
    const daysUntilFriday = ((5 - currentDay + 7) % 7) || 7;
    now.setDate(now.getDate() + daysUntilFriday);
    return toISODate(now);
  }

  if (lower.includes("end of month") || lower.includes("next month")) {
    return toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }

  if (lower.includes("end of quarter")) {
    const quarter = Math.floor(now.getMonth() / 3);
    return toISODate(new Date(now.getFullYear(), (quarter + 1) * 3, 0));
  }

  if (lower.includes("end of year")) {
    return toISODate(new Date(now.getFullYear(), 11, 31));
  }

  return null;
}
