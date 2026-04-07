export type TaskStatus = "NOT_STARTED" | "IN_PROGRESS" | "WAITING_ON_OTHERS" | "COMPLETED" | "CANCELLED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type SourceType = "MANUAL" | "SLACK_MESSAGE" | "MEETING_NOTES" | "TRANSCRIPT" | "VIDEO_RECORDING" | "OTHER";
export type Role = "ADMIN" | "MANAGER" | "VIEWER";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_STARTED: "Active",
  IN_PROGRESS: "In Progress",
  WAITING_ON_OTHERS: "Waiting on Others",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  NOT_STARTED: "bg-teal-100 text-teal-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  WAITING_ON_OTHERS: "bg-yellow-100 text-yellow-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-gray-100 text-gray-500 line-through",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  LOW: "bg-slate-100 text-slate-600",
  MEDIUM: "bg-blue-100 text-blue-600",
  HIGH: "bg-orange-100 text-orange-600",
  URGENT: "bg-red-100 text-red-700",
};

export const SOURCE_LABELS: Record<SourceType, string> = {
  MANUAL: "Manual Entry",
  SLACK_MESSAGE: "Slack Message",
  MEETING_NOTES: "Meeting Notes",
  TRANSCRIPT: "Transcript",
  VIDEO_RECORDING: "Video Recording",
  OTHER: "Other",
};

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  VIEWER: "Viewer",
};

export const ACTIVE_STATUSES: TaskStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING_ON_OTHERS",
];

export const TAIPEI_TIMEZONE = "Asia/Taipei";
