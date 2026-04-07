/**
 * Slack Block Kit templates for the /task slash command integration.
 */

import { PRIORITY_LABELS } from "@/lib/constants";

/**
 * Build the modal view for task creation (opened when user types /task with no text).
 */
export function buildTaskModal(privateMetadata?: string) {
  return {
    type: "modal" as const,
    callback_id: "task_create_modal",
    title: { type: "plain_text" as const, text: "Create Task" },
    submit: { type: "plain_text" as const, text: "Create" },
    close: { type: "plain_text" as const, text: "Cancel" },
    private_metadata: privateMetadata || "",
    blocks: [
      {
        type: "input",
        block_id: "description_block",
        label: { type: "plain_text", text: "Task Description" },
        element: {
          type: "plain_text_input",
          action_id: "description_input",
          placeholder: { type: "plain_text", text: "e.g. Review the Q2 sales report and prepare summary" },
          multiline: true,
        },
      },
      {
        type: "input",
        block_id: "owner_block",
        label: { type: "plain_text", text: "Owner" },
        element: {
          type: "users_select",
          action_id: "owner_select",
          placeholder: { type: "plain_text", text: "Select task owner" },
        },
      },
      {
        type: "input",
        block_id: "deadline_block",
        label: { type: "plain_text", text: "Deadline" },
        element: {
          type: "datepicker",
          action_id: "deadline_picker",
          placeholder: { type: "plain_text", text: "Select a date" },
        },
      },
      {
        type: "input",
        block_id: "priority_block",
        label: { type: "plain_text", text: "Priority" },
        element: {
          type: "static_select",
          action_id: "priority_select",
          initial_option: {
            text: { type: "plain_text", text: "Medium" },
            value: "MEDIUM",
          },
          options: Object.entries(PRIORITY_LABELS).map(([value, text]) => ({
            text: { type: "plain_text" as const, text: text as string },
            value,
          })),
        },
      },
    ],
  };
}

/**
 * Build confirmation blocks shown after a task is successfully created.
 */
export function buildTaskConfirmationBlocks(task: {
  title: string;
  ownerName: string;
  deadline: string;
  priority: string;
  id: string;
  creatorName?: string;
  appUrl?: string;
}) {
  const taskUrl = task.appUrl
    ? `${task.appUrl}/tasks/${task.id}`
    : null;

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Task Created", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Task:*\n${task.title}` },
        { type: "mrkdwn", text: `*Owner:*\n${task.ownerName}` },
        { type: "mrkdwn", text: `*Deadline:*\n${task.deadline}` },
        { type: "mrkdwn", text: `*Priority:*\n${task.priority}` },
      ],
    },
  ];

  if (task.creatorName) {
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Created by ${task.creatorName}` },
      ],
    });
  }

  if (taskUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in Task Tracker" },
          url: taskUrl,
          action_id: "view_task",
        },
      ],
    });
  }

  return blocks;
}

/**
 * Build a simple error message block.
 */
export function buildErrorBlocks(message: string) {
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `:warning: ${message}` },
    },
  ];
}
