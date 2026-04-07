import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  console.log("Creating DismissedActionItem table...");
  await client.execute(`CREATE TABLE IF NOT EXISTS DismissedActionItem (
    id TEXT PRIMARY KEY NOT NULL,
    contentHash TEXT NOT NULL,
    description TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'dismissed',
    taskId TEXT,
    channel TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await client.execute(
    `CREATE INDEX IF NOT EXISTS DismissedActionItem_contentHash_idx ON DismissedActionItem (contentHash)`
  );

  console.log("Done! DismissedActionItem table created on Turso.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
