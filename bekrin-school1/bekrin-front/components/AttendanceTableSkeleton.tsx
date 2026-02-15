export function AttendanceTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="animate-pulse">
        <div className="h-10 bg-slate-100 border-b border-slate-200" />
        <div className="max-h-[480px] overflow-hidden">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="h-14 flex items-center gap-4 px-4 border-b border-slate-100"
            >
              <div className="w-8 h-4 bg-slate-200 rounded" />
              <div className="flex-1 h-4 bg-slate-200 rounded" />
              <div className="w-32 h-8 bg-slate-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
