import { ReviewPage } from "@/components/montage/review-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ReviewPage id={(await params).id} />;
}
