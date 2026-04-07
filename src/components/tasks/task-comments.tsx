"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { toast } from "sonner";

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; name: string | null; email: string; image?: string | null };
}

export function TaskComments({
  taskId,
  comments: initialComments,
  canPost,
}: {
  taskId: string;
  comments: Comment[];
  canPost: boolean;
}) {
  const [comments, setComments] = useState(initialComments);
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);

  const handlePost = async () => {
    if (!content.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      });
      if (!res.ok) throw new Error();
      const comment = await res.json();
      setComments((prev) => [comment, ...prev]);
      setContent("");
      toast.success("Comment added");
    } catch {
      toast.error("Failed to add comment");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-4">
      {canPost && (
        <div className="space-y-2">
          <Textarea
            placeholder="Add a comment..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
          />
          <Button size="sm" onClick={handlePost} disabled={posting || !content.trim()}>
            {posting ? "Posting..." : "Post Comment"}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {comments.length === 0 && (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3 rounded-md border p-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={c.user.image || ""} />
              <AvatarFallback>
                {(c.user.name || c.user.email).charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{c.user.name || c.user.email}</span>
                <span className="text-muted-foreground">
                  {format(new Date(c.createdAt), "MMM d, yyyy h:mm a")}
                </span>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{c.content}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
