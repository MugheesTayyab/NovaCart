"use client";

import { useEffect, useRef } from "react";
import styles from "./HalftoneHands.module.css";

/*
 * Two reaching hands, drawn from a signed distance field.
 * Left: the customer, as an ink halftone. Right: the policy desk, as a blue
 * wireframe mesh. They meet at a receipt (real HTML, so it stays readable and
 * selectable). Colours come from the CSS tokens.
 */

type V = [number, number];

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

function capsule(px: number, py: number, a: V, b: V, r: number) {
  const pax = px - a[0];
  const pay = py - a[1];
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

function roundBox(px: number, py: number, cx: number, cy: number, hx: number, hy: number, r: number, rot: number) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const x = (px - cx) * c + (py - cy) * s;
  const y = -(px - cx) * s + (py - cy) * c;
  const qx = Math.abs(x) - hx + r;
  const qy = Math.abs(y) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// Finger chains in hand space: x points to the fingertip, y points down.
// A relaxed reaching hand seen from the back: index out, the rest curled under.
const FINGERS: [V[], number[]][] = [
  // index, reaching, the tip dropping a little
  [[[0.02, -0.12], [0.48, -0.17], [0.82, -0.17], [1.08, -0.13]], [0.105, 0.092, 0.08]],
  // middle, curled
  [[[0.05, 0.0], [0.45, 0.04], [0.62, 0.2], [0.55, 0.36]], [0.105, 0.095, 0.085]],
  // ring
  [[[0.0, 0.12], [0.36, 0.18], [0.48, 0.33], [0.38, 0.45]], [0.1, 0.09, 0.08]],
  // little
  [[[-0.08, 0.22], [0.2, 0.3], [0.27, 0.43], [0.18, 0.51]], [0.085, 0.075, 0.066]],
  // thumb, over the top of the palm
  [[[-0.55, -0.12], [-0.2, -0.3], [0.08, -0.34], [0.25, -0.3]], [0.12, 0.095, 0.08]],
];

/** Distance to the hand, plus whether the point sits on an inner contour (finger over palm). */
function handParts(px: number, py: number) {
  const arm = capsule(px, py, [-2.8, 0.35], [-0.95, 0.08], 0.3); // forearm and wrist
  const palm = roundBox(px, py, -0.42, 0.02, 0.5, 0.28, 0.22, -0.08);
  // One distance per finger, so joints inside a finger never draw a contour.
  const fingers = FINGERS.map(([pts, radii]) => {
    let f = Infinity;
    for (let i = 0; i < radii.length; i++) f = Math.min(f, capsule(px, py, pts[i], pts[i + 1], radii[i]));
    return f;
  });
  let d = smin(arm, palm, 0.25);
  for (const f of fingers) d = smin(d, f, 0.035);
  // An inner contour is a finger's outline where it lies over the palm or another finger.
  let crease = false;
  if (d < -0.02)
    fingers.forEach((f, i) => {
      if (Math.abs(f) < 0.012 && (palm < 0 || fingers.some((g, j) => j !== i && g < 0))) crease = true;
    });
  return { d, crease };
}

function hand(px: number, py: number) {
  return handParts(px, py).d;
}

/** Height 0..1 inside the shape, used for shading and the mesh displacement. */
function height(px: number, py: number) {
  const d = hand(px, py);
  const t = clamp(-d / 0.16, 0, 1);
  return Math.sqrt(1 - (1 - t) * (1 - t));
}

function token(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

type Layout = { w: number; h: number; scale: number; tipL: V; tipR: V };

function computeLayout(w: number, h: number, card: number): Layout {
  const scale = clamp(w * 0.13, 90, 190);
  const gap = card / 2 + 54;
  return { w, h, scale, tipL: [w / 2 - gap, h * 0.56], tipR: [w / 2 + gap, h * 0.44] };
}

/** Customer hand: halftone dots, larger where the surface turns away from the light. */
function drawHalftone(ctx: CanvasRenderingContext2D, L: Layout, ink: string) {
  const { scale, tipL } = L;
  const ox = tipL[0] - 1.16 * scale;
  const oy = tipL[1] + 0.13 * scale;
  const step = 5;
  const light = [-0.3, -0.45, 0.84];
  ctx.fillStyle = ink;
  for (let y = step / 2; y < L.h; y += step) {
    for (let x = step / 2; x < tipL[0] + 8; x += step) {
      const px = (x - ox) / scale;
      const py = (y - oy) / scale;
      const { d, crease } = handParts(px, py);
      if (d > 0.004) continue;
      const e = 0.012;
      const hx = (height(px + e, py) - height(px - e, py)) / (2 * e);
      const hy = (height(px, py + e) - height(px, py - e)) / (2 * e);
      const k = 0.14;
      const nl = Math.hypot(hx * k, hy * k, 1);
      const lambert = Math.max(0, (-hx * k * light[0] - hy * k * light[1] + light[2]) / nl);
      let tone = Math.pow(clamp(1 - lambert, 0, 1), 0.8); // 0 = lit, 1 = shadow
      if (crease) tone = Math.max(tone, 0.85);
      const edge = clamp(1 + d / 0.025, 0, 1); // firm outline at the silhouette
      const r = (step / 2) * clamp(0.16 + tone * 1.05 + edge * 0.5, 0.14, 0.95);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Desk hand: a mesh of lines lifted by the surface height, mirrored to reach left. */
function drawMesh(ctx: CanvasRenderingContext2D, L: Layout, accent: string) {
  const { scale, tipR } = L;
  const ox = tipR[0] + 1.16 * scale;
  const oy = tipR[1] + 0.13 * scale;
  const toLocal = (x: number, y: number): V => [(ox - x) / scale, (y - oy) / scale];
  const gap = 8;
  const fine = 2;
  ctx.strokeStyle = accent;

  const stroke = (pts: (V | null)[]) => {
    ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      if (!p) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
      pen = true;
    }
    ctx.stroke();
  };

  ctx.lineWidth = 0.7;
  ctx.globalAlpha = 0.75;
  for (let y = 0; y < L.h + 20; y += gap) {
    const pts: (V | null)[] = [];
    for (let x = tipR[0] - 8; x < L.w; x += fine) {
      const [px, py] = toLocal(x, y);
      pts.push(hand(px, py) > 0 ? null : [x, y - height(px, py) * 5]);
    }
    stroke(pts);
  }
  ctx.globalAlpha = 0.4;
  for (let x = tipR[0] - 8; x < L.w; x += gap) {
    const pts: (V | null)[] = [];
    for (let y = 0; y < L.h + 20; y += fine) {
      const [px, py] = toLocal(x, y);
      pts.push(hand(px, py) > 0 ? null : [x, y - height(px, py) * 5]);
    }
    stroke(pts);
  }

  // Silhouette and inner contours, so the hand reads as a hand and not a patch of grid.
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  for (let y = 0; y < L.h; y += 1.5) {
    for (let x = tipR[0] - 8; x < L.w; x += 1.5) {
      const [px, py] = toLocal(x, y);
      const { d, crease } = handParts(px, py);
      if (Math.abs(d) < 0.007 || crease) ctx.fillRect(x - 0.6, y - 0.6 - (d < 0 ? height(px, py) * 5 : 0), 1.2, 1.2);
    }
  }
}

function drawGuides(ctx: CanvasRenderingContext2D, L: Layout, line: string, ink: string, signal: string, card: number) {
  const cx = L.w / 2;
  const cy = L.h / 2;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  for (const r of [card * 0.62, card * 0.95, card * 1.3]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Connectors from each fingertip to the receipt edge.
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.75;
  const edgeL = cx - card / 2;
  const edgeR = cx + card / 2;
  ctx.beginPath();
  ctx.moveTo(L.tipL[0] + 10, L.tipL[1]);
  ctx.lineTo(edgeL, L.tipL[1]);
  ctx.moveTo(L.tipR[0] - 10, L.tipR[1]);
  ctx.lineTo(edgeR, L.tipR[1]);
  ctx.stroke();
  ctx.fillStyle = ink;
  for (const [x, y] of [
    [edgeL, L.tipL[1]],
    [edgeR, L.tipR[1]],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // The point of contact on the desk side.
  ctx.fillStyle = signal;
  ctx.beginPath();
  ctx.arc(L.tipR[0] - 10, L.tipR[1], 4, 0, Math.PI * 2);
  ctx.fill();
}

export function HalftoneHands({ children, cardWidth = 260 }: { children: React.ReactNode; cardWidth?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    const render = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      const L = computeLayout(w, h, cardWidth);

      // Draw each hand once to its own layer, then slide the layers in.
      const layer = () => {
        const c = document.createElement("canvas");
        c.width = cv.width;
        c.height = cv.height;
        const x = c.getContext("2d")!;
        x.scale(dpr, dpr);
        return { c, x };
      };
      const left = layer();
      const right = layer();
      const guides = layer();
      drawHalftone(left.x, L, token("--ink"));
      drawMesh(right.x, L, token("--accent"));
      drawGuides(guides.x, L, token("--line"), token("--ink-2"), token("--signal"), cardWidth);

      const ctx = cv.getContext("2d")!;
      const start = performance.now();
      const dur = reduce ? 0 : 1100;
      cancelAnimationFrame(frame);
      const tick = (now: number) => {
        const t = dur ? clamp((now - start) / dur, 0, 1) : 1;
        const e = 1 - Math.pow(1 - t, 3);
        const off = (1 - e) * 36 * dpr;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.globalAlpha = e;
        ctx.drawImage(guides.c, 0, 0);
        ctx.globalAlpha = 1;
        ctx.drawImage(left.c, -off, 0);
        ctx.drawImage(right.c, off, 0);
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    render();
    let timer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(render, 120);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [cardWidth]);

  return (
    <div ref={wrap} className={styles.wrap}>
      <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
      <div className={styles.card} style={{ width: cardWidth }}>
        {children}
      </div>
    </div>
  );
}
