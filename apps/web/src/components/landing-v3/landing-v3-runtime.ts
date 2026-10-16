import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { LANDING_V3_ICONS } from "./landing-v3-icons";

/*
 * Behaviour for Drive247 Landing v3, ported from Claude Design. Four scripts,
 * kept in the design's order and logic:
 *
 *   1. the page script in `Drive247 Landing v3.html` — one gesture parts the
 *      24/7 doors and reveals the site; scrolling back to the top closes them
 *   2. landing-v3.js   — reveals, in-page anchors, product showcase tabs,
 *                         the Trax chat, the How-it-works iframe
 *   3. landing-int.js  — the integrations fan, scrubbed by a pinned scroll
 *   4. landing-v3b.js  — testimonials carousel, pricing toggle, FAQ, CTA
 *
 * What changed is only what a React page needs: everything is torn down on
 * unmount (listeners, observers, loops, ScrollTriggers, Lenis, body classes),
 * the window globals the scripts shared (`__d247Lenis`, `__d247Release`, the
 * `d247:open` event) are plain closures, lucide's CDN createIcons() is a local
 * equivalent, and one design bug is fixed: the pricing toggle called
 * `.forEach` on a single element, so the "billed yearly" line never changed.
 */

type Cleanup = () => void;

export function mountLandingV3(root: HTMLElement): Cleanup {
  const B = document.body;
  const H = document.documentElement;
  const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = root) => r.querySelector(s) as T;
  const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = root) => Array.from(r.querySelectorAll<T>(s));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let alive = true;
  const disposers: Cleanup[] = [];
  const on = (
    target: EventTarget,
    type: string,
    fn: (e: never) => void,
    opts?: AddEventListenerOptions | boolean,
  ) => {
    target.addEventListener(type, fn as EventListener, opts);
    disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
  };
  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => alive && fn(), ms);
    disposers.push(() => clearTimeout(id));
  };
  const every = (fn: () => void, ms: number) => {
    const id = setInterval(fn, ms);
    disposers.push(() => clearInterval(id));
  };
  const frame = (fn: (now: number) => void) => {
    let id = 0;
    const loop = (n: number) => {
      if (!alive) return;
      id = requestAnimationFrame(loop);
      fn(n);
    };
    id = requestAnimationFrame(loop);
    disposers.push(() => cancelAnimationFrame(id));
  };
  const observe = (cb: IntersectionObserverCallback, opts: IntersectionObserverInit) => {
    const o = new IntersectionObserver(cb, opts);
    disposers.push(() => o.disconnect());
    return o;
  };
  const resizeObs = (cb: ResizeObserverCallback) => {
    const o = new ResizeObserver(cb);
    disposers.push(() => o.disconnect());
    return o;
  };
  const sleep = (ms: number) => new Promise<void>((r) => later(r, ms));

  /* lucide.createIcons(), for markup the scripts insert at runtime */
  const createIcons = (scope: ParentNode = root) => {
    scope.querySelectorAll("i[data-lucide]").forEach((el) => {
      const n = el.getAttribute("data-lucide") || "";
      const body = LANDING_V3_ICONS[n];
      if (!body) return;
      const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const base: Record<string, string> = {
        xmlns: "http://www.w3.org/2000/svg",
        width: "24",
        height: "24",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      };
      for (const k in base) s.setAttribute(k, base[k]);
      for (const a of Array.from(el.attributes)) if (a.name !== "class") s.setAttribute(a.name, a.value);
      s.setAttribute("class", `lucide lucide-${n} ${el.getAttribute("class") || ""}`.trim());
      s.innerHTML = body;
      el.replaceWith(s);
    });
  };

  H.classList.add("d3p");
  disposers.push(() => H.classList.remove("d3p"));
  gsap.registerPlugin(ScrollTrigger);

  /* Lenis — the design's smooth scroll */
  const lenis = reduce ? null : new Lenis({ lerp: 0.085, smoothWheel: true });
  const lenisTick = (t: number) => lenis?.raf(t * 1000);
  if (lenis) {
    gsap.ticker.add(lenisTick);
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
    disposers.push(() => {
      gsap.ticker.remove(lenisTick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
    });
  }
  const scrollPos = () => (lenis ? lenis.scroll : scrollY);
  const openListeners: Array<() => void> = [];

  const ctx = gsap.context(() => {
    /* ================= 1 · page script: the 24/7 doors ================= */
    const hero = $("#hero");
    const car = $("#car");
    const after = $("#after");
    const sh = $("#sheen");
    B.classList.add("sealed");
    disposers.push(() => B.classList.remove("sealed", "open"));
    scrollTo(0, 0);
    gsap.set(car, { xPercent: -50 });
    const carDY = () => innerHeight * 0.5 - (car.offsetTop + car.offsetHeight * 0.5);
    const tl = gsap.timeline({
      paused: true,
      defaults: { overwrite: "auto" },
      onUpdate() {
        const t = this.time();
        B.classList.toggle("open", t > 0.55);
        hero.classList.toggle("gone", this.progress() >= 1);
      },
    });
    tl.to("#copy h1", { opacity: 0, y: -30, duration: 0.45, ease: "power2.in" }, 0)
      .to("#copy p", { opacity: 0, y: -18, duration: 0.4, ease: "power2.in" }, 0.03)
      .to("#copy .ctas", { opacity: 0, y: -10, duration: 0.35, ease: "power2.in" }, 0.06)
      .to(["#cone", "#pool"], { opacity: 0, duration: 0.4 }, 0)
      .add(() => {
        sh.classList.remove("go");
        void sh.offsetWidth;
        sh.classList.add("go");
      }, 0.05)
      .to("#doorL", { xPercent: -101, duration: 1.35, ease: "power3.inOut" }, 0.12)
      .to("#doorR", { xPercent: 101, duration: 1.35, ease: "power3.inOut" }, 0.12)
      .to(car, { y: () => carDY() * 0.35, scale: 1.35, opacity: 0, filter: "blur(10px)", duration: 1.15, ease: "power2.in" }, 0.2)
      .to([".vig", ".grain"], { opacity: 0, duration: 0.6 }, 0.35)
      .to("#stage", { opacity: 0, duration: 0.7, ease: "power1.out" }, 0.7)
      .fromTo(
        after,
        { scale: 0.94, y: 60, opacity: 0.35, filter: "blur(6px)" },
        { scale: 1, y: 0, opacity: 1, filter: "blur(0px)", duration: 1.25, ease: "power3.out", clearProps: "transform,filter" },
        0.45,
      );
    let isOpen = false;
    let busy = false;
    const fireOpen = () => openListeners.forEach((fn) => fn());
    const open = (fast?: boolean) => {
      if (isOpen) return;
      isOpen = true;
      busy = true;
      const done = () => {
        busy = false;
        B.classList.remove("sealed");
        lenis?.start();
      };
      if (reduce || fast) {
        tl.progress(1);
        done();
        fireOpen();
        return;
      }
      tl.timeScale(1).play();
      fireOpen();
      const dc = gsap.delayedCall(1.05, () => {
        B.classList.remove("sealed");
        lenis?.start();
      });
      disposers.push(() => dc.kill());
      tl.eventCallback("onComplete", () => {
        busy = false;
      });
    };
    const close = () => {
      if (!isOpen || busy) return;
      isOpen = false;
      busy = true;
      B.classList.add("sealed");
      lenis?.stop();
      scrollTo(0, 0);
      hero.classList.remove("gone");
      tl.timeScale(1.4).reverse();
      tl.eventCallback("onReverseComplete", () => {
        busy = false;
      });
    };
    const atTop = () => scrollPos() <= 2;
    let lw = 0;
    on(
      window,
      "wheel",
      (e: WheelEvent) => {
        const now = performance.now();
        if (!isOpen) {
          e.preventDefault();
          if (e.deltaY > 4 && now - lw > 120) open();
          lw = now;
          return;
        }
        if (busy) {
          e.preventDefault();
          return;
        }
        if (atTop() && e.deltaY < -4 && now - lw > 400) {
          e.preventDefault();
          close();
        }
        lw = now;
      },
      { passive: false },
    );
    let ty: number | null = null;
    on(window, "touchstart", (e: TouchEvent) => {
      ty = e.touches[0].clientY;
    }, { passive: true });
    on(window, "touchmove", (e: TouchEvent) => {
      if (!isOpen || busy) e.preventDefault();
    }, { passive: false });
    on(window, "touchend", (e: TouchEvent) => {
      if (ty == null) return;
      const dy = ty - e.changedTouches[0].clientY;
      ty = null;
      if (Math.abs(dy) < 30) return;
      if (!isOpen && dy > 0) open();
      else if (isOpen && atTop() && dy < 0) close();
    });
    on(window, "keydown", (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
      if (!isOpen && ["ArrowDown", "PageDown", " ", "Enter"].includes(e.key) && t === B) {
        e.preventDefault();
        open();
      } else if (isOpen && atTop() && ["ArrowUp", "PageUp"].includes(e.key)) {
        e.preventDefault();
        close();
      }
    });
    on($("#tour"), "click", () => open());
    const release = () => {
      if (!isOpen) open(true);
    };

    /* page progress */
    const pg = $("#prog");
    const prog = () => {
      const m = document.documentElement.scrollHeight - innerHeight;
      pg.style.transform = `scaleX(${m > 0 ? scrollPos() / m : 0})`;
    };
    if (lenis) lenis.on("scroll", prog);
    else on(window, "scroll", prog, { passive: true });

    /* ================= 2 · landing-v3.js ================= */
    const seen = (el: Element, fn: (v: boolean) => void, margin = "0px 0px -12% 0px") =>
      observe((es) => es.forEach((e) => fn(e.isIntersecting)), { rootMargin: margin }).observe(el);

    /* reveal */
    const ro = observe(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            ro.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -8% 0px" },
    );
    $$(".after .x-rv").forEach((el) => ro.observe(el));

    /* in-page anchors (work with Lenis or native) */
    on(document, "click", (e: MouseEvent) => {
      const a = (e.target as Element).closest?.('a[href^="#x-"]');
      if (!a) return;
      const t = $(a.getAttribute("href") || "");
      if (!t) return;
      e.preventDefault();
      release();
      later(() => {
        if (lenis) lenis.scrollTo(t, { offset: -20, duration: 1.4 });
        else scrollTo({ top: t.getBoundingClientRect().top + scrollY - 20, behavior: "smooth" });
      }, 60);
    });

    /* 01 showcase */
    {
      const tabs = $$(".x-tab");
      const panes = $$(".x-pane");
      const ttl = $("#x-sttl");
      const D = 1500;
      let i = 0;
      let t0 = 0;
      let vis = false;
      let hover = false;
      const set = (k: number) => {
        i = k;
        tabs.forEach((t, j) => t.classList.toggle("on", j === k));
        panes.forEach((p, j) => {
          p.classList.remove("on");
          if (j === k) {
            void p.offsetWidth;
            p.classList.add("on");
          }
        });
        ttl.textContent = tabs[k].dataset.t || "";
        t0 = performance.now();
      };
      tabs.forEach((t, k) => on(t, "click", () => set(k)));
      on($(".x-sg"), "mouseenter", () => {
        hover = true;
      });
      on($(".x-sg"), "mouseleave", () => {
        hover = false;
        t0 = performance.now() - (+($(".x-tab.on .bar i").dataset.p || 0) || 0) * D;
      });
      frame((now) => {
        if (!vis || reduce) return;
        const bar = $(".x-tab.on .bar i");
        if (hover) return;
        const p = Math.min(1, (now - t0) / D);
        bar.style.transform = `scaleX(${p})`;
        bar.dataset.p = String(p);
        if (p >= 1) {
          bar.style.transform = "scaleX(0)";
          set((i + 1) % tabs.length);
        }
      });
      seen($("#x-showcase"), (v) => {
        if (v && !vis) {
          t0 = performance.now();
          set(i);
        }
        vis = v;
      });
    }

    /* 03 Trax chat */
    {
      const asks = $$(".x-ask");
      const msgs = $(".x-msgs");
      const ph = $(".x-in .ph");
      let i = 0;
      let run = 0;
      let vis = false;
      disposers.push(() => {
        run++;
      });
      const ANS = [
        {
          a: "<strong>3 customers owe you $1,840.</strong> Jonas Weber is the oldest — 4 days overdue on the BMW X5.",
          r: `<div class="r"><span class="x-av" style="background:#e5484d">J</span><b>Jonas Weber</b><em>$1,210.00 <small style="color:var(--late)">4d late</small></em></div><div class="r"><span class="x-av" style="background:#12a594">P</span><b>Priya Shah</b><em>$389.00 <small style="color:var(--wait)">Due today</small></em></div><div class="r"><span class="x-av" style="background:#0090ff">D</span><b>Daniel Reyes</b><em>$241.00 <small style="color:var(--soft)">Due Fri</small></em></div><div class="act"><span>Send reminders</span><span>Open payments</span></div>`,
        },
        {
          a: "<strong>2 of your 8 cars are free on Friday 17 Oct.</strong> Want me to hold one for Maya’s request?",
          r: `<div class="r"><span class="ci" style="background-image:url(/landing-v3/car2.webp)"></span><b>Mercedes E-Class</b><em>$149 <small style="color:var(--soft)">/ day</small></em></div><div class="r"><span class="ci" style="background-image:url(/landing-v3/car4.webp)"></span><b>BMW 3 Series</b><em>$119 <small style="color:var(--soft)">/ day</small></em></div><div class="act"><span>Hold for Maya</span><span>See calendar</span></div>`,
        },
        {
          a: "<strong>October is up 18%</strong> — $12,480 collected against $10,570 in September. Weekend rentals drove most of it.",
          r: `<div class="cmp"><div><b>$10,570</b><i style="height:62%"></i>September</div><div><b>$12,480</b><i style="height:84%"></i>October</div></div><div class="act"><span>Open insights</span></div>`,
        },
      ];
      const go = async (k: number): Promise<void> => {
        const me = ++run;
        i = k;
        asks.forEach((a, j) => a.classList.toggle("on", j === k));
        const q = asks[k].dataset.q || "";
        ph.classList.remove("e");
        for (let c = 1; c <= q.length; c++) {
          if (me !== run) return;
          ph.innerHTML = `${q.slice(0, c)}<span class="cr"></span>`;
          await sleep(reduce ? 0 : 34);
        }
        await sleep(380);
        if (me !== run) return;
        ph.classList.add("e");
        ph.textContent = "Ask Trax anything…";
        msgs.innerHTML = "";
        msgs.insertAdjacentHTML("beforeend", `<div class="x-m u">${q}</div>`);
        await sleep(350);
        if (me !== run) return;
        msgs.insertAdjacentHTML(
          "beforeend",
          `<div class="x-m t"><span class="x-mark"><i data-lucide="sparkles"></i></span><div class="tx"><span class="x-typing"><i></i><i></i><i></i></span></div></div>`,
        );
        createIcons(msgs);
        await sleep(900);
        if (me !== run) return;
        const tx = $(".x-m.t:last-child .tx", msgs);
        const words = ANS[k].a.split(" ");
        tx.innerHTML = "";
        for (let w = 1; w <= words.length; w++) {
          if (me !== run) return;
          tx.innerHTML = words.slice(0, w).join(" ");
          await sleep(reduce ? 0 : 42);
        }
        await sleep(200);
        if (me !== run) return;
        tx.insertAdjacentHTML("beforeend", `<div class="x-res">${ANS[k].r}</div>`);
        await sleep(5200);
        if (me !== run || !vis) return;
        void go((k + 1) % asks.length);
      };
      asks.forEach((a, k) => on(a, "click", () => void go(k)));
      seen($("#x-trax"), (v) => {
        const was = vis;
        vis = v;
        if (v && !was) void go(i);
        if (!v) run++;
      });
    }

    /* 04 how it works iframe — fit height + visibility */
    {
      const f = $<HTMLIFrameElement>("#hiw");
      if (f) {
        const fit = () => {
          try {
            const d = f.contentDocument;
            if (!d) return;
            const s = d.getElementById("hw");
            const Hh = s ? s.offsetHeight : d.documentElement.scrollHeight;
            if (Hh && Math.abs(f.offsetHeight - Hh) > 1) f.style.height = `${Hh}px`;
          } catch {
            /* cross-origin — leave the height alone */
          }
        };
        const onLoad = () => {
          fit();
          try {
            const w = f.contentWindow as Window;
            const fw = (e: WheelEvent) => {
              e.preventDefault();
              window.dispatchEvent(
                new WheelEvent("wheel", { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, bubbles: true, cancelable: true }),
              );
            };
            w.addEventListener("wheel", fw, { passive: false });
            w.document.documentElement.style.overflow = "hidden";
          } catch {
            /* ignore */
          }
          try {
            resizeObs(fit).observe((f.contentDocument as Document).body);
          } catch {
            /* ignore */
          }
          later(fit, 800);
        };
        on(f, "load", onLoad);
        // The iframe may have finished loading before this effect ran.
        if (f.contentDocument?.readyState === "complete" && f.contentDocument.getElementById("hw")) onLoad();
        on(window, "resize", fit);
        const chk = () => {
          const r = f.getBoundingClientRect();
          const v = r.top < innerHeight * 0.85 && r.bottom > innerHeight * 0.15;
          try {
            (f.contentWindow as Window & { HIW?: { setVisible(v: boolean): void } }).HIW?.setVisible(v);
          } catch {
            /* ignore */
          }
        };
        on(window, "scroll", chk, { passive: true });
        every(chk, 500);
      }
    }

    /* ================= 3 · landing-int.js — integrations fan ================= */
    {
      const sec = $("#x-integrations");
      const stage = $("#iStage");
      const svg = $<SVGSVGElement>("#iSvg");
      const core = $("#iCore");
      const tiles = $$(".i-tile", stage);
      const N = 16;
      let paths: { l: SVGPathElement[]; r: SVGPathElement[] } = { l: [], r: [] };
      const P = { v: 0 };
      /*
       * Resting spot per tile, as [x, y] fractions of the stage, by k % 4.
       * The design's second slot was [.30, .16]: WhatsApp and the lockbox sat
       * above every line there (the fan only reaches that high near the
       * edges). It now rests at x .10, out where the lines are, and every tile's
       * y is snapped onto the nearest line at its x (see `snapRest`), so all
       * eight sit on a line at any stage size.
       */
      const POS = [[0.17, 0.4], [0.1, 0.14], [0.08, 0.86], [0.33, 0.63]];
      const restX = (t: HTMLElement, k: number) => {
        const W = stage.offsetWidth;
        const hw = (t.offsetWidth || 80) / 2 + 28;
        let rx = Math.max(hw, POS[k % 4][0] * W);
        if (t.dataset.side !== "l") rx = W - rx;
        return rx;
      };
      /* y where a fan line crosses x — each line runs monotonically outward from the hub */
      const yOnLine = (p: SVGPathElement, x: number) => {
        const len = p.getTotalLength();
        const start = p.getPointAtLength(0).x;
        const end = p.getPointAtLength(len).x;
        if ((x - start) * (x - end) > 0) return null;
        let lo = 0;
        let hi = len;
        for (let n = 0; n < 24; n++) {
          const mid = (lo + hi) / 2;
          const px = p.getPointAtLength(mid).x;
          if ((px - start) * (x - start) >= 0 && Math.abs(px - start) < Math.abs(x - start)) lo = mid;
          else hi = mid;
        }
        return p.getPointAtLength((lo + hi) / 2).y;
      };
      const snapRest = () => {
        const Hs = stage.offsetHeight;
        tiles.forEach((t, k) => {
          const rx = restX(t, k);
          const want = POS[k % 4][1] * Hs;
          const hh = (t.offsetHeight || 60) / 2 + 12;
          let best: number | null = null;
          for (const p of paths[t.dataset.side as "l" | "r"]) {
            const y = yOnLine(p, rx);
            if (y == null || y < hh || y > Hs - hh) continue;
            if (best == null || Math.abs(y - want) < Math.abs(best - want)) best = y;
          }
          t.dataset.ry = best == null ? String(want) : best.toFixed(1);
        });
      };
      const apply = (v: number) => {
        $$<SVGPathElement>(".ln", svg).forEach((p) => {
          p.style.strokeDashoffset = "0";
        });
        core.style.transform = "";
        core.style.opacity = "1";
        core.classList.toggle("hit", v > 0.92);
        tiles.forEach((t, k) => {
          const s = (k % 4) * 0.09;
          const q = Math.min(1, Math.max(0, (v - s) / 0.62));
          const e = q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;
          const Wd = stage.offsetWidth;
          const Hd = stage.offsetHeight;
          const tw = t.offsetWidth || 80;
          const hw = tw / 2 + 28;
          const dir = t.dataset.side === "l" ? -1 : 1;
          const rx = restX(t, k);
          const ry = t.dataset.ry ? +t.dataset.ry : POS[k % 4][1] * Hd;
          const edge = dir < 0 ? hw : Wd - hw;
          const sx = rx + (edge - rx) * 1;
          const x = sx + (rx - sx) * e;
          const sc = (0.85 + 0.15 * e).toFixed(3);
          const rt = ((1 - e) * (dir < 0 ? -10 : 10)).toFixed(1);
          t.style.transform = `translate(${x.toFixed(1)}px,${ry.toFixed(1)}px) translate(-50%,-50%) rotate(${rt}deg) scale(${sc})`;
          t.style.opacity = String(Math.min(1, q * 2.2));
          t.style.scale = "";
          t.style.rotate = "";
        });
        sec.classList.toggle("i-live", v > 0.85);
      };
      const build = () => {
        const W = stage.offsetWidth;
        const Hs = stage.offsetHeight;
        const cx = W / 2;
        const cy = Hs * 0.76;
        core.style.setProperty("--cy", `${cy}px`);
        core.style.left = `${cx}px`;
        svg.setAttribute("viewBox", `0 0 ${W} ${Hs}`);
        const d = `<defs><linearGradient id="iGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="0"><stop offset="0" stop-color="#8f85ff" stop-opacity="0"/><stop offset=".22" stop-color="#8f85ff" stop-opacity=".55"/><stop offset=".5" stop-color="#442DD7" stop-opacity=".9"/><stop offset=".78" stop-color="#8f85ff" stop-opacity=".55"/><stop offset="1" stop-color="#8f85ff" stop-opacity="0"/></linearGradient></defs>`;
        const mk = (side: string, i: number) => {
          const k = i / (N - 1);
          const ey = -Hs * 0.15 + k * Hs * 1.25;
          const ex = side === "l" ? -40 : W + 40;
          const dir = side === "l" ? -1 : 1;
          const c1x = cx + dir * W * 0.16;
          const c1y = cy;
          const c2x = cx + dir * W * 0.34;
          const c2y = ey + (cy - ey) * 0.08;
          return `M${cx},${cy} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${ex},${ey.toFixed(1)}`;
        };
        let lines = "";
        ["l", "r"].forEach((s) => {
          for (let i = 0; i < N; i++) lines += `<path class="ln" data-s="${s}" data-i="${i}" d="${mk(s, i)}"/>`;
        });
        svg.innerHTML = d + lines;
        paths = { l: $$<SVGPathElement>('.ln[data-s="l"]', svg), r: $$<SVGPathElement>('.ln[data-s="r"]', svg) };
        $$<SVGPathElement>(".ln", svg).forEach((p) => {
          const len = p.getTotalLength();
          p.dataset.len = String(len);
          p.style.strokeDasharray = String(len);
          p.style.opacity = String(0.35 + 0.65 * (1 - Math.abs(+(p.dataset.i || 0) - (N - 1) / 2) / ((N - 1) / 2)));
        });
        snapRest();
        apply(P.v);
      };
      tiles.forEach((t) => {
        const hl = (onState: boolean) => {
          const p = paths[t.dataset.side as "l" | "r"][+(t.dataset.line || 0)];
          p?.classList.toggle("hot", onState);
        };
        on(t, "mouseenter", () => hl(true));
        on(t, "mouseleave", () => hl(false));
        on(t, "focus", () => hl(true));
        on(t, "blur", () => hl(false));
      });
      build();
      if (reduce) {
        P.v = 1;
        apply(1);
      } else {
        if (lenis) lenis.on("scroll", ScrollTrigger.update);
        /* pinned scrub — the section holds still while scrolling pulls every tile in from its edge to the hub */
        ScrollTrigger.create({
          trigger: sec,
          start: () => (sec.offsetHeight > innerHeight ? "bottom bottom" : "center center"),
          end: () => `+=${Math.round(innerHeight * 1.1)}`,
          pin: true,
          pinSpacing: true,
          scrub: 1.1,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (s) => {
            P.v = s.progress;
            apply(P.v);
          },
        });
        gsap.fromTo(".i-head", { y: 40 }, { y: -30, ease: "none", scrollTrigger: { trigger: sec, start: "top bottom", end: "bottom top", scrub: 1 } });
        openListeners.push(() => later(() => ScrollTrigger.refresh(), 1400));
      }
      let lastW = 0;
      let rz: ReturnType<typeof setTimeout> | undefined;
      disposers.push(() => clearTimeout(rz));
      const rebuild = () => {
        const w = stage.offsetWidth;
        if (!w || w === lastW) return;
        lastW = w;
        build();
      };
      resizeObs(() => {
        clearTimeout(rz);
        rz = setTimeout(rebuild, 60);
      }).observe(stage);
      const onRefresh = () => {
        lastW = 0;
        rebuild();
      };
      ScrollTrigger.addEventListener("refresh", onRefresh);
      disposers.push(() => ScrollTrigger.removeEventListener("refresh", onRefresh));
      openListeners.push(() =>
        later(() => {
          lastW = 0;
          rebuild();
        }, 1500),
      );
      on(window, "resize", () => {
        clearTimeout(rz);
        rz = setTimeout(() => {
          rebuild();
          ScrollTrigger.refresh();
        }, 150);
      });
    }

    /* ================= 4 · landing-v3b.js ================= */
    /* testimonials carousel — swipe, arrows, auto-advance while visible */
    {
      const view = $("#tcView");
      const track = $("#tcTrack");
      const cards = $$(".tc-card");
      const fill = $("#tcFill");
      const D = 1500 * 2.4;
      let i = 0;
      let vis = false;
      let hover = false;
      let t0 = performance.now();
      let last = t0;
      const per = () => (innerWidth < 860 ? 1 : 2);
      const max = () => cards.length - per();
      const go = (k: number) => {
        const m = max();
        i = k > m ? 0 : k < 0 ? m : k;
        const c = cards[0];
        const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
        track.style.transform = `translateX(${-i * (c.offsetWidth + gap)}px)`;
        cards.forEach((x, j) => x.classList.toggle("on", j >= i && j < i + per()));
        t0 = performance.now();
      };
      on($("#tcPrev"), "click", () => go(i - 1));
      on($("#tcNext"), "click", () => go(i + 1));
      on(view, "mouseenter", () => {
        hover = true;
      });
      on(view, "mouseleave", () => {
        hover = false;
      });
      let sx: number | null = null;
      on(view, "pointerdown", (e: PointerEvent) => {
        sx = e.clientX;
      });
      on(window, "pointerup", (e: PointerEvent) => {
        if (sx == null) return;
        const dx = e.clientX - sx;
        sx = null;
        if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
      });
      observe(
        (es) =>
          es.forEach((x) => {
            vis = x.isIntersecting;
            if (vis) t0 = performance.now();
          }),
        { threshold: 0.25 },
      ).observe(view);
      frame((n) => {
        const dt = n - last;
        last = n;
        if (!vis || reduce) return;
        if (hover) {
          t0 += dt;
          return;
        }
        const p = Math.min(1, (n - t0) / D);
        fill.style.transform = `scaleX(${p})`;
        if (p >= 1) go(i + 1);
      });
      on(window, "resize", () => go(Math.min(i, max())));
      go(0);
    }

    /* pricing toggle */
    {
      const tog = $("#pTog");
      const th = $(".th", tog);
      const bs = $$("button", tog);
      const place = (b: HTMLElement | undefined) => {
        if (!b) return;
        th.style.width = `${b.offsetWidth}px`;
        th.style.transform = `translateX(${b.offsetLeft}px)`;
      };
      const tween = (el: HTMLElement, to: number) => {
        const from = +(el.dataset.cur || to);
        el.dataset.cur = String(to);
        if (reduce || from === to) {
          el.textContent = String(to);
          return;
        }
        const s = performance.now();
        const st = (n: number) => {
          if (!alive) return;
          const q = Math.min(1, (n - s) / 550);
          const e = 1 - Math.pow(1 - q, 3);
          el.textContent = String(Math.round(from + (to - from) * e));
          if (q < 1) requestAnimationFrame(st);
        };
        requestAnimationFrame(st);
      };
      const set = (y: boolean) => {
        bs.forEach((b) => b.classList.toggle("on", b.dataset.y === (y ? "1" : "0")));
        place(bs.find((b) => b.classList.contains("on")));
        $$(".y-amt b").forEach((b) => tween(b, +((y ? b.dataset.y : b.dataset.m) || 0)));
        // design: `$('.y-bill').forEach` — a single element, so this line never updated
        $$(".y-bill").forEach((s) => {
          s.textContent = (y ? s.dataset.y : s.dataset.m) || "";
        });
      };
      bs.forEach((b) => on(b, "click", () => set(b.dataset.y === "1")));
      on(window, "resize", () => place(bs.find((b) => b.classList.contains("on"))));
      $$(".y-amt b").forEach((b) => {
        b.dataset.cur = b.dataset.y;
      });
      const on0 = bs.find((b) => b.classList.contains("on"));
      void document.fonts.ready.then(() => alive && place(on0));
      place(on0);
    }

    /* faq — single-open accordion */
    {
      const items = $$(".y-qa");
      items.forEach((q) =>
        on($("button", q), "click", () => {
          const isOn = q.classList.contains("on");
          items.forEach((x) => x.classList.remove("on"));
          if (!isOn) q.classList.add("on");
        }),
      );
    }

    /* CTA — gentle pointer parallax on the photo (user-initiated) */
    {
      const cb = $(".y-cb");
      const img = cb ? $(".bgimg", cb) : null;
      if (cb && img && !reduce) {
        on(cb, "pointermove", (e: PointerEvent) => {
          const r = cb.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5;
          const y = (e.clientY - r.top) / r.height - 0.5;
          img.style.transform = `scale(1.1) translate(${(-x * 18).toFixed(1)}px,${(-y * 12).toFixed(1)}px)`;
        });
        on(cb, "pointerleave", () => {
          img.style.transform = "";
        });
      }
    }

    /* reveal for any x-rv added here (in case the main reveal ran before) */
    {
      const io = observe(
        (es) =>
          es.forEach((x) => {
            if (x.isIntersecting) {
              x.target.classList.add("in");
              io.unobserve(x.target);
            }
          }),
        { rootMargin: "0px 0px -10% 0px" },
      );
      $$(".y-tst .x-rv,.y-pr .x-rv,.y-faq .x-rv,.y-cta .x-rv").forEach((el) => io.observe(el));
    }

    createIcons();
  }, root);

  return () => {
    alive = false;
    disposers.splice(0).reverse().forEach((fn) => {
      try {
        fn();
      } catch {
        /* keep tearing down */
      }
    });
    ctx.revert();
  };
}
