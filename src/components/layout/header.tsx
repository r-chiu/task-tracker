"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export function Header() {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <h1 className="text-lg font-semibold md:hidden">Task Tracker</h1>
      <div className="ml-auto flex items-center gap-3">
        <Badge variant="outline" className="text-xs">Admin</Badge>
        <Avatar className="h-8 w-8">
          <AvatarFallback>R</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
