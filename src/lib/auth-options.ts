import type { NextAuthOptions } from "next-auth";
import SlackProvider from "next-auth/providers/slack";
import { prisma } from "./prisma";

// Editors: only these Slack user IDs can create/edit/delete tasks
const EDITOR_SLACK_IDS = new Set([
  process.env.RAY_SLACK_USER_ID,       // Ray
  process.env.TIFFANY_SLACK_USER_ID,   // Tiffany
]);

export const authOptions: NextAuthOptions = {
  // No adapter — we use JWT sessions and handle user lookup ourselves
  providers: [
    SlackProvider({
      clientId: process.env.SLACK_CLIENT_ID!,
      clientSecret: process.env.SLACK_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ account, profile, user }) {
      console.log("[AUTH] signIn callback:", { provider: account?.provider, email: user?.email, name: user?.name });
      if (account?.provider === "slack") {
        return true;
      }
      return false;
    },
    async jwt({ token, user, account }) {
      if (user) {
        // Look up existing user by email
        let dbUser = await prisma.user.findUnique({
          where: { email: user.email! },
        });

        if (!dbUser) {
          // Try to match by name from SlackMember table
          dbUser = await prisma.user.findFirst({
            where: { email: user.email! },
          });
        }

        if (dbUser) {
          token.id = dbUser.id;
          token.name = dbUser.name || token.name;
          token.role = dbUser.role;
          token.slackId = dbUser.slackId;

          // Determine role based on editor allow-list
          const isEditor = EDITOR_SLACK_IDS.has(dbUser.slackId || "");
          const isAdmin = dbUser.email === process.env.ADMIN_EMAIL;
          const targetRole = isAdmin ? "ADMIN" : isEditor ? "MANAGER" : "VIEWER";

          if (dbUser.role !== targetRole) {
            await prisma.user.update({
              where: { id: dbUser.id },
              data: { role: targetRole },
            });
            token.role = targetRole;
          }
        } else {
          // New user — create as VIEWER
          const newUser = await prisma.user.create({
            data: {
              email: user.email!,
              name: user.name || null,
              image: user.image || null,
              role: "VIEWER",
            },
          });
          token.id = newUser.id;
          token.role = "VIEWER";
          token.slackId = null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.name = token.name || session.user.name;
      session.user.role = token.role;
      session.user.slackId = token.slackId;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};

/** Check if a role has edit permissions */
export function canEdit(role: string): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

