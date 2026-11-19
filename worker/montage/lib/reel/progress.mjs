// Progression réelle d'un reel vidéo (METRI-17, paquet B) : phases prévues, fraction de la phase en cours, % jamais en
// recul, temps restant, PATCH limités (un toutes les 1,5 s au plus, plus un à chaque changement de phase) et battement
// de 15 s. Les durées attendues viennent de <workDir>/reel-stats.json (apprises sur ce Mac, moyenne glissante α 0,3),
// sinon de valeurs par défaut. step et progress partent TOUJOURS : un ancien serveur ou une ancienne page suit encore.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util.mjs";

/** Phases prévues selon le travail : création, retouche par Claude, édition à la main (aperçu). */
export const PLANS = Object.freeze({
  write: Object.freeze(["write", "check", "review", "render", "finish", "upload"]),
  revise: Object.freeze(["write", "check", "render", "finish", "upload"]),
  edit: Object.freeze(["check", "render", "finish", "upload"]),
});

/** Durées attendues par défaut (s), caractères attendus d'une partition, ms par image selon le système. */
// finish : 15 s (réencodage veryfast d'une vidéo au grain animé, environ 0,4 × la durée sur un Mac récent ; une seconde
// quand la vidéo de HyperFrames est gardée telle quelle). Le 8 s du design ne tenait pas : 56 à 150 s mesurées en crf 18
// preset medium sur une machine chargée.
export const DEFAULTS = Object.freeze({ write: 110, revise: 80, chars: 9000, check: 40, review: 60, finish: 15, upload: 5, frameMs: { darwin: 150, other: 90 } });

/** Plafonds de fraction : write sans flux 0,9, avec flux 0,95 ; check et review (au temps) 0,95. */
const CAP = Object.freeze({ stream: 0.95, time: 0.9, wait: 0.95 });

/** Textes de step (≤ 200), en français. */
export const STEP = Object.freeze({
  write: "Claude écrit la vidéo…",
  rewrite: "Claude réécrit la partition (réponse illisible)…",
  check: "Vérification dans Chrome…",
  board: "Premières images…",
  review: "Claude relit les images…",
  recheck: "Vérification des corrections…",
  finish: "Musique et finition…",
  upload: "Envoi vers Metricove…",
  noFresh: "Nouvel essai sans l'animation sur mesure…",
  safe: "Nouvel essai en mode sûr…",
  revise: "Claude retouche la vidéo…",
});

/** m:ss (comme la timeline et le prompt de retouche). */
export const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** « Claude retouche le passage 0:07–0:12… », ou toute la vidéo sans passage. */
export const reviseStep = (range) => (Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) && range[1] > range[0]
  ? `Claude retouche le passage ${fmtT(range[0])}–${fmtT(range[1])}…`
  : STEP.revise);

const ALPHA = 0.3;
const THROTTLE = 1500;
const HEARTBEAT = 15_000;
/**
 * Rendu : poids (en images) de la vitesse attendue face à la vitesse mesurée, oublié après 90 images si le Mac est plus
 * de 50 % plus lent que l'attendu (vitesse pas encore apprise) ; le temps restant ne remonte qu'au-delà de
 * max(45 s, 50 %). Réglages choisis par simulation (démarrage lent, à-coups, Mac 1,5 à 4 fois plus lent que prévu,
 * ralentissement progressif) et rejoués sur 11 vrais rendus du bac à sable : aucune remontée quand la vitesse est
 * apprise, une correction franche quand elle ne l'est pas.
 */
const PRIOR_FRAMES = 30;
const OFF = Object.freeze({ frames: 90, ratio: 0.5 });
const RISE = Object.freeze({ s: 45, ratio: 0.5 });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

export const statsFile = (cfg) => join(cfg.workDir, "reel-stats.json");

/** Les durées apprises sur ce Mac ({} si le fichier manque ou est illisible). */
export function readStats(cfg) {
  try {
    const j = JSON.parse(readFileSync(statsFile(cfg), "utf8"));
    return j && typeof j === "object" ? j : {};
  } catch { return {}; }
}

