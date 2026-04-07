"use client";

import { useSession, signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return (email || "?")[0].toUpperCase();
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  VIEWER: "Viewer",
};

export function Header() {
  const { data: session } = useSession();
  const user = session?.user;
  const initials = getInitials(user?.name, user?.email);
  const roleLabel = ROLE_LABELS[user?.role || ""] || "";

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <h1 className="text-lg font-semibold md:hidden">Task Tracker</h1>
      <div className="ml-auto flex items-center gap-3">
        {roleLabel && (
          <Badge variant="outline" className="text-xs">{roleLabel}</Badge>
        )}
        <span className="text-sm text-muted-foreground hidden sm:inline">
          {user?.name || user?.email}
        </span>
        <Avatar className="h-8 w-8">
          {user?.image && <AvatarImage src={user.image} alt={user.name || ""} />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        {session && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => signOut({ callbackUrl: "/login" })}
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
