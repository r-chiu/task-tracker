import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

/**
 * Verify that a request genuinely came from Slack using HMAC-SHA256
 * signature verification with the signing secret.
 *
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  timestamp: string,
  rawBody: string,
  signature: string
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET not set");
    return false;
  }

  // Reject requests older than 5 minutes (replay protection)
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    console.warn("Slack request timestamp too old:", timestamp);
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const mySignature =
    "v0=" + createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(mySignature, "utf8"),
      Buffer.from(signature, "utf8")
    );
  } catch {
    return false;
  }
}

/**
 * Convenience wrapper: reads headers + body from the request,
 * verifies the signature, and returns the raw body for downstream parsing.
 *
 * Returns `rawBody` so the caller can parse it (body stream can only be read once).
 */
export async function verifySlackRequest(
  req: Request
): Promise<{ ok: true; rawBody: string } | { ok: false; response: NextResponse }> {
  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const signature = req.headers.get("x-slack-signature") || "";

  if (!timestamp || !signature) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Missing Slack headers" }, { status: 401 }),
    };
  }

  const rawBody = await req.text();

  if (!verifySlackSignature(timestamp, rawBody, signature)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid signature" }, { status: 401 }),
    };
  }

  return { ok: true, rawBody };
}
