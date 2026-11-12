import { NextResponse } from "next/server";
import { listMedia, listProjects } from "@/server/db";
import { claimJob, listRushes, workerSeen } from "@/server/montage";
import { profileOf, themeOf, voiceOf } from "@/server/profiles";

export const dynamic = "force-dynamic";

/**
 * The Mac asks for work every few seconds. 204 = nothing to do.
 * Otherwise: the job, what to do, and its rushes (with a download URL when the file waits on the server).
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { worker?: string; version?: string; tracks?: unknown };
  // The files of the Mac's music folder (worker 0.10.0), so that the page can offer them by name.
  const tracks = Array.isArray(b.tracks) ? b.tracks.filter((t): t is string => typeof t === "string" && t.length > 0 && t.length <= 200).slice(0, 200) : undefined;
  workerSeen({ worker: b.worker?.slice(0, 40), version: b.version?.slice(0, 20), tracks });
  const claimed = claimJob();
  if (!claimed) return new Response(null, { status: 204 });
  // An edit lives for days (versions, feedback, final render): it gets the project's profile as it is now,
  // not as it was when the job was made. Not stored with the job.
  const styled = claimed.kind === "montage" || claimed.kind === "cover";
  const voice = styled ? voiceOf(claimed.projectId) : undefined;
  const theme = styled ? themeOf(claimed.projectId) : undefined;
  // An animated reel shows the logo of its project: kept out of the stored job, added here.
  const owner = claimed.kind === "motion" && claimed.motion?.logo !== false && claimed.projectId ? listProjects().find((p) => p.id === claimed.projectId) : undefined;
  const logo = owner ? profileOf(owner).look.logo : undefined;
  if (claimed.motion && logo) claimed.motion = { ...claimed.motion, look: { ...claimed.motion.look, logo } };
  const job = { ...claimed, ...(voice ? { voice: { tone: voice.tone, skill: voice.skill } } : {}), ...(theme ? { theme } : {}) };
  const rushes = listRushes()
    .filter((r) => job.rushIds.includes(r.id))
    .map((r) => ({ ...r, thumb: undefined, url: r.origin === "upload" ? `/api/montage/rushes/${r.id}/file` : undefined }));
  // A description request comes with its video, so the Mac can transcribe it.
  // A cover request too: the Mac can pick a frame or read the subtitles from it.
  const mediaId = job.caption?.mediaId ?? job.cover?.mediaId;
  const m = mediaId ? listMedia().find((x) => x.id === mediaId) : undefined;
  const media = m
    ? { id: m.id, title: m.title, duration: m.duration, aspect: m.aspect, url: `/api/media/${m.id}/file`, coverUrl: `/api/media/${m.id}/cover` }
    : undefined;
  return NextResponse.json({ job, action: job.action, rushes, media });
}
