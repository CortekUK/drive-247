"use client";

import { useEffect, useRef } from "react";

/*
 * The footer's background: ink-in-water wisps in the brand's indigo, shown only under the
 * pointer (Ghulam, 2026-11-10: "only on hover, follow the mouse"). The footer is plain dark
 * until the pointer comes over it; then a soft pool of wisps trails the pointer and fades
 * out when it leaves. One small WebGL shader: noise folded through itself twice, with its
 * ridges drawn as thin threads over a soft glow.
 *
 * Kept cheap on purpose: drawn at half size (it is all soft edges), about 30 frames a second,
 * and only while something is showing.
 *
 * THE SPLASH. The landing page's line ends by dropping straight into the footer (Ghulam,
 * 2026-11-10: "like a bomb when it gets into the water"). When its tip gets there the page
 * line sends LINE_SPLASH_EVENT, and the water bursts open from that point for a few
 * seconds: a pool of wisps racing outwards with a shock ring on its edge, then fading.
 * With reduced motion the wisps hold still and only the
 * pool moves. On touch, or without WebGL, the footer keeps its plain dark ground.
 */

/** Sent on `window` by the page line when its tip drops into the footer: detail `{ clientX }`. */
export const LINE_SPLASH_EVENT = "drive247:line-splash";

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_radius;
uniform float u_on;
uniform vec2 u_splash;
uniform float u_splashR;
uniform float u_splashOn;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + vec2(17.3, 9.1); a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res.xy) / u_res.y * 1.1;
  float t = u_time * 0.045;

  /* A slow turn around the middle, so the wisps curl instead of drifting straight. */
  float r = length(p);
  float a = 1.1 * exp(-r * 1.4) + t * 0.6;
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;

  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3 - t)));
  vec2 w = vec2(fbm(p + 2.6 * q + vec2(1.7, 9.2) + t * 0.7), fbm(p + 2.6 * q + vec2(8.3, 2.8) - t * 0.5));
  float n = fbm(p + 2.8 * w);

  /* Most of the water stays dark: the wisps show only where a slow, wide patch lets them. */
  float patch = smoothstep(0.3, 0.55, fbm(p * 0.7 + vec2(3.1, -t * 0.8)));
  float thread = pow(1.0 - abs(2.0 * n - 1.0), 7.0);
  float haze = smoothstep(0.4, 0.85, n) * length(w) * 0.5;
  float glow = (thread * 0.8 + haze * 0.22) * (0.5 + 0.5 * patch);

  /* Only a soft pool around the pointer, fading to nothing at its edge. */
  float d = distance(gl_FragCoord.xy, u_mouse) / u_radius;
  float pool = 1.0 - smoothstep(0.0, 1.0, d);
  float show = pool * u_on;

  /*
   * The splash: where the page line drops into the footer. The water bursts open from that
   * point, a pool that grows fast and then slows, with a shock ring on its edge and a
   * second ripple behind it, and all of it dies away.
   */
  float sd = distance(gl_FragCoord.xy, u_splash);
  float burst = (1.0 - smoothstep(u_splashR * 0.25, u_splashR, sd)) * u_splashOn;
  float edge = u_splashR * 0.07 + 6.0;
  float ring = exp(-pow((sd - u_splashR) / edge, 2.0)) + 0.5 * exp(-pow((sd - u_splashR * 0.62) / edge, 2.0));
  ring *= u_splashOn;
  show = max(show, burst);
  glow *= max(pool * u_on, burst * 2.6);
  /* The flash at the point of impact, gone almost at once. */
  float flash = exp(-sd / (u_splashR * 0.16 + 8.0)) * pow(u_splashOn, 3.0);

  vec3 ground = vec3(0.043, 0.043, 0.055);
  vec3 accent = vec3(0.36, 0.33, 0.92);
  vec3 bright = vec3(0.66, 0.64, 0.98);
  vec3 col = ground + accent * glow * 1.15 + bright * pow(thread, 3.0) * show * 0.12 + accent * ring * 0.5 + bright * flash * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

