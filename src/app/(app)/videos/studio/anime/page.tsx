import { ReelStudio } from "@/components/montage/reel-studio";
import { VisualsPage } from "@/components/montage/visuals-page";

/**
 * Reel animé: one continuous video asked in a sentence. `?editeur=scenes` keeps the old scene-by-scene editor
 * (for an old Mac, or for someone who wants it); `?reel=<id>` opens the Studio on that job (read by the Studio from the
 * router, so that Back finds the video followed last, not the one the page was first rendered with).
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  if (one(params.editeur) === "scenes") return <VisualsPage mode="motion" />;
  return <ReelStudio />;
}
