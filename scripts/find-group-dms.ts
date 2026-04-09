import { WebClient } from "@slack/web-api";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const slack = new WebClient(process.env.SLACK_USER_TOKEN);

async function main() {
  const allDms: { id: string; name: string; updated: number }[] = [];
  let cursor: string | undefined;

  do {
    const result = await slack.conversations.list({
      cursor,
      limit: 200,
      types: "mpim",
      exclude_archived: true,
    });
    for (const ch of result.channels ?? []) {
      if (ch.id) {
        allDms.push({
          id: ch.id,
          name: ch.name || ch.id,
          updated: ch.updated ?? 0,
        });
      }
    }
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  console.log(`Total group DMs: ${allDms.length}\n`);

  // Slack mpim names look like: "mpdm-raychiu--timchen--shanwang--larrylu-1"
  const targetGroups = [
    { label: "Ray+Larry+Shan+Tim", usernames: ["raychiu", "larrylu", "shanwang", "timchen"] },
    { label: "Ray+Melissa+Tiffany+Irene", usernames: ["raychiu", "melissaluo", "tiffanypan", "irenehsu"] },
  ];

  for (const target of targetGroups) {
    const matches = allDms.filter((dm) => {
      const nameLower = dm.name.toLowerCase();
      return target.usernames.every((u) => nameLower.includes(u));
    });

    if (matches.length > 0) {
      for (const m of matches) {
        const daysAgo = Math.floor((Date.now() / 1000 - m.updated) / 86400);
        console.log(`✅ FOUND ${target.label}`);
        console.log(`   ID: ${m.id}`);
        console.log(`   Name: ${m.name}`);
        console.log(`   Last active: ${daysAgo} days ago\n`);
      }
    } else {
      console.log(`❌ NOT FOUND: ${target.label}`);
      // Show close matches
      const partial = allDms.filter((dm) => {
        const nameLower = dm.name.toLowerCase();
        const matchCount = target.usernames.filter((u) => nameLower.includes(u)).length;
        return matchCount >= 2;
      });
      if (partial.length > 0) {
        console.log(`   Closest matches:`);
        for (const p of partial.slice(0, 5)) {
          const daysAgo = Math.floor((Date.now() / 1000 - p.updated) / 86400);
          console.log(`   - ${p.name} (${daysAgo} days ago)`);
        }
      }
      console.log();
    }
  }
}

main().catch(console.error);
