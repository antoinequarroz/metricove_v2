"use client";

import { MediaHeader, ResourceTabs } from "../montage/parts";

/** Every Ressources page: the Médias header, the four tabs, the page's own buttons on the right. */
export function ResourceShell({ actions, intro, children }: { actions?: React.ReactNode; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <MediaHeader />
      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
        <div className="mx-auto w-full max-w-[1680px]">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <ResourceTabs />
            {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
          <p className="mb-5 max-w-3xl text-[12.5px] text-ink-3">{intro}</p>
          {children}
        </div>
      </div>
    </>
  );
}
