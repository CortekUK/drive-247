'use client';

/**
 * Dialogs as iOS bottom sheets on a phone (Sep 28 2026).
 *
 * `PHONE_SHEET` goes on a `DialogContent`'s className: below `md` it stops
 * being a centred card and becomes a sheet pinned to the bottom edge, full
 * width, rounded only at the top, padded for the home indicator, and never
 * taller than the screen. At `md` and up nothing changes.
 *
 * `SheetGrabber` is the handle at its top. It is also a real control: drag it
 * down and the sheet follows the finger; let go past the threshold and the
 * sheet closes, otherwise it springs back — the way every iOS sheet behaves.
 */

import { useRef } from 'react';

export const PHONE_SHEET =
  'max-md:inset-x-0 max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:max-h-[92svh] max-md:max-w-none ' +
  'max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:rounded-t-[26px] ' +
  'max-md:border-x-0 max-md:border-b-0 max-md:pb-[env(safe-area-inset-bottom,0px)] ' +
  'max-md:data-[state=open]:slide-in-from-bottom-1/2';

/** How far down the sheet must be dragged before letting go closes it. */
const CLOSE_AFTER_PX = 90;

export function SheetGrabber({ onClose }: { onClose: () => void }) {
  const start = useRef<number | null>(null);
  const sheet = useRef<HTMLElement | null>(null);

  const move = (y: number) => {
    if (start.current === null || !sheet.current) return;
    const dy = Math.max(0, y - start.current);
    sheet.current.style.transform = `translateY(${dy}px)`;
  };
  const end = (y: number) => {
    if (start.current === null || !sheet.current) return;
    const dy = y - start.current;
    const el = sheet.current;
    start.current = null;
    el.style.transition = 'transform 200ms ease-out';
    if (dy > CLOSE_AFTER_PX) {
      el.style.transform = 'translateY(100%)';
      window.setTimeout(onClose, 160);
    } else {
      el.style.transform = '';
    }
    window.setTimeout(() => {
      el.style.transition = '';
    }, 220);
  };

  return (
    <div
      className="flex touch-none justify-center pb-1 pt-2.5 md:hidden"
      onPointerDown={(e) => {
        sheet.current = (e.currentTarget.closest('[role="dialog"]') as HTMLElement) ?? null;
        start.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => move(e.clientY)}
      onPointerUp={(e) => end(e.clientY)}
      onPointerCancel={(e) => end(e.clientY)}
    >
      <span aria-hidden="true" className="h-[5px] w-9 rounded-full bg-black/15" />
    </div>
  );
}
