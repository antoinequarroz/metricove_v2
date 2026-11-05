import { Suspense } from "react";
import { MontagePage } from "@/components/montage/montage-page";

export default function Page() {
  return (
    <Suspense>
      <MontagePage />
    </Suspense>
  );
}
