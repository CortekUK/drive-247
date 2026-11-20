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

import { useEffect, useRef } from 'react';

export const PHONE_SHEET =
  'max-md:inset-x-0 max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:max-h-[92svh] max-md:max-w-none ' +
  'max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:rounded-t-[26px] ' +
  'max-md:border-x-0 max-md:border-b-0 max-md:pb-[env(safe-area-inset-bottom,0px)] ' +
  /* Motion (Nov 20 2026): the desktop dialog motion assumes a box centred
     with translate(-50%,-50%), so on a phone it drifted the sheet in from the
     side and sent it away diagonally to the top-left. A sheet moves on one
     axis only: up from below the screen on open (300ms, the iOS sheet curve),
     straight back down on close (200ms, quicker, accelerating). It stays
     opaque; the dimmed backdrop does the fading. */
  'max-md:data-[state=open]:slide-in-from-left-0 max-md:data-[state=open]:slide-in-from-bottom-full ' +
  'max-md:data-[state=open]:fade-in-100 max-md:data-[state=open]:duration-300 ' +
  'max-md:data-[state=open]:ease-[cubic-bezier(0.32,0.72,0,1)] ' +
  'max-md:data-[state=closed]:slide-out-to-left-0 max-md:data-[state=closed]:slide-out-to-bottom-full ' +
  'max-md:data-[state=closed]:fade-out-100 max-md:data-[state=closed]:duration-200 ' +
  'max-md:data-[state=closed]:ease-[cubic-bezier(0.4,0,1,1)] ' +
  /* The corner close: a bare 16px ✕ is hard to see and to hit on a phone.
     A 36px round button on a soft fill, level with the sheet's title. */
  'max-md:[&>button.absolute]:right-4 max-md:[&>button.absolute]:top-[1.7rem] max-md:[&>button.absolute]:flex ' +
  'max-md:[&>button.absolute]:size-9 max-md:[&>button.absolute]:items-center max-md:[&>button.absolute]:justify-center ' +
  'max-md:[&>button.absolute]:rounded-full max-md:[&>button.absolute]:bg-[var(--pv-wash,hsl(var(--muted)))] ' +
  'max-md:[&>button.absolute]:text-[var(--pv-ink-2,hsl(var(--foreground)))] max-md:[&>button.absolute]:opacity-100 ' +
  'max-md:[&>button.absolute]:z-10';

/** How far down the sheet must be dragged before letting go closes it. */
const CLOSE_AFTER_PX = 90;

export function SheetGrabber({ onClose }: { onClose: () => void }) {
  const start = useRef<number | null>(null);
  const sheet = useRef<HTMLElement | null>(null);
  const handle = useRef<HTMLDivElement | null>(null);

  /* The phone keyboard covers the bottom of the screen without moving
     anything pinned there (Android Chrome only shrinks the visual viewport),
     so a sheet with a text box would sit under the keyboard and you could not
     see what you type. Pad the sheet's bottom by the keyboard's height while
     it is up, so its content sits above the keyboard. */
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const el = handle.current?.closest('[role="dialog"]') as HTMLElement | null;
    if (!vv || !el) return;
    const fit = () => {
      const phone = window.innerWidth < 768;
      const keyboard = phone ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      /* Pad, don't lift: the sheet stays on the bottom edge and its own
         background runs down behind the keyboard. Lifting it by the reported
         keyboard height left a strip of page showing on keyboards that report
         a little more than they cover. */
      el.style.paddingBottom = keyboard > 40 ? `${keyboard}px` : '';
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      el.style.paddingBottom = '';
    };
  }, []);

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
      ref={handle}
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
