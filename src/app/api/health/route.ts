import { NextResponse } from "next/server";

export async function GET() {
  const checks: Record<string, unknown> = {
    env: {
      TURSO_DATABASE_URL: !!process.env.TURSO_DATABASE_URL,
      TURSO_AUTH_TOKEN: !!process.env.TURSO_AUTH_TOKEN,
      SLACK_BOT_TOKEN: !!process.env.SLACK_BOT_TOKEN,
      NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
    },
  };

  try {
    const { prisma } = await import("@/lib/prisma");
    const count = await prisma.user.count();
    checks.database = { connected: true, userCount: count };
  } catch (e: unknown) {
    checks.database = {
      connected: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const ok = checks.database && (checks.database as { connected: boolean }).connected;
  return NextResponse.json(checks, { status: ok ? 200 : 500 });
}
