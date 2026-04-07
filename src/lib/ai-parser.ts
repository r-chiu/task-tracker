import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface AIParsedItem {
  description: string;
  suggestedOwner: string | null;
  suggestedDeadline: string | null;
  suggestedPriority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  confidence: "high" | "medium" | "low";
  title: string;
}

// Lazy-init clients (only when keys are available)
let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function getAnthropic(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) anthropicClient = new Anthropic();
  return anthropicClient;
}

function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) openaiClient = new OpenAI();
  return openaiClient;
}

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

const PARSE_PROMPT = `You are a task extraction assistant for a corporate task management system. Your job is to analyze text (pasted messages, meeting notes, conversations, or plain task descriptions) and extract actionable tasks.

Rules:
1. If the text describes one or more tasks/action items, extract each one.
2. A task is anything someone needs to DO — it doesn't need specific keywords or verbs.
3. For the title field: use 3-7 words in "Verb + object" format. Keep it specific. No punctuation unless necessary.
4. Suggest priority: CRITICAL (urgent/blocking), HIGH (important/time-sensitive), MEDIUM (normal), LOW (no rush).
5. If a person's name is mentioned as the one who should do it, set them as suggestedOwner.
6. If a deadline/date is mentioned, extract it in YYYY-MM-DD format. For relative dates like "next Friday", resolve based on today's date provided in the prompt.
7. Set confidence: "high" if it's clearly a task, "medium" if likely, "low" if ambiguous.
8. If the text contains NO actionable items (just a question, greeting, or status update with nothing to do), return an empty array.
9. If multiple tasks exist in the same text block, extract each as a separate item.

Respond ONLY with valid JSON — no markdown, no explanation. Format:
{ "items": [ { "description": "full original text for this task", "title": "3-7 word verb+object title", "suggestedOwner": "name or null", "suggestedDeadline": "YYYY-MM-DD or null", "suggestedPriority": "MEDIUM", "confidence": "high" } ] }`;

const TITLE_PROMPT = `You are a task-title extraction assistant.

Your job is to read arbitrary text and return the single best summarized task name.

Rules:
- Identify the main actionable item.
- Return only one task name.
- Use 3 to 7 words.
- Prefer: Verb + object.
- Be specific and concise.
- Do not include explanation, notes, labels, or punctuation unless necessary.
- If multiple tasks are mentioned, choose the highest-priority one using this order:
  1. Explicit request
  2. Urgent or deadline-driven task
  3. Blocking dependency
  4. First actionable item mentioned
- If there is no clear action, return the main topic as a short noun phrase.
- Avoid generic outputs like:
  - Review task
  - Handle issue
  - General follow-up

Return valid JSON only in this format:
{"task_name":"<task name>"}`;

// ============================================================================
// TITLE GENERATION — tries Anthropic, then OpenAI, then returns null
// ============================================================================

async function titleViaAnthropic(description: string): Promise<string | null> {
  const client = getAnthropic();
  if (!client) return null;

  const response = await client.messages.create({
    model: "claude-haiku-4-20250414",
    max_tokens: 100,
    system: TITLE_PROMPT,
    messages: [{ role: "user", content: `Text to analyze:\n${description}` }],
  });

  const content = response.content[0];
  if (content.type !== "text") return null;
  const parsed = JSON.parse(content.text.trim());
  return (parsed.task_name || "").trim() || null;
}

async function titleViaOpenAI(description: string): Promise<string | null> {
  const client = getOpenAI();
  if (!client) return null;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 100,
    messages: [
      { role: "system", content: TITLE_PROMPT },
      { role: "user", content: `Text to analyze:\n${description}` },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim();
  if (!text) return null;
  const parsed = JSON.parse(text);
  return (parsed.task_name || "").trim() || null;
}

/**
 * Generate a concise task title from a description.
 * Tries Anthropic first, falls back to OpenAI, returns null if both fail.
 */
export async function aiGenerateTitle(description: string): Promise<string | null> {
  // Try Anthropic first
  try {
    const title = await titleViaAnthropic(description);
    if (title) return title;
  } catch (err) {
    console.error("Anthropic title error:", err);
  }

  // Fall back to OpenAI
  try {
    const title = await titleViaOpenAI(description);
    if (title) return title;
  } catch (err) {
    console.error("OpenAI title error:", err);
  }

  return null;
}

// ============================================================================
// TEXT PARSING — tries Anthropic, then OpenAI, then returns null
// ============================================================================

async function parseViaAnthropic(text: string): Promise<AIParsedItem[] | null> {
  const client = getAnthropic();
  if (!client) return null;

  const today = new Date().toISOString().split("T")[0];
  const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });

  const response = await client.messages.create({
    model: "claude-haiku-4-20250414",
    max_tokens: 1024,
    system: PARSE_PROMPT,
    messages: [
      {
        role: "user",
        content: `Today is ${dayOfWeek}, ${today}.\n\nAnalyze this text and extract any action items:\n\n${text}`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") return null;
  return parseParsedResponse(content.text, text);
}

async function parseViaOpenAI(text: string): Promise<AIParsedItem[] | null> {
  const client = getOpenAI();
  if (!client) return null;

  const today = new Date().toISOString().split("T")[0];
  const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 1024,
    messages: [
      { role: "system", content: PARSE_PROMPT },
      {
        role: "user",
        content: `Today is ${dayOfWeek}, ${today}.\n\nAnalyze this text and extract any action items:\n\n${text}`,
      },
    ],
  });

  const responseText = response.choices[0]?.message?.content?.trim();
  if (!responseText) return null;
  return parseParsedResponse(responseText, text);
}

function parseParsedResponse(responseText: string, originalText: string): AIParsedItem[] {
  const parsed = JSON.parse(responseText);
  return (parsed.items || []).map((item: Record<string, unknown>) => ({
    description: (item.description as string) || originalText.trim(),
    title: (item.title as string) || "",
    suggestedOwner: (item.suggestedOwner as string) || null,
    suggestedDeadline: (item.suggestedDeadline as string) || null,
    suggestedPriority: (item.suggestedPriority as string) || "MEDIUM",
    confidence: (item.confidence as string) || "medium",
  }));
}

/**
 * Detect and extract action items from text using AI.
 * Tries Anthropic first, falls back to OpenAI, returns null if both fail.
 */
export async function aiParseText(text: string): Promise<AIParsedItem[] | null> {
  // Try Anthropic first
  try {
    const items = await parseViaAnthropic(text);
    if (items !== null) return items;
  } catch (err) {
    console.error("Anthropic parse error:", err);
  }

  // Fall back to OpenAI
  try {
    const items = await parseViaOpenAI(text);
    if (items !== null) return items;
  } catch (err) {
    console.error("OpenAI parse error:", err);
  }

  return null;
}
