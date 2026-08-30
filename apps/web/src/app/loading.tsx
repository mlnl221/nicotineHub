import { PageLoader } from "@/components/PageLoader";

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-surface-dim dark:bg-inverse-surface">
      <PageLoader label="Loading page…" />
    </div>
  );
}
