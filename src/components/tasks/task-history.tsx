"use client";

import { format } from "date-fns";

interface HistoryEntry {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
}

/** Format a value as a date if it looks like an ISO timestamp, otherwise return as-is */
function formatValue(value: string | null | undefined): string {
  if (!value) return "";
  // Match ISO dates: 2026-04-08, 2026-04-08T00:00:00.000Z, etc.
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    try {
      return format(new Date(value), "MMM d, yyyy");
    } catch {
      return value.split("T")[0];
    }
  }
  return value;
}

/** Human-readable field labels */
const FIELD_LABELS: Record<string, string> = {
  deadline: "deadline",
  priority: "priority",
  status: "status",
  title: "title",
  description: "description",
  ownerId: "owner",
  slackChannel: "Slack channel",
  notes: "notes",
};

export function TaskHistory({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <div className="space-y-3">
      {history.map((entry) => {
        // Determine border color based on event type
        const borderClass =
          entry.field === "extension_requested" ? "border-blue-400" :
          entry.field === "extension_denied" ? "border-red-400" :
          entry.field === "deadline" && entry.note?.startsWith("Extension approved") ? "border-green-400" :
          entry.field === "created" ? "border-emerald-400" :
          (entry.field === "status" && entry.newValue === "DELETED") ? "border-red-400" :
          "border-muted";

        return (
          <div key={entry.id} className={`flex gap-3 border-l-2 pl-4 py-1 ${borderClass}`}>
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">
                  {entry.user.name || entry.user.email}
                </span>
                <span className="text-muted-foreground">
                  {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")}
                </span>
              </div>
              <p className="text-sm mt-0.5">
                {entry.field === "created" ? (
                  <span className="text-emerald-700">
                    ✨ Created this task
                    {entry.newValue && entry.newValue !== "Task created via Slack modal" && entry.newValue !== "Task created via /task command in Slack" && (
                      <span className="block text-muted-foreground text-xs mt-0.5">{entry.newValue}</span>
                    )}
                  </span>
                ) : entry.field === "extension_requested" ? (
                  <span className="text-blue-700">
                    📝 Requested deadline extension from{" "}
                    <span className="font-medium">{formatValue(entry.oldValue)}</span> to{" "}
                    <span className="font-medium">{formatValue(entry.newValue)}</span>
                    {entry.note && (
                      <span className="block text-muted-foreground text-xs mt-0.5">
                        {entry.note.replace(/^Extension requested:\s*/, "Reason: ")}
                      </span>
                    )}
                  </span>
                ) : entry.field === "extension_denied" ? (
                  <span className="text-red-600">
                    ❌ Extension request denied (requested deadline: {formatValue(entry.newValue)})
                    {entry.note && (
                      <span className="block text-muted-foreground text-xs mt-0.5">
                        {entry.note.replace(/^Extension denied\.\s*Requested reason:\s*/, "Reason given: ")}
                      </span>
                    )}
                  </span>
                ) : entry.field === "deadline" && entry.note?.startsWith("Extension approved") ? (
                  <span className="text-green-700">
                    ✅ Extension approved: deadline changed from{" "}
                    <span className="font-medium">{formatValue(entry.oldValue)}</span> to{" "}
                    <span className="font-medium">{formatValue(entry.newValue)}</span>
                    {entry.note && (
                      <span className="block text-muted-foreground text-xs mt-0.5">
                        {entry.note.replace(/^Extension approved:\s*/, "Reason: ")}
                      </span>
                    )}
                  </span>
                ) : entry.note ? (
                  entry.note
                ) : (
                  <>
                    Changed <span className="font-medium">{FIELD_LABELS[entry.field] || entry.field}</span>
                    {entry.oldValue && (
                      <>
                        {" "}from <span className="text-muted-foreground">{formatValue(entry.oldValue)}</span>
                      </>
                    )}
                    {entry.newValue && (
                      <>
                        {" "}to <span className="font-medium">{formatValue(entry.newValue)}</span>
                      </>
                    )}
                  </>
                )}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
