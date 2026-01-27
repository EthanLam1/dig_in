import { Suspense } from "react";
import HomeClient from "./HomeClient";

function HomeSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-emerald-50/30">
      {/* Header Skeleton */}
      <header className="pt-12 pb-8">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="flex items-start justify-between">
            <div className="w-[130px] hidden sm:block" />
            <div className="flex-1 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <div className="size-8 animate-pulse rounded bg-muted" />
                <div className="h-10 w-32 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-6 w-48 mx-auto animate-pulse rounded bg-muted" />
            </div>
            <div className="h-10 w-32 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </header>

      {/* Content Skeleton */}
      <main className="container mx-auto max-w-6xl px-4 pb-28">
        <div className="flex justify-center text-muted-foreground">
          Loading...
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeClient />
    </Suspense>
  );
}
