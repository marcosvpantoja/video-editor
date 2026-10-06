// Componentes animados desenhados no canvas a partir do que foi dito: números que contam,
// barras que crescem, listas, comparações, passos e palavras-chave. `dt` = segundos desde a entrada.
// Visual de "relatório" (referência Rafael Censon): papel claro, tinta escura, barras azul-marinho,
// marca-texto amarelo nos títulos e setas amarelas desenhadas à mão apontando o dado principal.
import { ease, type Graphic } from "./edit-plan";

const BG = "#f4f1ea";
const FG = "#15171c";
const MUTED = "rgba(21, 23, 28, 0.55)";
const LINE = "rgba(21, 23, 28, 0.15)";
const NAVY = "#1f2b7b";
export const ACCENT = "#ffc928";
const ACCENT_INK = "#c99400"; // amarelo legível sobre o papel
const MARKER = "rgba(255, 201, 40, 0.85)";
const DISPLAY = (px: number, weight = 700) => `${weight} ${px}px "Bricolage Grotesque", Inter, sans-serif`;
const BODY = (px: number, weight = 600) => `${weight} ${px}px Inter, sans-serif`;
const MONO = (px: number) => `500 ${px}px "JetBrains Mono", ui-monospace, monospace`;

/** Entrada de cada parte com atraso: 0 → 1 em `dur` segundos a partir de `delay`. */
const enter = (dt: number, delay = 0, dur = 0.5) => ease((dt - delay) / dur);
/** Mesma coisa com mola (passa um pouco do alvo e assenta). */
const bounce = (dt: number, delay = 0, dur = 0.55) => {
  const t = Math.max(0, Math.min(1, (dt - delay) / dur)) - 1;
  return 1 + 2.4 * t * t * t + 1.4 * t * t;
};

export function drawGraphic(ctx: CanvasRenderingContext2D, g: Graphic, x: number, y: number, w: number, h: number, dt: number) {
  ctx.save();
  ctx.fillStyle = BG;
  ctx.fillRect(x, y, w, h);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const pad = Math.min(w, h) * 0.09;
  const box = { x: x + pad, y: y + pad, w: w - pad * 2, h: h - pad * 2 };
  ({ number: drawNumber, bars: drawBars, list: drawList, compare: drawCompare, steps: drawSteps, keyword: drawKeyword })[g.type](ctx, g, box, dt);
  ctx.restore();
}

type Box = { x: number; y: number; w: number; h: number };

/** Ajusta o tamanho da fonte para o texto caber na largura. */
function fit(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, px: number, width: number) {
  ctx.font = font(px);
  const w = ctx.measureText(text).width;
  return w > width ? (px * width) / w : px;
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, a: number, color = MUTED) {
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.font = MONO(px);
  ctx.textBaseline = "top";
  ctx.fillText(text.toUpperCase(), x, y);
  ctx.globalAlpha = 1;
}

/** Marca-texto amarelo que corre por trás do texto (k = 0 → 1). */
function marker(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number) {
  ctx.fillStyle = MARKER;
  ctx.fillRect(x - h * 0.15, y, (w + h * 0.3) * k, h);
}

/** Título com marca-texto, à esquerda, quebrando em até 2 linhas. Devolve a altura usada. */
function heading(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, px: number, dt: number) {
  ctx.font = DISPLAY(px);
  ctx.textBaseline = "top";
  const lines = wrapLines(ctx, text, width, 2);
  lines.forEach((l, i) => {
    const ly = y + i * px * 1.15;
    marker(ctx, x, ly + px * 0.12, ctx.measureText(l).width, px * 0.95, enter(dt, 0.15 + i * 0.15, 0.4));
    ctx.globalAlpha = enter(dt, 0, 0.3);
    ctx.fillStyle = FG;
    ctx.fillText(l, x, ly);
    ctx.globalAlpha = 1;
  });
  return lines.length * px * 1.15;
}

