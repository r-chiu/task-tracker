import Anthropic from "@anthropic-ai/sdk";

export interface AIParsedItem {
  description: string;
  suggestedOwner: string | null;
  suggestedDeadline: string | null;
  suggestedPriority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  confidence: "high" | "medium" | "low";
  title: string;
}

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
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
// OLLAMA (LOCAL LLM) FALLBACK
// ============================================================================

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gpt-oss";

const OLLAMA_TITLE_PROMPT = `Analyze the text and identify the single main actionable task.

Rules:
- Prefer format: Verb + object
- Use 3 to 7 words
- Keep it specific and concise
- No punctuation unless necessary
- No explanation
- If multiple tasks exist, choose the highest-priority one using this order:
  1. Explicit request
  2. Urgent or deadline-driven task
  3. Blocking dependency
  4. First actionable item mentioned
- If there is no clear action, return the main topic as a short noun phrase
- Avoid generic outputs like "Review task", "Handle issue", "General follow-up"

You MUST respond with ONLY valid JSON in this exact format: {"task_name": "your task name here"}
Never return anything else.`;

async function titleViaOllama(description: string): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: "system", content: OLLAMA_TITLE_PROMPT },
          { role: "user", content: `Text:\n${description}` },
        ],
        stream: false,
        options: { temperature: 0 },
        format: {
          type: "object",
          properties: {
            task_name: { type: "string" },
          },
          required: ["task_name"],
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.message?.content?.trim();
    if (!text) return null;

    const parsed = JSON.parse(text);
    return (parsed.task_name || "").trim() || null;
  } catch (err) {
    console.error("Ollama title generation error:", err);
    return null;
  }
}

// ============================================================================
// GROQ (FREE CLOUD LLM) FALLBACK
// ============================================================================

const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

function getGroqKey(): string | undefined {
  return process.env.GROQ_API_KEY;
}

async function titleViaGroq(description: string): Promise<string | null> {
  const GROQ_API_KEY = getGroqKey();
  if (!GROQ_API_KEY) { console.error("[Groq] No API key"); return null; }
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: OLLAMA_TITLE_PROMPT },
          { role: "user", content: `Analyze this text and return {"task_name": "..."} with a 3-7 word task title:\n\n${description}` },
        ],
        temperature: 0,
        max_tokens: 100,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[Groq] API error:", res.status, body);
      // If JSON validation failed, try to extract from failed_generation
      try {
        const errData = JSON.parse(body);
        const failed = errData?.error?.failed_generation;
        if (failed) {
          // Try to extract any reasonable string from the failed output
          const cleaned = failed.replace(/[{}"'\n]/g, "").trim();
          if (cleaned && cleaned.length > 2 && cleaned.length < 80) return cleaned;
        }
      } catch {}
      return null;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) { console.error("[Groq] Empty response"); return null; }

    const parsed = JSON.parse(text);
    return (parsed.task_name || "").trim() || null;
  } catch (err) {
    console.error("Groq title generation error:", err);
    return null;
  }
}

async function parseViaGroq(text: string): Promise<AIParsedItem[] | null> {
  const GROQ_API_KEY = getGroqKey();
  if (!GROQ_API_KEY) return null;
  try {
    const today = new Date().toISOString().split("T")[0];
    const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: PARSE_PROMPT },
          {
            role: "user",
            content: `Today is ${dayOfWeek}, ${today}.\n\nAnalyze this text and extract any action items:\n\n${text}`,
          },
        ],
        temperature: 0,
        max_tokens: 1024,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const parsed = JSON.parse(content);
    return (parsed.items || []).map((item: Record<string, unknown>) => ({
      description: (item.description as string) || text.trim(),
      title: (item.title as string) || "",
      suggestedOwner: (item.suggestedOwner as string) || null,
      suggestedDeadline: (item.suggestedDeadline as string) || null,
      suggestedPriority: (item.suggestedPriority as string) || "MEDIUM",
      confidence: (item.confidence as string) || "medium",
    }));
  } catch (err) {
    console.error("Groq parser error:", err);
    return null;
  }
}

