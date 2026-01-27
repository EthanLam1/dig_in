import { Suspense } from "react";
import CallsClient from "./CallsClient";

function CallsSkeleton() {
  return (
    <div className="flex h-screen bg-background">
      {/* Left Panel Skeleton */}
      <div className="flex w-80 flex-col border-r">
        <div className="flex items-center justify-between border-b p-4">
          <div className="h-6 w-24 animate-pulse rounded bg-muted" />
          <div className="h-8 w-20 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex-1 p-4 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>

      {/* Right Panel Skeleton */}
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Loading calls...
      </div>
    </div>
  );
}

export default function CallsPage() {
  return (
    <Suspense fallback={<CallsSkeleton />}>
      <CallsClient />
    </Suspense>
  );
}
