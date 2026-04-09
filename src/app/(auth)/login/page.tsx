"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Calyx Pulse</CardTitle>
          <CardDescription>
            Sign in to manage and track employee tasks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            size="lg"
            onClick={() => signIn("slack", { callbackUrl: "/" })}
          >
            Sign in with Slack
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
