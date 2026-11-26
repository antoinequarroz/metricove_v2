import fs from "node:fs";
import { NextResponse } from "next/server";
import type { SourceType } from "@/lib/strategy";
import { SOURCE_MIME, sourceFile } from "@/server/sources";

type Ctx = { params: Promise<{ projectId: string; sourceId: string }> };

/** A document waiting to be read: the Mac downloads it for Claude. Always as an attachment, never shown as a page. */
export async function GET(_req: Request, { params }: Ctx) {
  const { projectId, sourceId } = await params;
  const file = sourceFile(projectId, sourceId);
  if (!file) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  const type = sourceId.split(".").pop() as SourceType;
  return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
    headers: { "Content-Type": SOURCE_MIME[type], "Content-Disposition": "attachment", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
}