/** ms par image attendues : apprises, sinon 150 (macOS, capture par screenshot) ou 90 (Linux). */
export const frameMsOf = (stats = {}, platform = process.platform) => num(stats.frameMs) ?? (platform === "darwin" ? DEFAULTS.frameMs.darwin : DEFAULTS.frameMs.other);

/** Ce que la réclamation envoie : { frameMs, writeS } (le site estime « prête dans environ N min »). */
export function speedOf(cfg, platform = process.platform) {
  const s = readStats(cfg);
  return { frameMs: Math.round(frameMsOf(s, platform)), writeS: Math.round(num(s.write) ?? DEFAULTS.write) };
}

/** Met à jour reel-stats.json avec des mesures { clé: valeur } (moyenne glissante α 0,3 ; écriture atomique). */
export function learnStats(cfg, measured) {
  const s = readStats(cfg);
  for (const [k, v] of Object.entries(measured)) {
    const x = num(v);
    if (x === undefined) continue;
    const old = num(s[k]);
    s[k] = Math.round((old === undefined ? x : old + ALPHA * (x - old)) * 100) / 100;
  }
  s.runs = (Number(s.runs) || 0) + 1;
  s.updatedAt = new Date().toISOString();
  try {
    const f = statsFile(cfg);
    writeFileSync(f + ".tmp", JSON.stringify(s, null, 2));
    renameSync(f + ".tmp", f);
  } catch (e) { log("statistiques du reel non écrites :", e.message); }
  return s;
}

export class Progress {
  /**
   * @param api   client Api (step(id, s, p, extra) : les erreurs sont déjà avalées)
   * @param job   la tâche ({ id })
   * @param o.kind      "write" | "revise" | "edit"
   * @param o.frames    images attendues avant que la durée soit connue (900 = 30 s)
   * @param o.now       horloge (tests) ; o.timers=false : ni battement ni envoi différé (tests)
   */
  constructor(api, cfg, job, { kind = "write", frames = 900, now = Date.now, platform = process.platform, stats = readStats(cfg), timers = true } = {}) {
    this.api = api;
    this.cfg = cfg;
    this.id = job.id;
    this.kind = PLANS[kind] ? kind : "write";
    this.now = now;
    this.phases = [...PLANS[this.kind]];
    this.frameMs = frameMsOf(stats, platform);
    this.expChars = num(stats.chars) ?? DEFAULTS.chars;
    this.exp = {
      write: num(this.kind === "revise" ? stats.revise : stats.write) ?? (this.kind === "revise" ? DEFAULTS.revise : DEFAULTS.write),
      check: num(stats.check) ?? DEFAULTS.check,
      review: num(stats.review) ?? DEFAULTS.review,
      render: (frames * this.frameMs) / 1000,
      finish: num(stats.finish) ?? DEFAULTS.finish,
      upload: DEFAULTS.upload,
    };
    this.uploadBps = num(stats.uploadBps);
    this.totalFrames = frames;
    this.phase = null;
    this.phaseAt = now(); // début de l'essai en cours (un rendu repris repart de zéro)
    this.phaseStart = this.phaseAt; // début de la phase, essais compris (durée réelle de done)
    this.startedAt = now();
    this.frac = 0;
    this.streamed = false;
    this.text = "Démarrage…";
    this.base = this.text;
    this.done = [];
    this.sent = 0;
    this.frame = null;
    this.frameLog = [];
    this.frameFirst = null;
    this.hold = null;
    this.beatsList = null;
    this.beatsDirty = false;
    this.lastAt = 0;
    this.lastBody = null;
    this.pending = null;
    this.chain = Promise.resolve();
    this.inflight = false;
    this.again = false;
    this.stopped = false;
    this.patches = 0;
    this.measured = {};
    this.timers = timers;
    this.hb = timers ? setInterval(() => this.tick(), HEARTBEAT) : null;
    this.hb?.unref?.();
  }

