import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: "file:dev.db" });
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
