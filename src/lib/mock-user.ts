// Temporary mock user while auth is disabled.
// When re-enabling auth, replace getCurrentUser() calls with getServerSession(authOptions).
export const MOCK_USER = {
  id: "mock-admin-user",
  email: "ray@calyx.com",
  name: "Ray",
  role: "ADMIN" as const,
  slackId: null as string | null,
};

export function getCurrentUser() {
  return MOCK_USER;
}
