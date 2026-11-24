import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardLoading() {
    return (
        <div className="space-y-6">
            {/* Header Skeleton */}
            <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-96 max-w-full" />
            </div>

            {/* Stats Grid Skeleton */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-6 rounded-xl border border-white/5 bg-zinc-900/50 space-y-4">
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-8 w-8 rounded-lg" />
                        </div>
                        <div className="space-y-2">
                            <Skeleton className="h-8 w-16" />
                            <Skeleton className="h-3 w-32" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Recent Activity Skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Chart Skeleton */}
                <div className="p-6 rounded-xl border border-white/5 bg-zinc-900/50 h-[350px] space-y-4">
                    <div className="flex items-center justify-between">
                        <Skeleton className="h-6 w-32" />
                        <Skeleton className="h-8 w-24" />
                    </div>
                    <div className="flex items-end gap-2 h-[250px] pt-8">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <Skeleton key={i} className="flex-1 h-full opacity-20" style={{ height: `${Math.random() * 100}%` }} />
                        ))}
                    </div>
                </div>

                {/* Recent Campaigns Skeleton */}
                <div className="p-6 rounded-xl border border-white/5 bg-zinc-900/50 h-[350px] space-y-4">
                    <Skeleton className="h-6 w-40" />
                    <div className="space-y-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-white/5">
                                <div className="flex items-center gap-3">
                                    <Skeleton className="h-10 w-10 rounded-full" />
                                    <div className="space-y-1">
                                        <Skeleton className="h-4 w-32" />
                                        <Skeleton className="h-3 w-20" />
                                    </div>
                                </div>
                                <Skeleton className="h-6 w-20 rounded-full" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