  /**
   * Passe à la phase `phase` (la précédente est comptée finie avec sa durée réelle) ; envoi immédiat. La même phase
   * relancée (rendu de repli) n'est pas comptée finie : seul l'essai repart de zéro.
   */
  start(phase, text) {
    if (!this.phases.includes(phase)) this.phases.splice(this.insertAt(phase), 0, phase);
    if (phase !== this.phase) {
      this.close();
      this.phaseStart = this.now();
    }
    this.phase = phase;
    this.phaseAt = this.now();
    this.frac = 0;
    this.streamed = false;
    this.frame = null;
    this.frameLog = [];
    this.frameFirst = null;
    this.hold = null;
    if (text) this.text = String(text).slice(0, 200);
    this.base = this.text;
    this.send(true);
  }

  /** Place d'une phase ajoutée en route (ordre canonique). */
  insertAt(phase) {
    const order = PLANS.write;
    const i = this.phases.findIndex((p) => order.indexOf(p) > order.indexOf(phase));
    return i < 0 ? this.phases.length : i;
  }

  /** Note la phase en cours comme finie (durée réelle) sans en ouvrir d'autre. */
  close() {
    if (!this.phase || this.done.some((d) => d.phase === this.phase)) return;
    const s = Math.round(((this.now() - this.phaseStart) / 1000) * 10) / 10;
    this.done.push({ phase: this.phase, s: clamp(s, 0, 3600) });
    this.measured[this.phase] = s;
  }

  /** Retire une phase prévue qui n'aura pas lieu (relecture sautée) : le % reste monotone. */
  drop(phase) {
    if (phase === this.phase || this.done.some((d) => d.phase === phase)) return;
    const i = this.phases.indexOf(phase);
    if (i >= 0) { this.phases.splice(i, 1); this.send(); }
  }

  /** Texte de step de la phase en cours. */
  step(text) {
    this.text = String(text || "").slice(0, 200);
    this.base = this.text;
    this.send();
  }

  /** Fraction connue de la phase en cours (finish 0 puis 1, upload morceaux envoyés ÷ total…). */
  fraction(f) {
    this.frac = clamp(Math.max(this.frac, Number(f) || 0), 0, 1);
    this.send();
  }

  /** Écriture en flux : caractères reçus ÷ attendus (plafond 0,95) et « N temps forts » ; le temps écoulé compte aussi (current). */
  writing(chars, beats = 0) {
    this.streamed = true;
    this.chars = chars;
    this.frac = clamp(Math.max(this.frac, chars / this.expChars), 0, CAP.stream);
    if (beats > 0) this.text = `${this.base}${this.base.endsWith("…") ? "" : "…"} ${beats} temps fort${beats > 1 ? "s" : ""}`.slice(0, 200);
    this.send();
  }

  /** Images à rendre, dès que la durée est connue (attendu du rendu = images × ms par image). */
  setFrames(n) {
    if (!(n > 0)) return;
    this.totalFrames = n;
    this.exp.render = (n * this.frameMs) / 1000;
  }

  /** Taille de la vidéo à envoyer : attendu de l'envoi = octets ÷ débit appris (5 s par défaut). */
  setUploadBytes(bytes) {
    this.uploadBytes = bytes;
    if (this.uploadBps) this.exp.upload = clamp(bytes / this.uploadBps, 1, 600);
  }

  /** Avancement du rendu lu sur stdout : image i sur n (exact). */
  frames(i, n) {
    if (!(n > 0)) return;
    const t = this.now();
    if (!this.frame || i > this.frame[0]) this.frameLog.push([i, t]);
    if (!this.frameFirst && i > 0) this.frameFirst = [i, t];
    if (this.frameLog.length > 61) this.frameLog.splice(0, this.frameLog.length - 61);
    this.frame = [Math.min(i, n), n];
    if (n !== this.totalFrames) this.setFrames(n);
    this.frac = clamp(i / n, 0, 1);
    this.text = `Rendu : image ${Math.min(i, n)} sur ${n}`;
    this.send();
  }

