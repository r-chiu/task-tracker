"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABELS } from "@/lib/constants";
import { toast } from "sonner";
import { RefreshCw, UserPlus } from "lucide-react";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "MANAGER" | "VIEWER";
  slackId: string | null;
  slackDisplayName: string | null;
  isActive: boolean;
}

export default function SettingsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [editingSlackId, setEditingSlackId] = useState<Record<string, string>>({});
  const [editingName, setEditingName] = useState<Record<string, string>>({});
  const [editingEmail, setEditingEmail] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchUsers();
  }, []);

  const ROLE_RANK: Record<string, number> = { ADMIN: 0, MANAGER: 1, VIEWER: 2 };

  const fetchUsers = async () => {
    const res = await fetch("/api/users");
    const data = await res.json();
    const sorted = (Array.isArray(data) ? data : []).sort(
      (a: User, b: User) =>
        (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) ||
        (a.name || a.email).localeCompare(b.name || b.email)
    );
    setUsers(sorted);
    setLoading(false);
  };

  const updateRole = async (userId: string, role: string) => {
    const res = await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    if (res.ok) {
      toast.success("Role updated");
      fetchUsers();
    } else {
      toast.error("Failed to update role");
    }
  };

  const updateSlackId = async (userId: string) => {
    const slackId = editingSlackId[userId];
    if (slackId === undefined) return;
    const res = await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, slackId }),
    });
    if (res.ok) {
      toast.success("Slack ID updated");
      setEditingSlackId((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      fetchUsers();
    } else {
      toast.error("Failed to update Slack ID");
    }
  };

  const updateName = async (userId: string) => {
    const name = editingName[userId];
    if (name === undefined) return;
    const res = await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, name }),
    });
    if (res.ok) {
      toast.success("Name updated");
      setEditingName((prev) => { const next = { ...prev }; delete next[userId]; return next; });
      fetchUsers();
    } else {
      toast.error("Failed to update name");
    }
  };

  const updateEmail = async (userId: string) => {
    const email = editingEmail[userId];
    if (!email?.trim()) { toast.error("Email cannot be empty"); return; }
    const res = await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, email }),
    });
    if (res.ok) {
      toast.success("Email updated");
      setEditingEmail((prev) => { const next = { ...prev }; delete next[userId]; return next; });
      fetchUsers();
    } else {
      toast.error("Failed to update email");
    }
  };

  const syncMembers = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/slack/members", { method: "POST" });
      const data = await res.json();
      toast.success(`Synced ${data.synced} Slack members`);
      fetchUsers();
    } catch {
      toast.error("Failed to sync Slack members");
    } finally {
      setSyncing(false);
    }
  };

  /** Bulk-provision system User accounts for all active Slack members */
  const provisionAllSlackMembers = async () => {
    setProvisioning(true);
    try {
      const res = await fetch("/api/users/provision-slack", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Added ${data.created} new user(s), ${data.linked} linked, ${data.skipped} already existed`);
        fetchUsers();
      } else {
        toast.error(data.error || "Failed to provision users");
      }
    } catch {
      toast.error("Failed to provision Slack members as users");
    } finally {
      setProvisioning(false);
    }
  };

  /** Display text for Slack Account column */
  const slackDisplay = (user: User): string => {
    if (user.slackDisplayName) return user.slackDisplayName;
    if (user.slackId) {
      // Fallback: show name if available, otherwise the Slack ID
      return user.name || user.slackId;
    }
    return "Not linked";
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={provisionAllSlackMembers} disabled={provisioning}>
            <UserPlus className={`mr-2 h-4 w-4`} />
            {provisioning ? "Adding..." : "Add All Slack Members"}
          </Button>
          <Button variant="outline" onClick={syncMembers} disabled={syncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync Slack Members"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">User Management</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Slack Account</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    {editingName[user.id] !== undefined ? (
                      <div className="flex gap-1">
                        <Input
                          className="h-8 w-32 text-sm"
                          value={editingName[user.id]}
                          onChange={(e) => setEditingName((prev) => ({ ...prev, [user.id]: e.target.value }))}
                          placeholder="Name"
                          onKeyDown={(e) => e.key === "Enter" && updateName(user.id)}
                        />
                        <Button size="sm" variant="outline" className="h-8" onClick={() => updateName(user.id)}>Save</Button>
                      </div>
                    ) : (
                      <span className="font-medium cursor-pointer hover:underline" onClick={() => setEditingName((prev) => ({ ...prev, [user.id]: user.name || "" }))}>
                        {user.name || "Click to set"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingEmail[user.id] !== undefined ? (
                      <div className="flex gap-1">
                        <Input
                          className="h-8 w-48 text-sm"
                          value={editingEmail[user.id]}
                          onChange={(e) => setEditingEmail((prev) => ({ ...prev, [user.id]: e.target.value }))}
                          placeholder="email@example.com"
                          onKeyDown={(e) => e.key === "Enter" && updateEmail(user.id)}
                        />
                        <Button size="sm" variant="outline" className="h-8" onClick={() => updateEmail(user.id)}>Save</Button>
                      </div>
                    ) : (
                      <span className="text-sm cursor-pointer hover:underline" onClick={() => setEditingEmail((prev) => ({ ...prev, [user.id]: user.email }))}>
                        {user.email}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={user.role}
                      onValueChange={(v) => v && updateRole(user.id, v)}
                    >
                      <SelectTrigger className="w-[120px] h-8 text-sm">
                        <SelectValue>
                          {ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] || user.role}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ROLE_LABELS).map(([key, label]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {editingSlackId[user.id] !== undefined ? (
                      <div className="flex gap-1">
                        <Input
                          className="h-8 w-32 text-sm"
                          value={editingSlackId[user.id]}
                          onChange={(e) =>
                            setEditingSlackId((prev) => ({
                              ...prev,
                              [user.id]: e.target.value,
                            }))
                          }
                          placeholder="U012ABC..."
                        />
                        <Button size="sm" variant="outline" className="h-8" onClick={() => updateSlackId(user.id)}>
                          Save
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {user.slackId ? (
                          <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                            {slackDisplay(user)}
                          </Badge>
                        ) : (
                          <span
                            className="text-sm text-muted-foreground cursor-pointer hover:underline"
                            onClick={() =>
                              setEditingSlackId((prev) => ({
                                ...prev,
                                [user.id]: user.slackId || "",
                              }))
                            }
                          >
                            Not linked
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs ${user.isActive ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"}`}
                    >
                      {user.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
