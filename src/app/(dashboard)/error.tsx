"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <pre className="text-sm text-red-600 bg-red-50 p-4 rounded max-w-xl overflow-auto">
        {error.message}
      </pre>
      <button
        onClick={reset}
        className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90"
      >
        Try again
      </button>
    </div>
  );
}