  /**
   * ms par image attendues pour la suite du rendu (null avant deux relevés) : la moyenne mobile des 60 dernières
   * images, lissée par la moyenne depuis la première image et par la vitesse attendue (poids de 30 images, qui
   * s'efface à mesure que le rendu avance, et tout de suite si ce Mac est plus de 50 % plus lent après 90 images).
   * Le démarrage lent ou un à-coup de charge ne font plus bondir l'estimation.
   */
  frameRate() {
    const l = this.frameLog;
    if (l.length < 2 || !this.frameFirst) return null;
    const [i0, t0] = l[0], [i1, t1] = l[l.length - 1];
    const [f0, ft] = this.frameFirst;
    if (!(i1 > i0) || !(i1 > f0)) return null;
    const recent = (t1 - t0) / (i1 - i0);
    const overall = (t1 - ft) / (i1 - f0);
    const n = i1 - f0;
    const measured = n < 60 ? overall : (recent + overall) / 2;
    const k = n >= OFF.frames && measured / this.frameMs - 1 > OFF.ratio ? 0 : PRIOR_FRAMES;
    return (k * this.frameMs + n * measured) / (k + n);
  }

  /** Repères connus après la partition : [{ id, title, start, end }] (envoyés une fois, puis à chaque changement). */
  beats(list) {
    const next = (list || []).slice(0, 12).map((b) => ({ id: b.id, title: String(b.title || "").slice(0, 40), start: b.start, end: b.end }));
    if (JSON.stringify(next) === JSON.stringify(this.beatsList)) return;
    this.beatsList = next;
    this.beatsDirty = true;
    this.send(true);
  }

  /** Fraction de la phase en cours, au temps pour celles qui ne se mesurent pas. */
  current() {
    const p = this.phase;
    if (!p) return 0;
    const el = (this.now() - this.phaseAt) / 1000;
    const exp = this.exp[p] || 1;
    // Écriture : le plus avancé du temps écoulé et des caractères reçus (Claude réfléchit souvent 20 à 30 s avant le
    // premier caractère : le % ne reste pas figé, et le temps restant ne remonte pas quand le flux commence).
    if (p === "write") return Math.max(this.frac, Math.min(CAP.time, el / exp));
    if (p === "check" || p === "review") return Math.max(this.frac, Math.min(CAP.wait, el / exp));
    return this.frac;
  }

  /** Progression 0..1 : (attendu des phases finies + fraction × attendu de la phase en cours) ÷ attendu total, jamais en recul. */
  progress() {
    const total = this.phases.reduce((a, p) => a + (this.exp[p] || 0), 0) || 1;
    const i = this.phase ? this.phases.indexOf(this.phase) : -1;
    const before = i < 0 ? 0 : this.phases.slice(0, i).reduce((a, p) => a + (this.exp[p] || 0), 0);
    const p = (before + (i < 0 ? 0 : this.current() * (this.exp[this.phase] || 0))) / total;
    this.sent = Math.max(this.sent, clamp(p, 0, 0.999));
    return this.sent;
  }

  /**
   * Temps restant (s, arrondi à 5 s) : reste de la phase en cours + attendu des suivantes. Pendant le rendu, il ne
   * remonte pas : l'heure de fin annoncée (maintenant + eta, que le Studio décompte seul) est tenue tant que la nouvelle
   * estimation ne la dépasse pas de plus de max(45 s, 50 %) ; au-delà, elle est corrigée franchement (Mac bien plus lent
   * que prévu), jamais avant 90 images mesurées. Un dépassement plus petit se voit dans le Studio par « un peu plus long
   * que prévu ».
   */
  eta() {
    const i = this.phase ? this.phases.indexOf(this.phase) : -1;
    const after = this.phases.slice(i + 1).reduce((a, p) => a + (this.exp[p] || 0), 0);
    let rest = 0;
    if (this.phase) {
      const el = (this.now() - this.phaseAt) / 1000;
      const exp = this.exp[this.phase] || 0;
      const rate = this.phase === "render" ? this.frameRate() : null;
      const f = this.current();
      if (rate && this.frame) rest = ((this.frame[1] - this.frame[0]) * rate) / 1000;
      else if (f <= 0.15) rest = Math.max(5, exp - el);
      else rest = (el / f) * (1 - f);
    }
    let v = rest + after;
    if (this.phase === "render") {
      const t = this.now();
      if (this.hold) {
        const allowed = Math.max(0, this.hold.v - (t - this.hold.at) / 1000);
        // Pas de correction avant 90 images mesurées : le démarrage du rendu est trop bruité pour la justifier.
        const measured = this.frameFirst && this.frame ? this.frame[0] - this.frameFirst[0] : 0;
        if (v > allowed && (measured < OFF.frames || v - allowed <= Math.max(RISE.s, RISE.ratio * allowed))) v = allowed;
      }
      this.hold = { v, at: t };
    }
    return clamp(Math.round(v / 5) * 5, 0, 3600);
  }

