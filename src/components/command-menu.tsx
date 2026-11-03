"use client";

import { Command } from "cmdk";
import { CalendarDays, Clapperboard, Plus, Users, RotateCcw, LayoutGrid, Rows3, Columns3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { fmt } from "@/lib/utils";
import { STATUS_META } from "./ui";
import { cn } from "@/lib/utils";

export function CommandMenu() {
  const open = useStore((s) => s.commandOpen);
  const setOpen = useStore((s) => s.setCommandOpen);
  const posts = useStore((s) => s.posts);
  const openComposer = useStore((s) => s.openComposer);
  const setView = useStore((s) => s.setView);
  const load = useStore((s) => s.load);
  const router = useRouter();

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Recherche"
      overlayClassName="fixed inset-0 z-40 bg-[rgba(15,14,12,0.3)] backdrop-blur-[2px]"
      contentClassName="fixed top-[16vh] left-1/2 z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)]"
    >
      <Command.Input
        placeholder="Rechercher un post, une action…"
        className="h-12 w-full border-b border-line bg-transparent px-4 text-[14.5px] outline-none placeholder:text-ink-3"
      />
      <Command.List className="scroll-thin max-h-[380px] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
        <Command.Empty className="py-10 text-center text-[13px] text-ink-3">Aucun résultat.</Command.Empty>
        <Command.Group heading="Actions">
          <Item onSelect={() => run(() => openComposer())} icon={<Plus className="size-4" />} hint="N">
            Nouveau post
          </Item>
          <Item onSelect={() => run(() => { router.push("/calendar"); setView("month"); })} icon={<LayoutGrid className="size-4" />}>
            Vue mois
          </Item>
          <Item onSelect={() => run(() => { router.push("/calendar"); setView("week"); })} icon={<Columns3 className="size-4" />}>
            Vue semaine
          </Item>
          <Item onSelect={() => run(() => { router.push("/calendar"); setView("list"); })} icon={<Rows3 className="size-4" />}>
            Vue liste
          </Item>
          <Item onSelect={() => run(() => router.push("/videos"))} icon={<Clapperboard className="size-4" />}>
            Bibliothèque vidéo
          </Item>
          <Item onSelect={() => run(() => router.push("/accounts"))} icon={<Users className="size-4" />}>
            Comptes connectés
          </Item>
          <Item onSelect={() => run(() => { load().then(() => toast("Données actualisées"), (e: Error) => toast.error(e.message)); })} icon={<RotateCcw className="size-4" />}>
            Actualiser
          </Item>
        </Command.Group>
        <Command.Group heading="Posts">
          {[...posts]
            .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
            .map((p) => (
              <Item key={p.id} value={`${p.caption} ${p.id}`} onSelect={() => run(() => openComposer({ postId: p.id }))} icon={<CalendarDays className="size-4" />}>
                <span className="min-w-0 flex-1 truncate">{p.caption}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-3">
                  <span className={cn("size-1.5 rounded-full", STATUS_META[p.status].dot)} />
                  {fmt(p.scheduledAt, "d MMM")}
                </span>
              </Item>
            ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function Item({ children, icon, hint, onSelect, value }: { children: React.ReactNode; icon: React.ReactNode; hint?: string; onSelect: () => void; value?: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2 text-[13.5px] text-ink-2 data-[selected=true]:bg-ink/[0.05] data-[selected=true]:text-ink"
    >
      <span className="text-ink-3">{icon}</span>
      {children}
      {hint && <span className="ml-auto font-mono text-[11px] text-ink-3">{hint}</span>}
    </Command.Item>
  );
}
