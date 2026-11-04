import { getJob } from "@/server/montage";

type Ctx = { params: Promise<{ id: string; mark: string }> };

/** The frame + drawing of a change request, as an image. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id, mark } = await params;
  const m = getJob(id)?.marks?.find((x) => x.id === mark);
  const match = m?.image?.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!match) return new Response("Introuvable", { status: 404 });
  return new Response(Buffer.from(match[2], "base64"), { headers: { "Content-Type": match[1], "Cache-Control": "private, max-age=3600" } });
}
