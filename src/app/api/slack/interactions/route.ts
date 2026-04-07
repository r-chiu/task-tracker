import { NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack-verify";
import { resolveSlackUser } from "@/lib/slack-user-resolver";
import { sendSlackMessage, sendSlackDM } from "@/lib/slack";
import { buildTaskConfirmationBlocks } from "@/lib/slack-blocks";
import { generateTitle } from "@/lib/slack-parser";
import { prisma } from "@/lib/prisma";
import { PRIORITY_LABELS } from "@/lib/constants";

/**
 * POST /api/slack/interactions
 *
 * Receives interactive payloads from Slack:
 *   - view_submission: when the task creation modal is submitted
 *   - block_actions: when buttons in messages are clicked (e.g., "View in Task Tracker")
 */
export async function POST(req: Request) {
  // Verify Slack signature
  const verification = await verifySlackRequest(req);
  if (!verification.ok) return verification.response;

  // Parse payload (Slack sends it as URL-encoded with a single "payload" JSON field)
  const params = new URLSearchParams(verification.rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const type = payload.type as string;

  // ── Modal submission ──
  if (type === "view_submission") {
    const view = payload.view as Record<string, unknown>;
    const callbackId = view.callback_id as string;

    if (callbackId !== "task_create_modal") {
      return new Response("", { status: 200 });
    }

    try {
      // Extract form values
      const values = (view.state as Record<string, unknown>)?.values as Record<
        string,
        Record<string, Record<string, unknown>>
      >;

      const description =
        (values?.description_block?.description_input?.value as string) || "";
      const ownerSlackId =
        (values?.owner_block?.owner_select?.selected_user as string) || "";
      const deadlineStr =
        (values?.deadline_block?.deadline_picker?.selected_date as string) || "";
      const priorityOption = values?.priority_block?.priority_select?.selected_option as
        | { value: string }
        | undefined;
      const priority = priorityOption?.value || "MEDIUM";

      // Validate required fields
      const errors: Record<string, string> = {};
      if (!description.trim()) {
        errors.description_block = "Please enter a task description";
      }
      if (!ownerSlackId) {
        errors.owner_block = "Please select an owner";
      }
      if (!deadlineStr) {
        errors.deadline_block = "Please select a deadline";
      }

      if (Object.keys(errors).length > 0) {
        return NextResponse.json({
          response_action: "errors",
          errors,
        });
      }

      // Resolve users
      const submitterSlackId = (payload.user as Record<string, string>)?.id || "";
      const [owner, creator] = await Promise.all([
        resolveSlackUser(ownerSlackId),
        resolveSlackUser(submitterSlackId),
      ]);

      // Generate smart title
      const title = generateTitle(description);

      // Create the task
      const deadlineDate = new Date(deadlineStr + "T23:59:59.000Z");
      const task = await prisma.task.create({
        data: {
          title,
          description,
          ownerId: owner.userId,
          creatorId: creator.userId,
          deadline: deadlineDate,
          originalDeadline: deadlineDate,
          priority,
          status: "NOT_STARTED",
          sourceType: "SLACK_MESSAGE",
        },
      });

      // Record task creation in history
      await prisma.taskHistory.create({
        data: {
          taskId: task.id,
          userId: creator.userId,
          field: "created",
          newValue: "Task created via Slack modal",
        },
      });

      // Build confirmation message (sent asynchronously after returning response)
      const priorityLabel =
        PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS] || priority;
      const appUrl = process.env.NEXTAUTH_URL || "";
      const blocks = buildTaskConfirmationBlocks({
        title,
        ownerName: owner.userName,
        deadline: deadlineStr,
        priority: priorityLabel,
        id: task.id,
        creatorName: creator.userName,
        appUrl,
      });

      const confirmText = `✅ Task created: ${title} | Owner: ${owner.userName} | Due: ${deadlineStr}`;

      // Parse channel from private_metadata
      let metadata: { channelId?: string } = {};
      try {
        metadata = JSON.parse((view.private_metadata as string) || "{}");
      } catch {}

      // Fire-and-forget: send notifications asynchronously so we return
      // the modal response within Slack's 3-second window
      const notifyAsync = async () => {
        try {
          if (metadata.channelId) {
            await sendSlackMessage(metadata.channelId, confirmText, blocks).catch(() => {});
          }
          await sendSlackDM(submitterSlackId, confirmText, blocks).catch(() => {});
          if (owner.userId !== creator.userId) {
            await sendSlackDM(
              ownerSlackId,
              `📋 New task assigned to you: *${title}*\nDeadline: ${deadlineStr} | Priority: ${priorityLabel}`,
              blocks
            ).catch(() => {});
          }
        } catch (e) {
          console.error("Async notification error:", e);
        }
      };
      notifyAsync(); // Don't await — let it run in background

      // Close the modal immediately
      return NextResponse.json({ response_action: "clear" });
    } catch (err) {
      console.error("Modal submission error:", err);
      return NextResponse.json({
        response_action: "errors",
        errors: {
          description_block:
            "Failed to create task: " +
            (err instanceof Error ? err.message : "Unknown error"),
        },
      });
    }
  }

  // ── Button actions (e.g., "View in Task Tracker") ──
  if (type === "block_actions") {
    // Just acknowledge — the button has a URL that opens in the browser
    return new Response("", { status: 200 });
  }

  // Unknown interaction type
  return new Response("", { status: 200 });
}
