import { Skeleton } from "@/components/ui/skeleton";

/** Shown while dashboard routes load RSC payload — improves perceived navigation speed. */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 shrink-0 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48 max-w-full" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-px flex-1" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[280px] w-full rounded-xl" />
    </div>
  );
}
