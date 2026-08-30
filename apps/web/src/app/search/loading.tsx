import { PageLoader } from "@/components/PageLoader";
export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <PageLoader />
    </div>
  );
}
