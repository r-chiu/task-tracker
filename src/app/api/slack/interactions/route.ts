import { NextResponse } from "next/server";
import { verifySlackRequest } from "@/lib/slack-verify";
import { resolveSlackUser } from "@/lib/slack-user-resolver";
import { sendSlackMessage, sendSlackDM, slackClient } from "@/lib/slack";
import { buildTaskConfirmationBlocks } from "@/lib/slack-blocks";
import { generateTitle } from "@/lib/slack-parser";
import { aiGenerateTitle } from "@/lib/ai-parser";
import { prisma } from "@/lib/prisma";
import { PRIORITY_LABELS } from "@/lib/constants";
import { recordTaskChange } from "@/lib/task-utils";

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

    // ── Task Creation Modal ──
    if (callbackId === "task_create_modal") {
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

      // Generate smart title — try AI first, fall back to regex
      const title = (await aiGenerateTitle(description)) || generateTitle(description);

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
          status: "ACTIVE",
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

    // ── Extension Request Modal ──
    if (callbackId === "extension_request_modal") {
      try {
        const values = (view.state as Record<string, unknown>)?.values as Record<
          string,
          Record<string, Record<string, unknown>>
        >;

        const newDeadlineStr =
          (values?.new_deadline_block?.new_deadline_picker?.selected_date as string) || "";
        const reason =
          (values?.reason_block?.reason_input?.value as string) || "";

        // Validate
        const errors: Record<string, string> = {};
        if (!newDeadlineStr) errors.new_deadline_block = "Please select a new deadline";
        if (!reason.trim()) errors.reason_block = "Please provide a reason";
        if (Object.keys(errors).length > 0) {
          return NextResponse.json({ response_action: "errors", errors });
        }

        // Parse metadata
        let metadata: { taskId?: string; requesterSlackId?: string } = {};
        try {
          metadata = JSON.parse((view.private_metadata as string) || "{}");
        } catch {}

        const taskId = metadata.taskId;
        if (!taskId) {
          return NextResponse.json({
            response_action: "errors",
            errors: { reason_block: "Task not found. Please try again." },
          });
        }

        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: { owner: { select: { name: true, email: true, slackId: true } } },
        });
        if (!task) {
          return NextResponse.json({
            response_action: "errors",
            errors: { reason_block: "Task not found in database." },
          });
        }

        const requesterSlackId = metadata.requesterSlackId || "";
        const requester = await resolveSlackUser(requesterSlackId);
        const adminSlackId = process.env.RAY_SLACK_USER_ID;
        const appUrl = process.env.NEXTAUTH_URL || "";
        const taskLabel = task.title || task.description.slice(0, 200);

        // Send approval request DM to admin (Ray)
        if (adminSlackId) {
          const approvalBlocks = [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `📝 *Extension Request*\n\n*${taskLabel}*`,
              },
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*Requested by:*\n${requester.userName}` },
                { type: "mrkdwn", text: `*Owner:*\n${task.owner?.name || task.owner?.email || "Unknown"}` },
                { type: "mrkdwn", text: `*Current Deadline:*\n${task.deadline.toISOString().split("T")[0]}` },
                { type: "mrkdwn", text: `*Requested Deadline:*\n${newDeadlineStr}` },
              ],
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Reason:*\n>${reason.replace(/\n/g, "\n>")}`,
              },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "✅ Approve", emoji: true },
                  action_id: "approve_extension",
                  style: "primary",
                  value: JSON.stringify({
                    taskId,
                    newDeadline: newDeadlineStr,
                    reason,
                    requesterSlackId,
                  }),
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "❌ Deny", emoji: true },
                  action_id: "deny_extension",
                  style: "danger",
                  value: JSON.stringify({
                    taskId,
                    newDeadline: newDeadlineStr,
                    reason,
                    requesterSlackId,
                  }),
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "📋 View Task", emoji: true },
                  url: `${appUrl}/tasks/${taskId}`,
                },
              ],
            },
            {
              type: "context",
              elements: [
                { type: "mrkdwn", text: "Sent by Calyx Task Tracker" },
              ],
            },
          ];

          sendSlackDM(
            adminSlackId,
            `📝 Extension request for: ${taskLabel} — requested by ${requester.userName}`,
            approvalBlocks
          ).catch((e) => console.error("Failed to send approval DM:", e));
        }

        // Record extension request in history
        await recordTaskChange(
          taskId,
          requester.userId,
          "extension_requested",
          task.deadline.toISOString(),
          newDeadlineStr,
          `Extension requested: ${reason}`
        );

        // Confirm to requester
        sendSlackDM(
          requesterSlackId,
          `✅ Your extension request for *${taskLabel}* has been submitted for approval.\n\n*New Deadline:* ${newDeadlineStr}\n*Reason:* ${reason}`,
        ).catch((e) => console.error("Failed to send requester confirmation:", e));

        return NextResponse.json({ response_action: "clear" });
      } catch (err) {
        console.error("Extension modal submission error:", err);
        return NextResponse.json({
          response_action: "errors",
          errors: { reason_block: "Failed to submit extension request. Please try again." },
        });
      }
    }

    // Unknown modal — just acknowledge
    return new Response("", { status: 200 });
  }

  // ── Button actions ──
  if (type === "block_actions") {
    const actions = payload.actions as Array<Record<string, unknown>>;
    const action = actions?.[0];
    const actionId = action?.action_id as string;
    const triggerId = payload.trigger_id as string;

    // ── Request Extension: open modal ──
    if (actionId === "request_extension") {
      const taskId = action.value as string;
      const requesterSlackId = (payload.user as Record<string, string>)?.id || "";

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, title: true, description: true, deadline: true },
      });

      if (!task) {
        return new Response("", { status: 200 });
      }

      const taskLabel = task.title || task.description.slice(0, 200);
      const currentDeadline = task.deadline.toISOString().split("T")[0];

      // Open the extension request modal
      try {
        await slackClient.views.open({
          trigger_id: triggerId,
          view: {
            type: "modal",
            callback_id: "extension_request_modal",
            private_metadata: JSON.stringify({ taskId, requesterSlackId }),
            title: { type: "plain_text", text: "Request Extension" },
            submit: { type: "plain_text", text: "Submit Request" },
            close: { type: "plain_text", text: "Cancel" },
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*Task:* ${taskLabel}\n*Current Deadline:* ${currentDeadline}`,
                },
              },
              { type: "divider" },
              {
                type: "input",
                block_id: "new_deadline_block",
                label: { type: "plain_text", text: "New Deadline" },
                element: {
                  type: "datepicker",
                  action_id: "new_deadline_picker",
                  placeholder: { type: "plain_text", text: "Select a date" },
                },
              },
              {
                type: "input",
                block_id: "reason_block",
                label: { type: "plain_text", text: "Reason for Extension" },
                element: {
                  type: "plain_text_input",
                  action_id: "reason_input",
                  multiline: true,
                  placeholder: {
                    type: "plain_text",
                    text: "Why do you need more time?",
                  },
                },
              },
            ],
          },
        });
      } catch (e) {
        console.error("Failed to open extension modal:", e);
      }

      return new Response("", { status: 200 });
    }

    // ── Approve Extension ──
    if (actionId === "approve_extension") {
      try {
        const data = JSON.parse(action.value as string);
        const { taskId, newDeadline, reason, requesterSlackId } = data;

        const task = await prisma.task.findUnique({ where: { id: taskId } });
        if (!task) {
          return new Response("", { status: 200 });
        }

        const approverSlackId = (payload.user as Record<string, string>)?.id || "";
        const approver = await resolveSlackUser(approverSlackId);
        const newDeadlineDate = new Date(newDeadline + "T23:59:59.000Z");

        // Create extension record
        await prisma.deadlineExtension.create({
          data: {
            taskId,
            originalDeadline: task.deadline,
            revisedDeadline: newDeadlineDate,
            reason: reason || null,
            extendedById: approver.userId,
          },
        });

        // Update task
        await prisma.task.update({
          where: { id: taskId },
          data: {
            deadline: newDeadlineDate,
            revisedDeadline: newDeadlineDate,
            extensionReason: reason || null,
            isOverdue: false,
          },
        });

        // Record in history
        await recordTaskChange(
          taskId,
          approver.userId,
          "deadline",
          task.deadline.toISOString(),
          newDeadlineDate.toISOString(),
          `Extension approved: ${reason}`
        );

        const taskLabel = task.title || task.description.slice(0, 200);

        // Update the approval message to show it was approved
        const channel = (payload.channel as Record<string, string>)?.id;
        const messageTs = (payload.message as Record<string, string>)?.ts;
        if (channel && messageTs) {
          try {
            await slackClient.chat.update({
              channel,
              ts: messageTs,
              text: `✅ Extension approved for: ${taskLabel}`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `✅ *Extension Approved*\n\n*${taskLabel}*\n\nNew deadline: ${newDeadline}\nApproved by: ${approver.userName}`,
                  },
                },
                {
                  type: "context",
                  elements: [
                    { type: "mrkdwn", text: `Reason: ${reason}` },
                  ],
                },
              ],
            });
          } catch (e) {
            console.error("Failed to update approval message:", e);
          }
        }

        // Notify requester
        if (requesterSlackId) {
          sendSlackDM(
            requesterSlackId,
            `✅ Your extension request for *${taskLabel}* has been *approved*!\n\n*New Deadline:* ${newDeadline}\n*Approved by:* ${approver.userName}`,
          ).catch((e) => console.error("Failed to notify requester:", e));
        }
      } catch (e) {
        console.error("Approve extension error:", e);
      }

      return new Response("", { status: 200 });
    }

    // ── Deny Extension ──
    if (actionId === "deny_extension") {
      try {
        const data = JSON.parse(action.value as string);
        const { taskId, newDeadline, reason, requesterSlackId } = data;

        const task = await prisma.task.findUnique({ where: { id: taskId } });
        if (!task) {
          return new Response("", { status: 200 });
        }

        const denierSlackId = (payload.user as Record<string, string>)?.id || "";
        const denier = await resolveSlackUser(denierSlackId);
        const taskLabel = task.title || task.description.slice(0, 200);

        // Record denial in history
        await recordTaskChange(
          taskId,
          denier.userId,
          "extension_denied",
          "",
          newDeadline,
          `Extension denied. Requested reason: ${reason}`
        );

        // Update the message to show it was denied
        const channel = (payload.channel as Record<string, string>)?.id;
        const messageTs = (payload.message as Record<string, string>)?.ts;
        if (channel && messageTs) {
          try {
            await slackClient.chat.update({
              channel,
              ts: messageTs,
              text: `❌ Extension denied for: ${taskLabel}`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `❌ *Extension Denied*\n\n*${taskLabel}*\n\nRequested deadline: ${newDeadline}\nDenied by: ${denier.userName}`,
                  },
                },
                {
                  type: "context",
                  elements: [
                    { type: "mrkdwn", text: `Reason given: ${reason}` },
                  ],
                },
              ],
            });
          } catch (e) {
            console.error("Failed to update denial message:", e);
          }
        }

        // Notify requester
        if (requesterSlackId) {
          sendSlackDM(
            requesterSlackId,
            `❌ Your extension request for *${taskLabel}* has been *denied*.\n\n*Requested Deadline:* ${newDeadline}\n*Denied by:* ${denier.userName}\n\nPlease complete the task by the original deadline.`,
          ).catch((e) => console.error("Failed to notify requester:", e));
        }
      } catch (e) {
        console.error("Deny extension error:", e);
      }

      return new Response("", { status: 200 });
    }

    // Default: just acknowledge (e.g., URL buttons)
    return new Response("", { status: 200 });
  }

  // Unknown interaction type
  return new Response("", { status: 200 });
}
