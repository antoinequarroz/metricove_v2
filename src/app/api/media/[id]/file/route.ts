import path from "node:path";
import { DATA_DIR, getMediaRow } from "@/server/db";
import { streamFile } from "@/server/stream";

/** Streams a library video, with Range support. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const row = getMediaRow((await params).id);
  return streamFile(req, row?.file ? path.join(DATA_DIR, "media", path.basename(row.file)) : undefined);
}
