"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface Extension {
  id: string;
  originalDeadline: string;
  revisedDeadline: string;
  reason: string | null;
  createdAt: string;
  extendedBy: { name: string | null; email: string };
}

export function DeadlineExtensionDialog({
  taskId,
  currentDeadline,
  extensions,
  onExtended,
}: {
  taskId: string;
  currentDeadline: string;
  extensions: Extension[];
  onExtended: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newDeadline, setNewDeadline] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!newDeadline) {
      toast.error("Please select a new deadline");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisedDeadline: newDeadline, reason }),
      });
      if (!res.ok) throw new Error();
      toast.success("Deadline extended successfully");
      setOpen(false);
      setNewDeadline("");
      setReason("");
      onExtended();
    } catch {
      toast.error("Failed to extend deadline");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground h-8 cursor-pointer"
      >
        <CalendarClock className="h-4 w-4" />
        Extend Deadline
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Extend Deadline</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Current deadline: <span className="font-medium">{format(new Date(currentDeadline), "yyyy-MM-dd")}</span>
            </p>
          </div>

          <div className="space-y-2">
            <Label>New Deadline</Label>
            <Input
              type="date"
              value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Reason for Extension</Label>
            <Textarea
              placeholder="Why is the deadline being extended?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          {extensions.length > 0 && (
            <div>
              <Label className="mb-2 block">Previous Extensions</Label>
              <div className="max-h-32 overflow-y-auto space-y-2 text-sm">
                {extensions.map((ext) => (
                  <div key={ext.id} className="rounded border p-2">
                    <p>
                      {format(new Date(ext.originalDeadline), "yyyy-MM-dd")} &rarr;{" "}
                      {format(new Date(ext.revisedDeadline), "yyyy-MM-dd")}
                    </p>
                    {ext.reason && (
                      <p className="text-muted-foreground">{ext.reason}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      by {ext.extendedBy.name || ext.extendedBy.email} on{" "}
                      {format(new Date(ext.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Extending..." : "Extend"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