  /** Le corps du PATCH (step et progress toujours présents). */
  body() {
    const b = { step: this.text.slice(0, 200), progress: Math.round(this.progress() * 1000) / 1000, phases: [...this.phases], eta: this.eta() };
    if (this.phase) b.phase = this.phase;
    if (this.frame) b.frames = [...this.frame];
    if (this.beatsDirty && this.beatsList) b.beats = this.beatsList;
    if (this.done.length) b.done = this.done.slice(0, 6);
    return b;
  }

  /** Demande un envoi : immédiat si `force` ou si 1,5 s sont passées, sinon un seul envoi différé. */
  send(force = false) {
    const wait = this.lastAt + THROTTLE - this.now();
    if (force || wait <= 0) return this.flush();
    this.dirty = true;
    if (this.timers && !this.pending) {
      this.pending = setTimeout(() => { this.pending = null; if (this.dirty) this.flush(); }, wait);
      this.pending.unref?.();
    }
    return this.chain;
  }

  /**
   * Envoie le corps maintenant. Un seul PATCH en route à la fois : pendant qu'il attend la réponse, les demandes ne
   * font pas la queue, le corps le plus récent part une seule fois, dès sa réponse (un serveur lent ne retarde pas
   * une file de vieux états, et le délai de chaque requête d'api.mjs borne l'attente).
   */
  flush() {
    if (this.pending) { clearTimeout(this.pending); this.pending = null; }
    if (this.inflight) { this.again = true; return this.chain; }
    this.dirty = false;
    this.again = false;
    const b = this.body();
    this.beatsDirty = false;
    this.lastAt = this.now();
    this.lastBody = b;
    this.patches++;
    const { step, progress, ...extra } = b;
    this.inflight = true;
    let req;
    try { req = Promise.resolve(this.api.step(this.id, step, progress, extra)); } catch (e) { req = Promise.reject(e); }
    this.chain = req
      .catch(() => {})
      .finally(() => {
        this.inflight = false;
        if (this.again && !this.stopped) this.flush();
      });
    return this.chain;
  }

  /** Battement de 15 s : renvoie le corps (recalculé) s'il n'est rien parti depuis ; rien si un PATCH est encore en route. */
  tick() {
    if (this.inflight) return this.chain;
    if (this.now() - this.lastAt >= HEARTBEAT - 500 || this.dirty) return this.flush();
    return this.chain;
  }

  /** Fin du travail : dernière phase comptée, minuteries arrêtées, le PATCH en route attendu, puis le dernier envoi. */
  async end() {
    this.close();
    this.stop();
    for (let k = 0; k < 5 && this.inflight; k++) await this.chain;
    this.inflight = false;
    await this.flush();
  }

  stop() {
    if (this.hb) clearInterval(this.hb);
    if (this.pending) clearTimeout(this.pending);
    this.hb = null;
    this.pending = null;
    this.stopped = true;
  }

  /**
   * Apprend les durées de ce travail (reel-stats.json) : durées réelles des phases, ms par image du rendu, débit de
   * l'envoi, caractères de la partition. `extra` : mesures en plus (ex. { frameMs } lu sur le résumé du rendu).
   */
  learn(extra = {}) {
    const m = { ...extra };
    for (const d of this.done) {
      if (d.phase === "write") m[this.kind === "revise" ? "revise" : "write"] = d.s;
      else if (d.phase === "check" || d.phase === "review" || d.phase === "finish") m[d.phase] = d.s;
      else if (d.phase === "render" && this.totalFrames > 0 && !m.frameMs) m.frameMs = (d.s * 1000) / this.totalFrames;
      else if (d.phase === "upload" && this.uploadBytes && d.s > 0) m.uploadBps = this.uploadBytes / d.s;
    }
    if (this.kind === "write" && this.chars > 1000) m.chars = this.chars;
    return learnStats(this.cfg, m);
  }
}
