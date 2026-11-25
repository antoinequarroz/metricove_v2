"use client";

import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Popover } from "@base-ui-components/react/popover";
import { ChevronLeft, ChevronRight, Plus, Sparkles, Bot, Images, CalendarRange } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { NETWORK_ORDER, NETWORKS, NetworkBadge } from "@/lib/networks";
import { useStore, useVisiblePosts, type CalendarView } from "@/lib/store";
import type { Post } from "@/lib/types";
import { cn, fmt } from "@/lib/utils";
import { waitsInTikTok } from "@/lib/publish-result";
import { AvatarStack, Button, MediaThumb, STATUS_META, StatusPill } from "./ui";

const WEEK = { weekStartsOn: 1 as const };

export function CalendarPage() {
  const view = useStore((s) => s.view);
  return (
    <>
      <CalendarHeader />
      <div className="min-h-0 flex-1">
        {view === "month" && <MonthView />}
        {view === "week" && <WeekView />}
        {view === "list" && <ListView />}
      </div>
    </>
  );
}

function CalendarHeader() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const cursor = new Date(useStore((s) => s.cursor));
  const setCursor = useStore((s) => s.setCursor);
  const filter = useStore((s) => s.networkFilter);
  const setFilter = useStore((s) => s.setNetworkFilter);
  const posts = useVisiblePosts();

  const step = (dir: 1 | -1) => setCursor(view === "week" ? addWeeks(cursor, dir) : addMonths(cursor, dir));

  const title =
    view === "week"
      ? `${fmt(startOfWeek(cursor, WEEK), "d MMM")} – ${fmt(endOfWeek(cursor, WEEK), "d MMM yyyy")}`
      : fmt(cursor, "MMMM yyyy");

  const now = new Date();
  const weekStart = startOfWeek(now, WEEK);
  const weekEnd = endOfWeek(now, WEEK);
  const stats = [
    { label: "programmés cette semaine", value: posts.filter((p) => p.status === "scheduled" && new Date(p.scheduledAt) >= weekStart && new Date(p.scheduledAt) <= weekEnd).length },
    { label: "publiés ce mois", value: posts.filter((p) => p.status === "published" && isSameMonth(new Date(p.scheduledAt), now)).length },
    { label: "brouillons", value: posts.filter((p) => p.status === "draft").length },
    { label: "échecs", value: posts.filter((p) => p.status === "failed").length, danger: true },
  ];

  return (
    <header className="border-b border-line px-6 py-5 max-md:px-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-[30px] leading-none first-letter:uppercase">
            {title.slice(0, -5)} <span className="text-ink-3">{title.slice(-4)}</span>
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-3">Calendrier éditorial</p>
        </div>

        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setCursor(new Date())}>
            Aujourd&apos;hui
          </Button>
          <div className="flex">
            <Button size="sm" variant="ghost" className="w-7 px-0" aria-label="Précédent" onClick={() => step(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" className="w-7 px-0" aria-label="Suivant" onClick={() => step(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex gap-4 max-xl:hidden">
            {stats.map((s) => (
              <div key={s.label} className="flex items-baseline gap-1.5">
                <span className={cn("tabular text-[16px] font-semibold tracking-tight", s.danger && s.value > 0 && "text-danger")}>{s.value}</span>
                <span className="text-[12px] text-ink-3">{s.label}</span>
              </div>
            ))}
          </div>
          <Segmented<CalendarView>
            value={view}
            onChange={setView}
            options={[
              { value: "month", label: "Mois" },
              { value: "week", label: "Semaine" },
              { value: "list", label: "Liste" },
            ]}
          />
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            Tous les réseaux
          </FilterChip>
          {NETWORK_ORDER.map((n) => (
            <FilterChip key={n} active={filter === n} onClick={() => setFilter(n)}>
              <NetworkBadge network={n} size="xs" />
              {NETWORKS[n].label}
            </FilterChip>
          ))}
        </div>
      </div>
    </header>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "press inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px]",
        active ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex rounded-lg border border-line bg-bg-2/70 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-md px-3 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-150",
            value === o.value ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Month ---------- */

function useDnd() {
  const movePost = useStore((s) => s.movePost);
  const posts = useStore((s) => s.posts);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const post = posts.find((p) => p.id === e.active.id);
    const day = String(e.over.id);
    if (!post || isSameDay(new Date(post.scheduledAt), new Date(day))) return;
    if (post.status === "published") {
      toast.error("Ce post est déjà publié", { description: "Il ne peut plus être déplacé." });
      return;
    }
    if (post.status === "publishing") return;
    movePost(post.id, day).then(
      (p) => toast.success("Post déplacé", { description: `Programmé le ${fmt(p.scheduledAt, "EEEE d MMMM 'à' HH:mm")}.` }),
      (err: Error) => toast.error("Déplacement impossible", { description: err.message }),
    );
  };
  return { sensors, onDragEnd };
}

// Hauteur minimale d'une semaine en vue Mois : de quoi voir le jour et un post. Six semaines tiennent en 1280x720.
const MONTH_ROW_MIN = 76;
const CHIP_GAP = 4;

/** Nombre de posts qui tiennent en entier dans la case (« +N autres » est dans l'en-tête du jour). */
function fitCount(height: number, chip: number, total: number) {
  return Math.min(total, Math.max(0, Math.floor((height + CHIP_GAP) / (chip + CHIP_GAP))));
}

function MonthView() {
  const cursor = new Date(useStore((s) => s.cursor));
  const posts = useVisiblePosts();
  const { sensors, onDragEnd } = useDnd();

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), WEEK);
    const end = endOfWeek(endOfMonth(cursor), WEEK);
    return eachDayOfInterval({ start, end });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor.getFullYear(), cursor.getMonth()]);

  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of [...posts].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
      const k = startOfDay(new Date(p.scheduledAt)).toISOString();
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return map;
  }, [posts]);

  const weeks = days.length / 7;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {/* Le mois remplit la hauteur disponible ; sous la hauteur minimale des semaines, la vue défile. */}
      <div className="scroll-thin flex h-full flex-col overflow-y-auto">
        <div className="sticky top-0 z-10 grid grid-cols-7 border-b border-line bg-surface/90 backdrop-blur">
          {days.slice(0, 7).map((d) => (
            <div key={d.toISOString()} className="px-3 py-2 text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">
              {fmt(d, "EEE")}
            </div>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks}, minmax(${MONTH_ROW_MIN}px, 1fr))` }}>
          {days.map((d, i) => (
            <DayCell key={d.toISOString()} day={d} inMonth={isSameMonth(d, cursor)} posts={byDay.get(d.toISOString()) ?? []} index={i} />
          ))}
        </div>
      </div>
    </DndContext>
  );
}

function DayCell({ day, inMonth, posts, index }: { day: Date; inMonth: boolean; posts: Post[]; index: number }) {
  const openComposer = useStore((s) => s.openComposer);
  const { setNodeRef, isOver } = useDroppable({ id: day.toISOString() });
  const past = isBefore(day, startOfDay(new Date()));
  const today = isToday(day);
  const cellRef = useRef<HTMLDivElement | null>(null);
  const [detail, setDetail] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const chipHeight = useRef(40);
  const [max, setMax] = useState(3);

  // La case ne grandit plus avec ses posts : on affiche ceux qui tiennent, le reste passe dans « +N autres ».
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const chips = el.querySelectorAll<HTMLElement>("[data-chip]");
      if (chips.length) chipHeight.current = Math.max(...Array.from(chips, (c) => c.offsetHeight));
      setMax(fitCount(el.clientHeight, chipHeight.current, posts.length));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [posts.length]);

  const hidden = posts.length - max;

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        cellRef.current = el;
      }}
      className={cn(
        "group relative flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden border-line p-1.5 transition-colors duration-150",
        index % 7 !== 6 && "border-r",
        "border-b",
        !inMonth && "bg-bg-2/40",
        past && inMonth && "bg-[repeating-linear-gradient(135deg,transparent_0_7px,color-mix(in_oklab,var(--line)_50%,transparent)_7px_8px)]",
        isOver && "bg-accent-soft",
      )}
    >
      <div className="flex items-center justify-between px-1">
        <button
          onClick={() => posts.length > 0 && setDetail(true)}
          disabled={posts.length === 0}
          aria-label={posts.length > 0 ? `Voir la journée du ${fmt(day, "d MMMM")}` : undefined}
          className={cn(
            "tabular flex h-5 min-w-5 items-center justify-center rounded-full text-[12.5px] disabled:cursor-default",
            today ? "bg-accent px-1.5 font-semibold text-accent-ink" : inMonth ? "text-ink" : "text-ink-3",
            posts.length > 0 && !today && "hover:bg-ink/5",
          )}
        >
          {fmt(day, "d")}
        </button>
        {hidden > 0 && (
          <button
            onClick={() => setDetail(true)}
            title="Voir toute la journée"
            className="ml-auto rounded px-1.5 text-[11.5px] leading-5 font-medium whitespace-nowrap text-ink-3 hover:bg-ink/5 hover:text-ink"
          >
            {max > 0 ? `+${hidden} ${hidden > 1 ? "autres" : "autre"}` : `${hidden} ${hidden > 1 ? "posts" : "post"}`}
          </button>
        )}
        {!past && (
          <button
            onClick={() => openComposer({ date: day.toISOString() })}
            aria-label={`Créer un post le ${fmt(day, "d MMMM")}`}
            className="press flex size-5 items-center justify-center rounded-md text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-ink/5 hover:text-ink focus-visible:opacity-100"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      <div ref={listRef} className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex flex-col gap-1">
          {posts.slice(0, max).map((p) => (
            <PostChip key={p.id} post={p} />
          ))}
        </div>
      </div>
      {posts.length > 0 && <DayDetail day={day} posts={posts} past={past} open={detail} onOpenChange={setDetail} anchor={cellRef} />}
    </div>
  );
}

/** Le détail d'une journée : tous ses posts, même ceux qui ne tiennent pas dans la case du mois. */
function DayDetail({
  day,
  posts,
  past,
  open,
  onOpenChange,
  anchor,
}: {
  day: Date;
  posts: Post[];
  past: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: React.RefObject<HTMLDivElement | null>;
}) {
  const accounts = useStore((s) => s.accounts);
  const media = useStore((s) => s.media);
  const openComposer = useStore((s) => s.openComposer);
  const setView = useStore((s) => s.setView);
  const setCursor = useStore((s) => s.setCursor);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} side="bottom" align="start" sideOffset={-28} collisionPadding={12} className="z-[60]">
          <Popover.Popup className="popover-popup flex max-h-[min(560px,calc(100dvh-24px))] w-[min(400px,calc(100vw-24px))] flex-col rounded-xl border border-line-strong bg-surface shadow-[0_20px_50px_-15px_rgba(0,0,0,0.35)] outline-none">
            <div className="flex items-baseline gap-2 border-b border-line px-4 pt-3.5 pb-3">
              <Popover.Title className={cn("text-[14px] font-semibold first-letter:uppercase", isToday(day) && "text-accent")}>
                {isToday(day) ? "Aujourd'hui" : fmt(day, "EEEE")}
              </Popover.Title>
              <span className="text-[13px] text-ink-3">{fmt(day, "d MMMM")}</span>
              <span className="tabular ml-auto text-[12px] text-ink-3">
                {posts.length} {posts.length > 1 ? "posts" : "post"}
              </span>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
              {posts.map((p) => {
                const m = media.find((x) => x.id === p.mediaId);
                const accs = accounts.filter((a) => p.accountIds.includes(a.id));
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      onOpenChange(false);
                      openComposer({ postId: p.id });
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-surface-2"
                  >
                    <span className="tabular w-10 shrink-0 font-mono text-[12px] text-ink-2">{fmt(p.scheduledAt, "HH:mm")}</span>
                    {m ? <MediaThumb media={m} showMeta={false} className="h-10 w-8 shrink-0 rounded-md" /> : <span className="h-10 w-8 shrink-0 rounded-md border border-dashed border-line-strong" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px]">
                        {p.format === "story" && <span className="shrink-0 rounded-[4px] bg-accent-soft px-1 text-[9.5px] leading-[14px] font-semibold tracking-wide text-accent uppercase">Story</span>}
                        <span className="truncate">{p.caption || (p.format === "story" ? "Story" : "")}</span>
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
                        <AvatarStack accounts={accs} size={14} />
                        <span className="truncate">{accs.map((a) => `@${a.handle}`).join(", ")}</span>
                      </span>
                    </span>
                    <StatusPill status={p.status} inbox={waitsInTikTok(p)} />
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1 border-t border-line p-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onOpenChange(false);
                  setCursor(day);
                  setView("week");
                }}
              >
                <CalendarRange className="size-3.5" />
                Voir la semaine
              </Button>
              {!past && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => {
                    onOpenChange(false);
                    openComposer({ date: day.toISOString() });
                  }}
                >
                  <Plus className="size-3.5" />
                  Nouveau post
                </Button>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PostChip({ post }: { post: Post }) {
  const accounts = useStore((s) => s.accounts);
  const media = useStore((s) => s.media);
  const openComposer = useStore((s) => s.openComposer);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: post.id });
  const m = media.find((x) => x.id === post.mediaId);
  const accs = accounts.filter((a) => post.accountIds.includes(a.id));
  const networks = [...new Set(accs.map((a) => a.network))];

  return (
    <button
      ref={setNodeRef}
      data-chip
      {...listeners}
      {...attributes}
      onClick={() => openComposer({ postId: post.id })}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(
        "group/chip relative flex w-full shrink-0 items-center gap-1.5 overflow-hidden rounded-md border border-line bg-surface py-1 pr-1.5 pl-2 text-left shadow-[0_1px_1px_rgba(0,0,0,0.04)] outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-accent/40",
        isDragging ? "z-50 cursor-grabbing shadow-card ring-1 ring-accent/40" : "transition-[border-color,box-shadow] duration-150",
        post.status === "draft" && "border-dashed bg-surface/60",
      )}
    >
      <span className={cn("absolute inset-y-1 left-0.5 w-[3px] rounded-full", STATUS_META[post.status].dot)} />
      {m && <MediaThumb media={m} showMeta={false} className="size-5 shrink-0 rounded-[4px] max-md:hidden" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="tabular font-mono text-[10.5px] text-ink-3">{fmt(post.scheduledAt, "HH:mm")}</span>
          <span className="flex gap-0.5">
            {networks.map((n) => (
              <NetworkBadge key={n} network={n} size="xs" className="!size-3 !rounded-[3px] !p-[1.5px]" />
            ))}
          </span>
          {post.format === "story" && <span className="shrink-0 rounded-[4px] bg-accent-soft px-1 text-[9.5px] leading-[14px] font-semibold tracking-wide text-accent uppercase">Story</span>}
{(post.mediaIds?.length ?? 0) > 1 && post.format !== "story" && <span className="tabular inline-flex shrink-0 items-center gap-0.5 rounded-[4px] bg-ink/[0.07] px-1 font-mono text-[9.5px] leading-[14px] font-semibold text-ink-2" title={`Carrousel de ${post.mediaIds!.length} médias`}><Images className="size-2.5" />{post.mediaIds!.length}</span>}
          {post.origin !== "manual" && (
            <span className="ml-auto text-ink-3" title={post.origin === "hermes" ? "Créé par Hermes" : "Vidéo Claude Code"}>
              {post.origin === "hermes" ? <Bot className="size-3" /> : <Sparkles className="size-3" />}
            </span>
          )}
        </span>
        <span className={cn("block truncate text-[12px] leading-snug", post.status === "published" ? "text-ink-2" : "text-ink")}>{post.caption || (post.format === "story" ? "Story" : "")}</span>
      </span>
    </button>
  );
}

/* ---------- Week ---------- */

const HOURS = Array.from({ length: 17 }, (_, i) => i + 7);
const HOUR_PX = 52;

function WeekView() {
  const cursor = new Date(useStore((s) => s.cursor));
  const posts = useVisiblePosts();
  const accounts = useStore((s) => s.accounts);
  const media = useStore((s) => s.media);
  const openComposer = useStore((s) => s.openComposer);
  const start = startOfWeek(cursor, WEEK);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const now = new Date();

  return (
    <div className="scroll-thin h-full overflow-auto">
      <div className="sticky top-0 z-10 grid grid-cols-[56px_repeat(7,minmax(120px,1fr))] border-b border-line bg-surface/90 backdrop-blur">
        <div />
        {days.map((d) => (
          <div key={d.toISOString()} className="flex items-baseline gap-1.5 border-l border-line px-3 py-2.5">
            <span className="text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">{fmt(d, "EEE")}</span>
            <span className={cn("tabular text-[15px] font-semibold", isToday(d) && "text-accent")}>{fmt(d, "d")}</span>
          </div>
        ))}
      </div>
      <div className="relative grid grid-cols-[56px_repeat(7,minmax(120px,1fr))] pt-2">
        <div>
          {HOURS.map((h) => (
            <div key={h} className="tabular relative pr-2 text-right font-mono text-[10.5px] text-ink-3" style={{ height: HOUR_PX }}>
              <span className="relative -top-1.5">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>
        {days.map((d) => {
          const dayPosts = posts.filter((p) => isSameDay(new Date(p.scheduledAt), d));
          return (
            <div key={d.toISOString()} className={cn("relative border-l border-line", isToday(d) && "bg-accent-soft/40")}>
              {HOURS.map((h) => (
                <button
                  key={h}
                  aria-label={`Créer un post le ${fmt(d, "d MMMM")} à ${h}h`}
                  onClick={() => {
                    const date = new Date(d);
                    date.setHours(h, 0, 0, 0);
                    openComposer({ date: date.toISOString() });
                  }}
                  className="block w-full border-b border-line/70 transition-colors duration-150 hover:bg-ink/[0.03]"
                  style={{ height: HOUR_PX }}
                />
              ))}
              {isToday(d) && now.getHours() >= HOURS[0] && (
                <div className="pointer-events-none absolute inset-x-0 z-[5] flex items-center" style={{ top: (now.getHours() - HOURS[0] + now.getMinutes() / 60) * HOUR_PX }}>
                  <span className="-ml-1 size-2 rounded-full bg-accent" />
                  <span className="h-px flex-1 bg-accent" />
                </div>
              )}
              {dayPosts.map((p) => {
                const t = new Date(p.scheduledAt);
                const top = Math.max(0, (t.getHours() - HOURS[0] + t.getMinutes() / 60) * HOUR_PX);
                const m = media.find((x) => x.id === p.mediaId);
                const accs = accounts.filter((a) => p.accountIds.includes(a.id));
                return (
                  <button
                    key={p.id}
                    onClick={() => openComposer({ postId: p.id })}
                    className={cn(
                      "press absolute inset-x-1 z-[6] flex gap-1.5 overflow-hidden rounded-lg border border-line-strong bg-surface p-1.5 text-left shadow-card hover:border-ink/25",
                      p.status === "draft" && "border-dashed",
                    )}
                    style={{ top: top + 2, height: HOUR_PX * 1.25 }}
                  >
                    <span className={cn("w-[3px] shrink-0 rounded-full", STATUS_META[p.status].dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="tabular font-mono text-[10.5px] text-ink-3">{fmt(t, "HH:mm")}</span>
                        <span className="flex gap-0.5">
                          {[...new Set(accs.map((a) => a.network))].map((n) => (
                            <NetworkBadge key={n} network={n} size="xs" className="!size-3 !rounded-[3px] !p-[1.5px]" />
                          ))}
                        </span>
                        {p.format === "story" && <span className="shrink-0 rounded-[4px] bg-accent-soft px-1 text-[9.5px] leading-[14px] font-semibold tracking-wide text-accent uppercase">Story</span>}
{(p.mediaIds?.length ?? 0) > 1 && p.format !== "story" && <span className="tabular inline-flex shrink-0 items-center gap-0.5 rounded-[4px] bg-ink/[0.07] px-1 font-mono text-[9.5px] leading-[14px] font-semibold text-ink-2" title={`Carrousel de ${p.mediaIds!.length} médias`}><Images className="size-2.5" />{p.mediaIds!.length}</span>}
                      </span>
                      <span className="line-clamp-2 text-[11.5px] leading-snug">{p.caption || (p.format === "story" ? "Story" : "")}</span>
                    </span>
                    {m && <MediaThumb media={m} showMeta={false} className="h-full w-7 shrink-0 rounded-md" />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- List ---------- */

function ListView() {
  const posts = useVisiblePosts();
  const accounts = useStore((s) => s.accounts);
  const media = useStore((s) => s.media);
  const openComposer = useStore((s) => s.openComposer);
  const from = startOfDay(addDays(new Date(), -3));
  const upcoming = [...posts].filter((p) => new Date(p.scheduledAt) >= from).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  const groups = new Map<string, Post[]>();
  for (const p of upcoming) {
    const k = startOfDay(new Date(p.scheduledAt)).toISOString();
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto px-6 py-4 max-md:px-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        {[...groups.entries()].map(([day, list], gi) => (
          <section key={day} className="rise" style={{ animationDelay: `${Math.min(gi, 8) * 40}ms` }}>
            <h2 className="mb-2 flex items-baseline gap-2 text-[13px]">
              <span className={cn("font-semibold capitalize", isToday(new Date(day)) && "text-accent")}>{isToday(new Date(day)) ? "Aujourd'hui" : fmt(day, "EEEE")}</span>
              <span className="text-ink-3">{fmt(day, "d MMMM")}</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              {list.map((p, i) => {
                const m = media.find((x) => x.id === p.mediaId);
                const accs = accounts.filter((a) => p.accountIds.includes(a.id));
                return (
                  <button
                    key={p.id}
                    onClick={() => openComposer({ postId: p.id })}
                    className={cn("flex w-full items-center gap-4 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-2", i > 0 && "border-t border-line")}
                  >
                    <span className="tabular w-11 font-mono text-[12.5px] text-ink-2">{fmt(p.scheduledAt, "HH:mm")}</span>
                    {m ? <MediaThumb media={m} showMeta={false} className="h-12 w-9 shrink-0 rounded-md" /> : <span className="h-12 w-9 shrink-0 rounded-md border border-dashed border-line-strong" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[13.5px]">
                        {p.format === "story" && <span className="shrink-0 rounded-[4px] bg-accent-soft px-1 text-[9.5px] leading-[14px] font-semibold tracking-wide text-accent uppercase">Story</span>}
{(p.mediaIds?.length ?? 0) > 1 && p.format !== "story" && <span className="tabular inline-flex shrink-0 items-center gap-0.5 rounded-[4px] bg-ink/[0.07] px-1 font-mono text-[9.5px] leading-[14px] font-semibold text-ink-2" title={`Carrousel de ${p.mediaIds!.length} médias`}><Images className="size-2.5" />{p.mediaIds!.length}</span>}
                        <span className="truncate">{p.caption || (p.format === "story" ? "Story" : "")}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                        <AvatarStack accounts={accs} size={16} />
                        {accs.map((a) => `@${a.handle}`).join(", ")}
                      </span>
                    </span>
                    <StatusPill status={p.status} inbox={waitsInTikTok(p)} />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