/** Seta amarela "à mão" de (x0,y0) até (x1,y1), desenhada aos poucos (k = 0 → 1). */
function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, width: number, k: number) {
  if (k <= 0) return;
  const cx = (x0 + x1) / 2 + (y1 - y0) * 0.25, cy = (y0 + y1) / 2 - (x1 - x0) * 0.25;
  const at = (t: number) => [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1] as const;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let t = 0.05; t <= k + 1e-6; t += 0.05) ctx.lineTo(...at(Math.min(t, k)));
  ctx.stroke();
  if (k >= 1) {
    const [px, py] = at(0.9);
    const ang = Math.atan2(y1 - py, x1 - px), len = width * 4.5;
    ctx.beginPath();
    ctx.moveTo(x1 - len * Math.cos(ang - 0.5), y1 - len * Math.sin(ang - 0.5));
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - len * Math.cos(ang + 0.5), y1 - len * Math.sin(ang + 0.5));
    ctx.stroke();
  }
  ctx.restore();
}

/** "R$ 5 milhões" → conta 0 → 5 mantendo prefixo e sufixo. */
function counting(value: string, k: number) {
  const m = value.match(/^(.*?)(\d+(?:[.,]\d+)?)(.*)$/);
  if (!m) return value;
  const [, pre, num, post] = m;
  const target = parseFloat(num!.replace(/\./g, "").replace(",", "."));
  const decimals = num!.includes(",") ? num!.split(",")[1]!.length : 0;
  const now = (target * k).toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${pre}${now}${post}`;
}

function drawNumber(ctx: CanvasRenderingContext2D, g: Graphic, b: Box, dt: number) {
  const k = enter(dt, 0.05, 0.6);
  const text = counting(g.value || g.title, k);
  const final = g.value || g.title;
  const px = fit(ctx, final, DISPLAY, b.h * 0.42, b.w);
  const cy = b.y + b.h * 0.46;
  ctx.font = DISPLAY(px);
  const fw = ctx.measureText(final).width;
  marker(ctx, b.x + (b.w - fw) / 2, cy, fw, px * 0.42, enter(dt, 0.35, 0.5));
  ctx.globalAlpha = enter(dt, 0, 0.25);
  ctx.fillStyle = FG;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, b.x + b.w / 2, cy - px * 0.08 * (1 - k));
  if (g.value && g.title) {
    const lp = fit(ctx, g.title, (p) => BODY(p), Math.max(px * 0.2, b.w * 0.055), b.w);
    ctx.globalAlpha = enter(dt, 0.45, 0.4);
    ctx.fillStyle = MUTED;
    ctx.font = BODY(lp);
    ctx.fillText(g.title, b.x + b.w / 2, cy + px * 0.55 + lp * 1.4);
  }
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}

function drawBars(ctx: CanvasRenderingContext2D, g: Graphic, b: Box, dt: number) {
  const n = Math.max(1, Math.min(g.numbers.length, 6));
  const max = Math.max(...g.numbers.slice(0, n), 1);
  const head = Math.min(b.w, b.h) * 0.075;
  const th = g.title ? heading(ctx, g.title, b.x, b.y, b.w, head * 1.1, dt) : 0;
  const top = b.y + th + head * 1.2, bottom = b.y + b.h - head * 1.6;
  const slot = b.w / n, bw = slot * 0.56;
  ctx.textAlign = "center";
  for (let i = 0; i < n; i++) {
    const k = bounce(dt, 0.15 + i * 0.18, 0.7);
    const v = g.numbers[i]!;
    const bh = ((bottom - top - head * 1.4) * v) / max * k;
    const cx = b.x + slot * i + slot / 2;
    ctx.fillStyle = i === n - 1 ? NAVY : "rgba(31, 43, 123, 0.45)";
    ctx.beginPath();
    ctx.roundRect(cx - bw / 2, bottom - bh, bw, bh, [bw * 0.12, bw * 0.12, 0, 0]);
    ctx.fill();
    ctx.globalAlpha = k;
    ctx.fillStyle = FG;
    ctx.font = DISPLAY(fit(ctx, String(v), DISPLAY, head * 1.1, slot * 0.9));
    ctx.textBaseline = "bottom";
    ctx.fillText((v * Math.min(1, k)).toLocaleString("pt-BR", { maximumFractionDigits: Number.isInteger(v) ? 0 : 1 }), cx, bottom - bh - head * 0.3);
    ctx.fillStyle = MUTED;
    ctx.font = BODY(fit(ctx, g.items[i] ?? "", (p) => BODY(p), head * 0.8, slot * 0.92));
    ctx.textBaseline = "top";
    ctx.fillText(g.items[i] ?? "", cx, bottom + head * 0.4);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = LINE;
  ctx.fillRect(b.x, bottom, b.w * enter(dt, 0, 0.4), Math.max(1, head * 0.04));
  ctx.textAlign = "left";
  // Seta apontando para a última barra (o resultado).
  const last = n - 1, lx = b.x + slot * last + slot / 2;
  const lh = ((bottom - top - head * 1.4) * g.numbers[last]!) / max;
  arrow(ctx, lx - slot * 0.9, bottom - lh - head * 2.6, lx - bw * 0.65, bottom - lh - head * 0.4, head * 0.14, enter(dt, 0.15 + n * 0.18 + 0.3, 0.45));
}

function drawList(ctx: CanvasRenderingContext2D, g: Graphic, b: Box, dt: number, numbered = false) {
  const items = g.items.slice(0, 5);
  const row = Math.min(b.h / (items.length + 1.4), b.w * 0.2);
  const px = Math.min(row * 0.42, b.w * 0.07);
  let y = b.y + (b.h - row * (items.length + (g.title ? 1.2 : 0))) / 2;
  if (g.title) y += Math.max(row * 1.2, heading(ctx, g.title, b.x, y, b.w, row * 0.55, dt) + row * 0.3);
  items.forEach((item, i) => {
    const k = Math.min(1, bounce(dt, 0.25 + i * 0.3, 0.45));
    const cy = y + i * row + row / 2;
    const r = px * 0.75, cx = b.x + r;
    ctx.globalAlpha = k;
    // linha que liga os passos
    if (numbered && i < items.length - 1) {
      ctx.fillStyle = LINE;
      ctx.fillRect(cx - 1, cy + r, 2, (row - r * 2) * enter(dt, 0.45 + i * 0.35, 0.4));
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = numbered ? "transparent" : NAVY;
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    if (numbered) ctx.stroke();
    else ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = numbered ? NAVY : "#ffffff";
    ctx.font = numbered ? MONO(r * 0.95) : DISPLAY(r * 1.1);
    ctx.fillText(numbered ? String(i + 1) : "✓", cx, cy + 1);
    ctx.textAlign = "left";
    ctx.fillStyle = FG;
    ctx.font = BODY(fit(ctx, item, (p) => BODY(p), px, b.w - r * 3));
    ctx.fillText(item, b.x + r * 2.8 + (1 - k) * px * 1.5, cy);
  });
  ctx.globalAlpha = 1;
}

const drawSteps = (ctx: CanvasRenderingContext2D, g: Graphic, b: Box, dt: number) => drawList(ctx, g, b, dt, true);

/**
 * Antes × depois: os dois cartões entram de lados opostos com mola, um selo "VS" estoura no meio,
 * o lado ruim recebe um risco desenhado na hora e o lado bom ganha marca-texto e um pulso.
 */
function drawCompare(ctx: CanvasRenderingContext2D, g: Graphic, b: Box, dt: number) {
  const sides = g.items.slice(0, 2).map((it) => {
    const i = it.indexOf(":");
    return i > 0 ? { head: it.slice(0, i).trim(), body: it.slice(i + 1).trim() } : { head: "", body: it };
  });
  const wide = b.w / b.h >= 0.9;
  const gap = Math.min(b.w, b.h) * 0.1;
  const cells = [0, 1].map((i) =>
    wide ? { x: b.x + i * (b.w / 2 + gap / 2), y: b.y, w: b.w / 2 - gap / 2, h: b.h } : { x: b.x, y: b.y + i * (b.h / 2 + gap / 2), w: b.w, h: b.h / 2 - gap / 2 },
  );
  sides.forEach((side, i) => {
    const k = bounce(dt, 0.05 + i * 0.35);
    if (k <= 0) return;
    const cell = cells[i]!;
    const good = i === 1;
    const from = (i === 0 ? -1 : 1) * (wide ? b.w : b.h) * 0.6 * (1 - Math.min(1, k));
    const pulse = good && dt > 1.4 ? 1 + 0.025 * Math.sin((dt - 1.4) * 6) * Math.max(0, 1 - (dt - 1.4) / 1.5) : 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 1.5);
    ctx.translate(wide ? from : 0, wide ? 0 : from);
    ctx.translate(cell.x + cell.w / 2, cell.y + cell.h / 2);
    ctx.scale(pulse, pulse);
    ctx.translate(-(cell.x + cell.w / 2), -(cell.y + cell.h / 2));
    ctx.fillStyle = good ? "#ffffff" : "rgba(21, 23, 28, 0.06)";
    ctx.shadowColor = good ? "rgba(21, 23, 28, 0.18)" : "transparent";
    ctx.shadowBlur = gap * 0.6;
    ctx.beginPath();
    ctx.roundRect(cell.x, cell.y, cell.w, cell.h, gap * 0.35);
    ctx.fill();
    ctx.shadowColor = "transparent";
    const p = Math.min(cell.w, cell.h) * 0.11;
    const head = side.head || (good ? "Depois" : "Antes");
    const hp = fit(ctx, head, DISPLAY, p * 1.25, cell.w - p * 2);
    ctx.font = DISPLAY(hp);
    ctx.textBaseline = "top";
    const hw = ctx.measureText(head).width;
    if (good) marker(ctx, cell.x + p, cell.y + p + hp * 0.45, hw, hp * 0.5, enter(dt, 1.0, 0.4));
    ctx.fillStyle = good ? FG : MUTED;
    ctx.fillText(head, cell.x + p, cell.y + p);
    // Risco no lado ruim, desenhado depois que os dois cartões entram.
    if (!good) {
      const strike = enter(dt, 0.9, 0.35);
      ctx.fillStyle = "#e5484d";
      ctx.fillRect(cell.x + p - hp * 0.1, cell.y + p + hp * 0.52, (hw + hp * 0.2) * strike, Math.max(2, hp * 0.08));
    }
    ctx.font = BODY(p * 0.9);
    ctx.fillStyle = good ? FG : MUTED;
    wrapLines(ctx, side.body, cell.w - p * 2, 5).forEach((l, j) => ctx.fillText(l, cell.x + p, cell.y + p + hp * 1.6 + j * p * 1.2));
    ctx.restore();
  });
  // Selo "VS" no meio, estourando depois do segundo cartão.
  const v = bounce(dt, 0.6, 0.4);
  if (v > 0) {
    const r = Math.min(b.w, b.h) * 0.11 * v;
    const cx = wide ? b.x + b.w / 2 : b.x + b.w / 2, cy = wide ? b.y + b.h / 2 : b.y + b.h / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
    ctx.fillStyle = FG;
    ctx.font = DISPLAY(r * 0.8);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("VS", cx, cy + r * 0.05);
    ctx.restore();
  }
}

function drawKeyword(ctx: CanvasRenderingContext2D, g: Graphic, b: Box, dt: number) {
  const text = g.value || g.title;
  let px = Math.min(b.h * 0.3, b.w * 0.2);
  const longest = text.split(/\s+/).reduce((a, w) => (w.length > a.length ? w : a), "");
  px = fit(ctx, longest, DISPLAY, px, b.w);
  ctx.font = DISPLAY(px);
  // Diminui até caber inteiro em até 4 linhas (nunca corta com "…").
  let lines = wrapLines(ctx, text, b.w, 99);
  while ((lines.length > 4 || lines.length * px * 1.05 > b.h * 0.8) && px > 8) {
    px *= 0.9;
    ctx.font = DISPLAY(px);
    lines = wrapLines(ctx, text, b.w, 99);
  }
  const top = b.y + (b.h - lines.length * px * 1.05) / 2;
  if (g.value && g.title) label(ctx, g.title, b.x, top - px * 0.6, px * 0.22, enter(dt, 0.2, 0.3), ACCENT_INK);
  ctx.font = DISPLAY(px);
  const lastW = ctx.measureText(lines.at(-1) ?? "").width;
  marker(ctx, b.x, top + (lines.length - 1) * px * 1.05 + px * 0.5, lastW, px * 0.45, enter(dt, 0.35 + lines.length * 0.12, 0.45));
  ctx.fillStyle = FG;
  ctx.font = DISPLAY(px);
  ctx.textBaseline = "top";
  lines.forEach((l, i) => {
    const li = enter(dt, i * 0.12, 0.45);
    ctx.globalAlpha = li;
    ctx.fillText(l, b.x, top + i * px * 1.05 + (1 - li) * px * 0.4);
  });
  ctx.globalAlpha = 1;
}

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number, max: number) {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width <= width || !cur) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > max) {
    lines.length = max;
    lines[max - 1] = lines[max - 1]!.replace(/\s*\S*$/, "") + "…";
  }
  return lines;
}
