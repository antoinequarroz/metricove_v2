import { NextResponse } from "next/server";
import { listMedia, listProjects } from "@/server/db";
import { isVideoJob } from "@/lib/montage";
import { claimJob, cleanSpeed, listRushes, saveMacBroll, workerSeen, type MacBroll } from "@/server/montage";
import { assetsFor } from "@/server/library";
import { audioPrefs } from "@/server/audio-ai";
import { profileOf, themeOf, voiceOf } from "@/server/profiles";

export const dynamic = "force-dynamic";

/**
 * The Mac asks for work every few seconds. 204 = nothing to do.
 * Otherwise: the job, what to do, and its rushes (with a download URL when the file waits on the server).
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { worker?: unknown; version?: unknown; tracks?: unknown; brolls?: unknown; speed?: unknown };
  const version = typeof b.version === "string" ? b.version.slice(0, 20) : undefined;
  // The files of the Mac's music folder (worker 0.10.0), so that the page can offer them by name.
  const tracks = Array.isArray(b.tracks) ? b.tracks.filter((t): t is string => typeof t === "string" && t.length > 0 && t.length <= 200).slice(0, 200) : undefined;
  // The Mac only asks for work between two jobs: it is no longer busy. `speed` (worker 0.15.0): what it learned of its
  // own speed, for « prête dans environ 5 min ».
  workerSeen({ worker: typeof b.worker === "string" ? b.worker.slice(0, 40) : undefined, version, tracks, speed: cleanSpeed(b.speed) }, { idle: true });
  // The files of the Mac B-roll folder with a small picture (worker 0.13.0), sent when the folder changes.
  if (Array.isArray(b.brolls)) {
    const list: MacBroll[] = [];
    for (const x of b.brolls.slice(0, 300) as Record<string, unknown>[]) {
      if (!x || typeof x.name !== "string" || !x.name || x.name.length > 200) continue;
      const thumb = typeof x.thumb === "string" && x.thumb.startsWith("data:image/jpeg;base64,") && x.thumb.length < 16_000 ? x.thumb : undefined;
      const dur = typeof x.dur === "number" && Number.isFinite(x.dur) && x.dur > 0 ? Math.round(x.dur * 10) / 10 : undefined;
      list.push({ name: x.name, ...(thumb ? { thumb } : {}), ...(dur ? { dur } : {}) });
    }
    saveMacBroll(list);
  }
  // A job that needs a newer Mac (`minWorker`, e.g. a video reel) waits for one: an older Mac never gets it.
  const claimed = claimJob(version);
  if (!claimed) return new Response(null, { status: 204 });
  // An edit lives for days (versions, feedback, final render): it gets the project's profile as it is now,
  // not as it was when the job was made. Not stored with the job.
  const styled = claimed.kind === "montage" || claimed.kind === "cover";
  // A video reel is written by Claude in the project's voice: tone, skill, model posts and inspiration images.
  const video = isVideoJob(claimed);
  // The style the job was made with (the default one when it was removed since).
  const voice = styled || video ? voiceOf(claimed.projectId, claimed.styleId) : undefined;
  const theme = styled ? themeOf(claimed.projectId, claimed.styleId) : undefined;
  // An animated reel shows the logo of its project: kept out of the stored job, added here.
  const owner = claimed.kind === "motion" && claimed.motion?.logo !== false && claimed.projectId ? listProjects().find((p) => p.id === claimed.projectId) : undefined;
  const logo = owner ? profileOf(owner, claimed.styleId).look.logo : undefined;
  if (claimed.motion && logo) claimed.motion = { ...claimed.motion, look: { ...claimed.motion.look, logo } };
  // The illustrations and sound effects of the job's style (worker 0.16.0 uses them; older ones ignore them).
  const assets = (styled || claimed.kind === "motion") && claimed.projectId ? assetsFor(claimed.projectId, claimed.styleId) : undefined;
  // A montage also gets the inspiration images of its style (worker 0.19.0 shows them to Claude; older ones ignore them).
  // The Claude model: the job's own, else the one of Réglages (passed to `claude --model`).
  const model = claimed.model || audioPrefs().claudeModel || undefined;
  // The thinking effort the same way (passed to `claude --effort`; older workers ignore it).
  const effort = claimed.effort || audioPrefs().claudeEffort || undefined;
  const job = { ...claimed, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(voice ? { voice: video ? voice : { tone: voice.tone, skill: voice.skill, ...(claimed.kind === "montage" && voice.images ? { images: voice.images } : {}) } } : {}), ...(theme ? { theme } : {}), ...(assets ? { assets } : {}) };
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
