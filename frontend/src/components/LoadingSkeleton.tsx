export function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="space-y-2">
      <div className="skeleton h-6 w-2/3" />
      <div className="skeleton h-40 w-full" />
      <div className="skeleton h-6 w-1/2" />
    </div>
  );
}
