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

export function TaskHistory({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <div className="space-y-3">
      {history.map((entry) => (
        <div key={entry.id} className={`flex gap-3 border-l-2 pl-4 py-1 ${
          entry.field === "extension_requested" ? "border-blue-400" :
          entry.field === "extension_denied" ? "border-red-400" :
          entry.field === "deadline" && entry.note?.startsWith("Extension approved") ? "border-green-400" :
          "border-muted"
        }`}>
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
                "Created this task"
              ) : entry.field === "extension_requested" ? (
                <span className="text-blue-700">
                  📝 Requested deadline extension from{" "}
                  <span className="font-medium">{entry.oldValue?.split("T")[0]}</span> to{" "}
                  <span className="font-medium">{entry.newValue}</span>
                  {entry.note && (
                    <span className="block text-muted-foreground text-xs mt-0.5">
                      {entry.note.replace(/^Extension requested:\s*/, "Reason: ")}
                    </span>
                  )}
                </span>
              ) : entry.field === "extension_denied" ? (
                <span className="text-red-600">
                  ❌ Extension request denied (requested deadline: {entry.newValue})
                  {entry.note && (
                    <span className="block text-muted-foreground text-xs mt-0.5">
                      {entry.note.replace(/^Extension denied\.\s*Requested reason:\s*/, "Reason given: ")}
                    </span>
                  )}
                </span>
              ) : entry.field === "deadline" && entry.note?.startsWith("Extension approved") ? (
                <span className="text-green-700">
                  ✅ Extension approved: deadline changed from{" "}
                  <span className="font-medium">{entry.oldValue?.split("T")[0]}</span> to{" "}
                  <span className="font-medium">{entry.newValue?.split("T")[0]}</span>
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
                  Changed <span className="font-medium">{entry.field}</span>
                  {entry.oldValue && (
                    <>
                      {" "}from <span className="text-muted-foreground">{entry.oldValue}</span>
                    </>
                  )}
                  {entry.newValue && (
                    <>
                      {" "}to <span className="font-medium">{entry.newValue}</span>
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