// ============================================================================
// TITLE GENERATION
// ============================================================================

/**
 * Generate a concise task title from a description.
 * Chain: Anthropic → Groq (free) → Ollama (local) → null (callers fall back to regex).
 */
export async function aiGenerateTitle(description: string): Promise<string | null> {
  // Try Anthropic first
  const api = getClient();
  if (api) {
    try {
      const response = await api.messages.create({
        model: "claude-haiku-4-20250414",
        max_tokens: 100,
        system: TITLE_PROMPT,
        messages: [{ role: "user", content: `Text to analyze:\n${description}` }],
      });

      const content = response.content[0];
      if (content.type === "text") {
        const parsed = JSON.parse(content.text.trim());
        const title = (parsed.task_name || "").trim();
        if (title) return title;
      }
    } catch (err) {
      console.error("Anthropic title generation error:", err);
    }
  }

  // Fall back to Groq (free cloud)
  const groqTitle = await titleViaGroq(description);
  if (groqTitle) return groqTitle;

  // Fall back to local Ollama
  return titleViaOllama(description);
}

// ============================================================================
// TEXT PARSING
// ============================================================================

/**
 * Parse action items via local Ollama. Returns null on failure.
 */
async function parseViaOllama(text: string): Promise<AIParsedItem[] | null> {
  try {
    const today = new Date().toISOString().split("T")[0];
    const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });

    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: "system", content: PARSE_PROMPT },
          {
            role: "user",
            content: `Today is ${dayOfWeek}, ${today}.\n\nAnalyze this text and extract any action items:\n\n${text}`,
          },
        ],
        stream: false,
        options: { temperature: 0 },
        format: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: { type: "string" },
                  title: { type: "string" },
                  suggestedOwner: { type: "string" },
                  suggestedDeadline: { type: "string" },
                  suggestedPriority: { type: "string" },
                  confidence: { type: "string" },
                },
                required: ["description", "title", "suggestedPriority", "confidence"],
              },
            },
          },
          required: ["items"],
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.message?.content?.trim();
    if (!content) return null;

    const parsed = JSON.parse(content);
    return (parsed.items || []).map((item: Record<string, unknown>) => ({
      description: (item.description as string) || text.trim(),
      title: (item.title as string) || "",
      suggestedOwner: (item.suggestedOwner as string) || null,
      suggestedDeadline: (item.suggestedDeadline as string) || null,
      suggestedPriority: (item.suggestedPriority as string) || "MEDIUM",
      confidence: (item.confidence as string) || "medium",
    }));
  } catch (err) {
    console.error("Ollama parser error:", err);
    return null;
  }
}

/**
 * Detect and extract action items from text.
 * Chain: Anthropic → Groq (free) → Ollama (local) → null (callers fall back to regex).
 */
export async function aiParseText(text: string): Promise<AIParsedItem[] | null> {
  // Try Anthropic first
  const api = getClient();
  if (api) {
    try {
      const today = new Date().toISOString().split("T")[0];
      const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });

      const response = await api.messages.create({
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
      if (content.type === "text") {
        const parsed = JSON.parse(content.text);
        return (parsed.items || []).map((item: Record<string, unknown>) => ({
          description: (item.description as string) || text.trim(),
          title: (item.title as string) || "",
          suggestedOwner: (item.suggestedOwner as string) || null,
          suggestedDeadline: (item.suggestedDeadline as string) || null,
          suggestedPriority: (item.suggestedPriority as string) || "MEDIUM",
          confidence: (item.confidence as string) || "medium",
        }));
      }
    } catch (err) {
      console.error("Anthropic parser error:", err);
    }
  }

  // Fall back to Groq (free cloud)
  const groqResult = await parseViaGroq(text);
  if (groqResult) return groqResult;

  // Fall back to local Ollama
  return parseViaOllama(text);
}
