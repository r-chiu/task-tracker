import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const adapter = new PrismaLibSql(client);
const prisma = new PrismaClient({ adapter }) as any;

async function main() {
  await prisma.user.upsert({
    where: { email: "ray@calyx.com" },
    update: {},
    create: {
      id: "mock-admin-user",
      email: "ray@calyx.com",
      name: "Ray",
      role: "ADMIN",
    },
  });

  console.log("Seed complete: mock admin user created.");
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
