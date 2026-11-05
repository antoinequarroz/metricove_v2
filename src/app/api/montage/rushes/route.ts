import { NextResponse } from "next/server";
import { addUploadedRush, listRushes, UploadError } from "@/server/montage";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ rushes: listRushes() });
}

/** Turns a finished upload into a rush: { upload, name?, duration? }. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { upload?: string; name?: string; duration?: number };
  if (!body.upload) return NextResponse.json({ error: "Champ « upload » manquant" }, { status: 400 });
  try {
    return NextResponse.json({ rush: addUploadedRush(body.upload, body.name, body.duration) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof UploadError ? e.status : 500 });
  }
}
