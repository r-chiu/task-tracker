import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  // Skip auth check for API routes and static assets
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    if (!token) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", req.url);
      return NextResponse.redirect(loginUrl);
    }
  } catch (e) {
    // If auth check fails, let the request through rather than crashing
    console.error("Middleware auth error:", e);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/analytics",
    "/activity",
    "/settings",
    "/tasks/:path*",
  ],
};
