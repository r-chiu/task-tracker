import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  console.log("API key set:", !!process.env.ANTHROPIC_API_KEY);
  console.log("Key prefix:", process.env.ANTHROPIC_API_KEY?.slice(0, 15));

  const client = new Anthropic();

  const TITLE_PROMPT = `Analyze the text and identify the single main actionable task.

Output JSON only:
{
  "task_name": "<3-7 word concise task title>"
}

Rules:
- Prefer format: Verb + object
- Keep it specific
- No punctuation unless necessary
- No explanation
- If multiple tasks exist, choose the highest-priority one
- If no action exists, summarize the main topic
- Never return anything except valid JSON`;

  const text = "To tag the litter and link it back to the placement info of each house at Perdue";

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-20250414",
      max_tokens: 100,
      system: TITLE_PROMPT,
      messages: [{ role: "user", content: `Text:\n${text}` }],
    });
    console.log("Response:", JSON.stringify(response.content));
    const content = response.content[0];
    if (content.type === "text") {
      console.log("Raw text:", content.text);
      const parsed = JSON.parse(content.text.trim());
      console.log("Title:", parsed.task_name);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

main().catch(console.error);
