import { addDays, setHours, setMinutes, startOfDay, subDays } from "date-fns";
import type { Account, Media, Post } from "./types";

// Demo data so the first render shows a realistic calendar.
// Replaced by the database and treg in step 2.

export const seedAccounts: Account[] = [
  { id: "ig-main", network: "instagram", name: "Antoine Quarroz", handle: "antoinequarroz", hue: 18, followers: 12400, connected: true },
  { id: "ig-studio", network: "instagram", name: "Metricove Studio", handle: "metricove.studio", hue: 280, followers: 3180, connected: true },
  { id: "fb-page", network: "facebook", name: "Metricove", handle: "metricove", hue: 220, followers: 5420, connected: true },
  { id: "x-main", network: "x", name: "Antoine", handle: "antoinequarroz", hue: 200, followers: 2210, connected: true },
  { id: "li-main", network: "linkedin", name: "Antoine Quarroz", handle: "antoine-quarroz", hue: 210, followers: 4870, connected: true },
  { id: "li-company", network: "linkedin", name: "Metricove SA", handle: "metricove", hue: 160, followers: 960, connected: false },
];

function at(base: Date, dayOffset: number, h: number, m = 0) {
  return setMinutes(setHours(addDays(startOfDay(base), dayOffset), h), m).toISOString();
}

export function seedMedia(now = new Date()): Media[] {
  return [
    { id: "m1", title: "Teaser automatisation Hermes", duration: 28, aspect: "9:16", source: "claude-code", createdAt: subDays(now, 0).toISOString(), hues: [18, 340] },
    { id: "m2", title: "Behind the scenes : setup VPS", duration: 47, aspect: "9:16", source: "claude-code", createdAt: subDays(now, 1).toISOString(), hues: [250, 200] },
    { id: "m3", title: "3 astuces calendrier éditorial", duration: 35, aspect: "1:1", source: "claude-code", createdAt: subDays(now, 1).toISOString(), hues: [150, 90] },
    { id: "m4", title: "Démo Metricove v2", duration: 62, aspect: "16:9", source: "claude-code", createdAt: subDays(now, 2).toISOString(), hues: [210, 280] },
    { id: "m5", title: "Story : nouveautés de la semaine", duration: 14, aspect: "9:16", source: "hermes", createdAt: subDays(now, 3).toISOString(), hues: [40, 10] },
    { id: "m6", title: "Interview client (cut court)", duration: 51, aspect: "9:16", source: "upload", createdAt: subDays(now, 4).toISOString(), hues: [190, 230] },
    { id: "m7", title: "Timelapse montage vidéo", duration: 22, aspect: "9:16", source: "claude-code", createdAt: subDays(now, 5).toISOString(), hues: [300, 20] },
  ];
}

export function seedPosts(now = new Date()): Post[] {
  const p = (
    id: string,
    accountIds: string[],
    caption: string,
    day: number,
    h: number,
    m: number,
    status: Post["status"],
    origin: Post["origin"],
    mediaId?: string,
  ): Post => ({ id, accountIds, caption, scheduledAt: at(now, day, h, m), status, origin, mediaId });

  return [
    p("p1", ["ig-main", "fb-page"], "Nouvelle vidéo : comment j'automatise mes contenus avec Claude Code 🎬", -9, 9, 0, "published", "claude-code", "m7"),
    p("p2", ["li-main"], "Ce que j'ai appris en lançant un outil interne en 2 semaines. Thread 👇", -7, 8, 30, "published", "manual"),
    p("p3", ["x-main"], "Hot take : un calendrier éditorial vaut mieux que 10 idées géniales.", -6, 12, 15, "published", "hermes"),
    p("p4", ["ig-studio"], "Coulisses du studio, saison 2.", -4, 18, 0, "failed", "manual", "m6"),
    p("p5", ["ig-main", "x-main", "li-main"], "Metricove v2 arrive. Toutes vos publications, un seul calendrier.", -2, 10, 0, "published", "claude-code", "m4"),
    p("p6", ["fb-page"], "Merci pour les 5000 abonnés ! 🧡", -1, 17, 30, "published", "manual"),
    p("p7", ["ig-main"], "Teaser : l'agent Hermes prend le relais pour les légendes.", 0, 18, 0, "scheduled", "claude-code", "m1"),
    p("p8", ["x-main"], "Petit rappel : le live commence demain à 12h.", 0, 11, 0, "published", "hermes"),
    p("p9", ["li-main", "fb-page"], "Comment je structure ma semaine de contenu (template gratuit).", 1, 8, 0, "scheduled", "manual"),
    p("p10", ["ig-studio", "ig-main"], "Behind the scenes : mon setup VPS pour l'automatisation.", 2, 19, 0, "scheduled", "claude-code", "m2"),
    p("p11", ["x-main"], "3 astuces pour ne plus jamais manquer une publication.", 3, 9, 30, "scheduled", "hermes", "m3"),
    p("p12", ["li-main"], "Étude de cas : +40% d'engagement en 30 jours.", 5, 8, 15, "draft", "manual"),
    p("p13", ["ig-main", "fb-page", "x-main"], "Les nouveautés de la semaine en 15 secondes.", 6, 17, 0, "scheduled", "hermes", "m5"),
    p("p14", ["fb-page"], "Sondage : quel format préférez-vous ?", 8, 12, 0, "draft", "manual"),
    p("p15", ["ig-main"], "Timelapse du montage de la semaine.", 10, 18, 30, "scheduled", "claude-code", "m7"),
    p("p16", ["li-main", "x-main"], "On recrute un·e content designer.", 12, 9, 0, "draft", "manual"),
    p("p17", ["ig-studio"], "Moodboard du mois.", 15, 20, 0, "scheduled", "manual"),
  ];
}
