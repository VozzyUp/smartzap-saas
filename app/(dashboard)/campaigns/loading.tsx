import { Skeleton } from "@/components/ui/skeleton"

export default function CampaignsLoading() {
    return (
        <div className="space-y-6">
            {/* Header Skeleton */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <Skeleton className="h-8 w-48 mb-2" />
                    <Skeleton className="h-4 w-96 max-w-full" />
                </div>
                <Skeleton className="h-10 w-40 rounded-xl" />
            </div>

            {/* Filters Skeleton */}
            <div className="flex flex-col sm:flex-row gap-4">
                <Skeleton className="h-10 flex-1 rounded-xl" />
                <Skeleton className="h-10 w-48 rounded-xl" />
            </div>

            {/* Table Skeleton */}
            <div className="rounded-xl border border-white/5 bg-zinc-900/50 overflow-hidden">
                {/* Table Header */}
                <div className="grid grid-cols-12 gap-4 p-4 border-b border-white/5 bg-zinc-900/50">
                    <Skeleton className="col-span-4 h-4" />
                    <Skeleton className="col-span-2 h-4" />
                    <Skeleton className="col-span-2 h-4" />
                    <Skeleton className="col-span-2 h-4" />
                    <Skeleton className="col-span-2 h-4" />
                </div>

                {/* Table Rows */}
                <div className="divide-y divide-white/5">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="grid grid-cols-12 gap-4 p-4 items-center">
                            <div className="col-span-4 flex items-center gap-3">
                                <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                                <div className="space-y-2 w-full">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-3 w-48" />
                                </div>
                            </div>
                            <div className="col-span-2">
                                <Skeleton className="h-6 w-24 rounded-full" />
                            </div>
                            <div className="col-span-2 space-y-2">
                                <Skeleton className="h-3 w-full" />
                                <Skeleton className="h-1 w-full" />
                            </div>
                            <div className="col-span-2">
                                <Skeleton className="h-4 w-20" />
                            </div>
                            <div className="col-span-2 flex justify-end gap-2">
                                <Skeleton className="h-8 w-8 rounded-lg" />
                                <Skeleton className="h-8 w-8 rounded-lg" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
