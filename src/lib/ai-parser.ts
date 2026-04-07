import Anthropic from "@anthropic-ai/sdk";

export interface AIParsedItem {
  description: string;
  suggestedOwner: string | null;
  suggestedDeadline: string | null;
  suggestedPriority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  confidence: "high" | "medium" | "low";
  title: string;
}

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a task extraction assistant for a corporate task management system. Your job is to analyze text (pasted messages, meeting notes, conversations, or plain task descriptions) and extract actionable tasks.

Rules:
1. If the text describes one or more tasks/action items, extract each one.
2. A task is anything someone needs to DO — it doesn't need specific keywords or verbs.
3. Generate a concise title (under 70 characters) for each task.
4. Suggest priority: CRITICAL (urgent/blocking), HIGH (important/time-sensitive), MEDIUM (normal), LOW (no rush).
5. If a person's name is mentioned as the one who should do it, set them as suggestedOwner.
6. If a deadline/date is mentioned, extract it in YYYY-MM-DD format. For relative dates like "next Friday", resolve based on today's date provided in the prompt.
7. Set confidence: "high" if it's clearly a task, "medium" if likely, "low" if ambiguous.
8. If the text contains NO actionable items (just a question, greeting, or status update with nothing to do), return an empty array.

Respond ONLY with valid JSON — no markdown, no explanation. Format:
{ "items": [ { "description": "full original text for this task", "title": "concise title", "suggestedOwner": "name or null", "suggestedDeadline": "YYYY-MM-DD or null", "suggestedPriority": "MEDIUM", "confidence": "high" } ] }`;

/**
 * Use Claude AI to detect and extract action items from text.
 * Returns null if the API key is not configured or the call fails,
 * so callers can fall back to the regex-based parser.
 */
export async function aiParseText(text: string): Promise<AIParsedItem[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null; // No API key — caller should fall back to regex parser
  }

  try {
    const today = new Date().toISOString().split("T")[0];
    const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });

    const response = await client.messages.create({
      model: "claude-haiku-4-20250414",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Today is ${dayOfWeek}, ${today}.\n\nAnalyze this text and extract any action items:\n\n${text}`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") return null;

    const parsed = JSON.parse(content.text);
    const items: AIParsedItem[] = (parsed.items || []).map((item: Record<string, unknown>) => ({
      description: (item.description as string) || text.trim(),
      title: (item.title as string) || "",
      suggestedOwner: (item.suggestedOwner as string) || null,
      suggestedDeadline: (item.suggestedDeadline as string) || null,
      suggestedPriority: (item.suggestedPriority as string) || "MEDIUM",
      confidence: (item.confidence as string) || "medium",
    }));

    return items;
  } catch (err) {
    console.error("AI parser error:", err);
    return null; // Fall back to regex parser
  }
}

/**
 * Use Claude AI to generate a concise task title from a description.
 * Returns null if unavailable, so callers can fall back to regex-based title generation.
 */
export async function aiGenerateTitle(description: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-20250414",
      max_tokens: 100,
      system:
        "Generate a concise task title (under 70 characters) from the given task description. Return ONLY the title text, nothing else. Capitalize the first letter. Do not include quotes.",
      messages: [
        { role: "user", content: description },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") return null;

    const title = content.text.trim().replace(/^["']|["']$/g, "");
    return title.length > 0 ? title : null;
  } catch (err) {
    console.error("AI title generation error:", err);
    return null;
  }
}