export function FooterWater() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vert = compile(gl.VERTEX_SHADER, VERT);
    const frag = compile(gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vert || !frag || !program) return;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");

    const uMouse = gl.getUniformLocation(program, "u_mouse");
    const uRadius = gl.getUniformLocation(program, "u_radius");
    const uOn = gl.getUniformLocation(program, "u_on");
    const uSplash = gl.getUniformLocation(program, "u_splash");
    const uSplashR = gl.getUniformLocation(program, "u_splashR");
    const uSplashOn = gl.getUniformLocation(program, "u_splashOn");

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const host = canvas.parentElement;
    if (!host) return;
    const SCALE = 0.5; // half size: every edge in it is soft, and it costs a quarter of the pixels
    const RADIUS = 300; // of the pool, in CSS pixels
    const origin = performance.now() - 40_000;

    let frame = 0;
    let last = 0;
    let inside = false;
    let on = 0; // how much of the pool is showing, eased 0 to 1
    const target = { x: 0, y: 0 }; // where the pointer is, in canvas pixels from the bottom left
    const spot = { x: 0, y: 0 }; // where the pool is, trailing it
    /** The page line's drop into the water: where it hit, and when. */
    let splash: { x: number; y: number; at: number } | null = null;
    const SPLASH_MS = 4200;
    const SPLASH_RADIUS = 760; // how far the burst reaches, in CSS pixels

    const draw = (now: number) => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, still ? 40 : (now - origin) / 1000);
      gl.uniform2f(uMouse, spot.x, spot.y);
      gl.uniform1f(uRadius, RADIUS * SCALE);
      gl.uniform1f(uOn, on);
      const age = splash ? (now - splash.at) / SPLASH_MS : 1;
      if (splash && age < 1) {
        gl.uniform2f(uSplash, splash.x, splash.y);
        // Out fast, then slowing, as a shock does in water.
        gl.uniform1f(uSplashR, SPLASH_RADIUS * SCALE * (1 - Math.exp(-age * 5.5)) + 1);
        // Full at once, then a long fade.
        gl.uniform1f(uSplashOn, Math.min(1, age * 30) * Math.pow(1 - age, 1.15));
      } else {
        splash = null;
        gl.uniform1f(uSplashOn, 0);
        gl.uniform1f(uSplashR, 1);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < 32) return;
      last = now;
      // In over about 200ms, out a little slower, and the pool trails the pointer.
      on += ((inside ? 1 : 0) - on) * (inside ? 0.18 : 0.1);
      spot.x += (target.x - spot.x) * 0.14;
      spot.y += (target.y - spot.y) * 0.14;
      draw(now);
      if (!inside && on < 0.004 && !splash) {
        on = 0;
        draw(now);
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const wake = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(loop);
    };

    const place = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      target.x = (e.clientX - box.left) * SCALE;
      target.y = (box.bottom - e.clientY) * SCALE;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      place(e);
      if (!inside) {
        inside = true;
        // Arriving: the pool opens where the pointer is, rather than sliding in from where it last was.
        if (on < 0.02) {
          spot.x = target.x;
          spot.y = target.y;
        }
      }
      wake();
    };
    const leave = () => {
      inside = false;
      wake();
    };
    // The page line says when its tip drops into the footer, and where (see tour/page-line.tsx).
    const onSplash = (event: Event) => {
      if (still) return;
      const box = canvas.getBoundingClientRect();
      const clientX = (event as CustomEvent<{ clientX: number }>).detail?.clientX ?? box.left + box.width / 2;
      splash = { x: (clientX - box.left) * SCALE, y: canvas.height, at: performance.now() };
      wake();
    };
    addEventListener(LINE_SPLASH_EVENT, onSplash);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);

    const size = new ResizeObserver(() => {
      const w = Math.max(1, Math.round(canvas.clientWidth * SCALE));
      const h = Math.max(1, Math.round(canvas.clientHeight * SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      draw(performance.now());
    });
    size.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      removeEventListener(LINE_SPLASH_EVENT, onSplash);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, []);

  return <canvas ref={ref} className="ft-water" aria-hidden />;
}
