import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";

/**
 * Get the currently logged-in user from the session.
 * Falls back to a default admin user for API routes called by Slack webhooks.
 */
export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name || null,
      role: session.user.role,
      slackId: session.user.slackId || null,
    };
  }

  // Fallback for unauthenticated API calls (e.g., Slack webhooks)
  return {
    id: "system",
    email: "system@calyx.com",
    name: "System",
    role: "ADMIN" as const,
    slackId: null as string | null,
  };
}
