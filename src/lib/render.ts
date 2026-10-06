// Desenho do vídeo editado em <canvas>. A mesma função alimenta a prévia e a exportação,
// então o arquivo baixado é exatamente o que aparece no palco.
// A linguagem visual combina as referências: zoom alternado a cada corte, legenda revelada palavra a
// palavra com a expressão-chave em serifa itálica, títulos grandes nos ganchos e mídia em tela
// dividida (mídia em cima, pessoa embaixo) ou em tela cheia, conforme o plano decide por momento.
// Nunca há elemento flutuando sobre a pessoa (overlay/card): regra do projeto.
import { chunkAt, ease, shotZoomAt, titleAt, visualAt, zoomAt, type Asset, type Chunk, type Mark, type Timeline } from "./edit-plan";
import { faceAt, type FaceBox } from "./face";
import { ACCENT, drawGraphic, wrapLines } from "./graphics";

export type Ratio = "16:9" | "9:16" | "1:1";

export const SIZE: Record<Ratio, [number, number]> = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] };
// Largura do palco na interface: as medidas abaixo (em px de tela) escalam a partir dela.
const STAGE_W: Record<Ratio, number> = { "16:9": 920, "9:16": 500, "1:1": 500 };
const STAGE = "#17191e";
const POP = 0.35;

export type Media =
  | { kind: "image"; el: HTMLImageElement; credit: string }
  | { kind: "screenshot"; el: HTMLImageElement; credit: string; page: string; mark: Mark | null; mobile: boolean }
  | { kind: "gif"; el: HTMLVideoElement; credit: string }
  | { kind: "news"; title: string; source: string; img: HTMLImageElement | null; credit: string; page: string; shot: HTMLImageElement | null; mark: Mark | null; mobile: boolean };

export type Frame = { video: HTMLVideoElement; tl: Timeline; t: number; ratio: Ratio; media: (Media | null)[]; faces: FaceBox[] };

type Rect = { x: number; y: number; w: number; h: number };

export function drawFrame(ctx: CanvasRenderingContext2D, f: Frame) {
  const [W, H] = SIZE[f.ratio];
  const s = W / STAGE_W[f.ratio];
  const zoom = Math.min(1.4, zoomAt(f.tl, f.t) * shotZoomAt(f.tl, f.t));
  const face = faceAt(f.faces, f.t);
  const title = titleAt(f.tl, f.t);
  const vis = visualAt(f.tl, f.t);
  const m = vis?.kind === "media" ? f.media[vis.b.asset] : null;
  const shown = vis && (vis.kind === "graphic" || m) ? vis : null;
  const dt = shown ? f.t - shown.start : 0;
  const p = shown ? Math.min(1, dt / Math.max(0.5, shown.end - shown.start)) : 0;
  const words = shown?.kind === "media" && (shown.b.label || shown.b.text) ? shown.b : null;
  const paint = (x: number, y: number, w: number, h: number) => {
    if (shown?.kind === "graphic") drawGraphic(ctx, shown.g, x, y, w, h, dt);
    else if (m) {
      drawMedia(ctx, m, x, y, w, h, s, p, dt);
      if (words) drawMediaText(ctx, words.label, words.text, x, y, w, h, dt);
    }
  };

  ctx.fillStyle = STAGE;
  ctx.fillRect(0, 0, W, H);

  // Entrada com mola (0 → 1 em 0,5 s) e saída suave nos últimos 0,3 s do elemento.
  const enter = shown ? spring(dt / 0.5) : 0;
  const leave = shown ? ease((f.t - (shown.end - 0.3)) / 0.3) : 0;
  const k = shown ? Math.max(0, Math.min(1.08, enter) - leave) : 0;

  if (shown?.layout === "full") {
    // Corte para o elemento em tela cheia (a voz continua); cada tipo entra do seu jeito.
    drawVideo(ctx, f.video, 0, 0, W, H, zoom, face);
    enterFull(ctx, shown.kind === "graphic" ? "graphic" : (m?.kind ?? "image"), k, leave, W, H, () => paint(0, 0, W, H));
    // O topo é da mídia (manchete, rótulo): o título vai para a parte de baixo.
    if (title) drawTitle(ctx, f, title, W, H, H * 0.66, null);
    else if (!words?.text) drawCaption(ctx, f, W, H, H * 0.86, null, [0, H]); // a citação na tela já é o texto
    return;
  }

  if (shown?.layout === "split") {
    // Transição de layout: a pessoa desliza da tela cheia para a metade de baixo enquanto o elemento
    // desce por cima; no fim, o elemento sobe e a pessoa volta a ocupar a tela.
    const half = Math.min(1, k);
    const vy = (H / 2) * half;
    const fr = drawVideo(ctx, f.video, 0, vy, W, H - vy, zoom, face);
    ctx.save();
    ctx.translate(0, -(H / 2) * (1 - half));
    paint(0, 0, W, H / 2);
    // Sombra na emenda, para separar as metades durante o movimento.
    const g = ctx.createLinearGradient(0, H / 2, 0, H / 2 + H * 0.03);
    g.addColorStop(0, "rgba(0, 0, 0, 0.35)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, H / 2, W, H * 0.03);
    ctx.restore();
    if (!title) drawCaption(ctx, f, W, H, vy + (H - vy) * 0.16, fr, [vy, H]);
    else drawTitle(ctx, f, title, W, H, vy + H * 0.03, fr);
    return;
  }

  const fr = drawVideo(ctx, f.video, 0, 0, W, H, zoom, face);
  if (title) drawTitle(ctx, f, title, W, H, H * 0.12, fr);
  else drawCaption(ctx, f, W, H, H * 0.62, fr, [0, H]);
}

/** Mola (easeOutBack): passa um pouco do alvo e assenta. */
export const spring = (x: number) => {
  const t = Math.max(0, Math.min(1, x)) - 1;
  return 1 + 2.4 * t * t * t + 1.4 * t * t;
};

/**
 * Entrada/saída em tela cheia, por tipo: notícia/site sobem como uma janela, foto entra com zoom e
 * desfoque, GIF desliza da direita, componente cresce do centro. `k` = progresso com mola.
 */
function enterFull(ctx: CanvasRenderingContext2D, kind: Media["kind"] | "graphic", k: number, leave: number, W: number, H: number, draw: () => void) {
  if (k <= 0) return;
  const a = Math.min(1, k * 1.6);
  ctx.save();
  ctx.globalAlpha = a;
  if (kind === "news" || kind === "screenshot") {
    ctx.translate(0, H * 0.35 * (1 - Math.min(1, k)));
    const sc = 0.92 + 0.08 * k;
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-0.04 * (1 - Math.min(1, k)));
    ctx.scale(sc, sc);
    ctx.translate(-W / 2, -H / 2);
  } else if (kind === "image") {
    const sc = 1.25 - 0.25 * Math.min(1, k) + 0.06 * leave;
    if (k < 1) ctx.filter = `blur(${(1 - k) * 18}px)`;
    ctx.translate(W / 2, H / 2);
    ctx.scale(sc, sc);
    ctx.translate(-W / 2, -H / 2);
  } else if (kind === "gif") {
    ctx.translate(W * (1 - k), 0);
  } else {
    const sc = 0.8 + 0.2 * k;
    ctx.translate(W / 2, H / 2);
    ctx.scale(sc, sc);
    ctx.translate(-W / 2, -H / 2);
  }
  draw();
  ctx.restore();
}

/**
 * Centro vertical para um bloco de altura `bh` perto de `want`, sem cobrir o rosto: se colidir,
 * vai para logo abaixo do queixo; se não couber, para cima da cabeça; senão, o lado com mais espaço.
 */
function avoidFace(want: number, bh: number, x0: number, x1: number, face: Rect | null, [top, bottom]: [number, number]) {
  const pad = bh * 0.25;
  const clamp = (c: number) => Math.min(bottom - bh / 2 - pad, Math.max(top + bh / 2 + pad, c));
  if (!face || x1 < face.x || x0 > face.x + face.w) return clamp(want);
  const hits = (c: number) => c + bh / 2 > face.y && c - bh / 2 < face.y + face.h;
  if (!hits(clamp(want))) return clamp(want);
  const below = face.y + face.h + pad + bh / 2;
  const above = face.y - pad - bh / 2;
  if (below + bh / 2 <= bottom) return below;
  if (above - bh / 2 >= top) return above;
  return face.y - top > bottom - (face.y + face.h) ? clamp(above) : clamp(below);
}

/** Rótulo no topo e frase em destaque sobre a mídia (nome + citação, estudo + dado), em amarelo. */
function drawMediaText(ctx: CanvasRenderingContext2D, label: string, text: string, x: number, y: number, w: number, h: number, dt: number) {
  const u = Math.min(w, h * 0.6);
  ctx.save();
  // Escurece topo e base para o texto ler sobre qualquer imagem.
  for (const [y0, y1, a] of [[y, y + h * 0.3, 0.55], [y + h * 0.45, y + h, 0.7]] as const) {
    const grad = ctx.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(y0 === y ? 0 : 1, `rgba(0, 0, 0, ${a})`);
    grad.addColorStop(y0 === y ? 1 : 0, "rgba(0, 0, 0, 0)");
    if ((y0 === y && label) || (y0 !== y && text)) {
      ctx.fillStyle = grad;
      ctx.fillRect(x, y0, w, y1 - y0);
    }
  }
  ctx.fillStyle = ACCENT;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  shadow(ctx, u * 0.05);
  if (label) {
    const px = u * 0.075;
    ctx.globalAlpha = ease(dt / 0.35);
    ctx.font = `700 ${px}px "Bricolage Grotesque", Inter, sans-serif`;
    wrapLines(ctx, label, w * 0.86, 2).forEach((l, i) => ctx.fillText(l, x + w / 2, y + h * 0.07 + i * px * 1.1));
  }
  if (text) {
    const px = u * 0.068;
    ctx.font = `700 ${px}px Inter, sans-serif`;
    const lines = wrapLines(ctx, text, w * 0.84, 5);
    const top = y + h * 0.9 - lines.length * px * 1.2;
    lines.forEach((l, i) => {
      ctx.globalAlpha = ease((dt - 0.25 - i * 0.12) / 0.35);
      ctx.fillText(l, x + w / 2, top + i * px * 1.2);
    });
  }
  ctx.restore();
}

const shadow = (ctx: CanvasRenderingContext2D, size: number) => {
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = size * 0.5;
  ctx.shadowOffsetY = size * 0.06;
};

/** Título grande nos ganchos ("Repara uma coisa:"), à esquerda, palavras surgindo conforme são ditas. */
function drawTitle(ctx: CanvasRenderingContext2D, f: Frame, title: NonNullable<ReturnType<typeof titleAt>>, W: number, H: number, want: number, face: Rect | null) {
  const said = title.words.filter((w) => f.t >= w.start).map((w) => w.w);
  if (!said.length) return;
  const size = Math.min(W, H) * 0.1;
  ctx.font = `700 ${size}px "Bricolage Grotesque", Inter, sans-serif`;
  // O bloco é medido com o título inteiro, para não mudar de lugar enquanto as palavras surgem.
  const full = wrapLines(ctx, title.words.map((w) => w.w).join(" "), W * 0.84, 3);
  const lines = wrapLines(ctx, said.join(" "), W * 0.84, 3);
  const bh = full.length * size * 0.98;
  const top = avoidFace(want + bh / 2, bh, W * 0.08, W * 0.92, face, [0, H]) - bh / 2;
  const x = W * 0.08;
  pop(ctx, f.t - title.start, x, top, W * 0.84, lines.length * size, W / 500, () => {
    ctx.fillStyle = "#ffffff";
    shadow(ctx, size * 0.6);
    ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, x, top + i * size * 0.98));
  });
}

/**
 * Legenda sem tarja, centrada na altura do peito, as palavras surgem conforme são ditas.
 * As palavras de ênfase viram uma linha grande em serifa itálica; o que vem antes fica pequeno acima
 * (alinhado à esquerda dela) e o que vem depois pequeno abaixo (alinhado à direita).
 */
function drawCaption(ctx: CanvasRenderingContext2D, f: Frame, W: number, H: number, want: number, face: Rect | null, region: [number, number]) {
  const c = chunkAt(f.tl, f.t);
  if (!c) return;
  const base = Math.min(W, H) * 0.04;
  const small = `600 ${base}px Inter, sans-serif`;
  const big = (k: number) => `italic ${base * k}px "Instrument Serif", Georgia, serif`;

  // Layout calculado com o bloco inteiro (estável enquanto as palavras surgem): contexto pequeno
  // acima, expressão-chave grande no meio, resto pequeno abaixo.
  const all = c.words;
  const first = all.findIndex((w) => w.emph);
  const last = all.length - 1 - [...all].reverse().findIndex((w) => w.emph);
  type Line = { words: Chunk["words"]; font: string; size: number; align: "left" | "right" | "center"; emph: boolean };
  const lines: Line[] = [];
  if (first < 0) lines.push({ words: all, font: small, size: base, align: "center", emph: false });
  else {
    let k = 2.4;
    ctx.font = big(k);
    const w = ctx.measureText(all.slice(first, last + 1).map((x) => x.w).join(" ")).width;
    if (w > W * 0.84) k *= (W * 0.84) / w;
    if (first > 0) lines.push({ words: all.slice(0, first), font: small, size: base, align: "left", emph: false });
    lines.push({ words: all.slice(first, last + 1), font: big(k), size: base * k, align: "center", emph: true });
    if (last < all.length - 1) lines.push({ words: all.slice(last + 1), font: small, size: base, align: "right", emph: false });
  }
  const space = (l: Line) => l.size * 0.28;
  const widths = lines.map((l) => {
    ctx.font = l.font;
    const ws = l.words.map((w) => ctx.measureText(w.w).width);
    return { ws, total: ws.reduce((a, x) => a + x, 0) + space(l) * (ws.length - 1) };
  });
  const blockW = Math.min(W * 0.9, Math.max(...widths.map((x) => x.total)));
  const x0 = (W - blockW) / 2;
  const heights = lines.map((l) => l.size * (l.emph ? 1.0 : 1.3));
  const bh = heights.reduce((a, h) => a + h, 0);
  let y = avoidFace(want, bh, x0, x0 + blockW, face, region) - bh / 2;

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
  ctx.lineJoin = "round";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => {
    const total = widths[i]!.total;
    let x = l.align === "left" ? x0 : l.align === "right" ? x0 + blockW - total : (W - total) / 2;
    const cy = y + heights[i]! / 2;
    // Marca-texto amarelo correndo por trás da expressão-chave enquanto ela é dita.
    if (l.emph && f.t >= l.words[0]!.start) {
      const sweep = ease((f.t - l.words[0]!.start) / Math.max(0.3, l.words.at(-1)!.end - l.words[0]!.start));
      ctx.save();
      ctx.fillStyle = "rgba(255, 201, 40, 0.9)";
      ctx.fillRect(x - l.size * 0.08, cy + l.size * 0.05, (total + l.size * 0.16) * sweep, l.size * 0.32);
      ctx.restore();
    }
    l.words.forEach((w, j) => {
      const ww = widths[i]!.ws[j]!;
      const dt = f.t - w.start;
      if (dt >= 0) {
        // Cada palavra entra com um "pop": cresce de 60% com leve passada de 112% e assenta.
        const k = dt >= 0.22 ? 1 : dt < 0.12 ? 0.6 + (0.52 * dt) / 0.12 : 1.12 - (0.12 * (dt - 0.12)) / 0.1;
        ctx.save();
        ctx.globalAlpha = Math.min(1, dt / 0.08);
        ctx.translate(x + ww / 2, cy);
        ctx.scale(k, k);
        ctx.font = l.font;
        shadow(ctx, base);
        ctx.lineWidth = l.size * 0.14;
        ctx.strokeText(w.w, -ww / 2, 0);
        ctx.fillText(w.w, -ww / 2, 0);
        ctx.restore();
      }
      x += ww + space(l);
    });
    y += heights[i]!;
  });
  ctx.restore();
}

/**
 * Vídeo em object-cover, espelhado como a câmera ao vivo. O enquadramento (e o zoom) centraliza no
 * rosto quando ele foi detectado. Devolve onde o rosto ficou no quadro, para o texto desviar dele.
 */
function drawVideo(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, x: number, y: number, w: number, h: number, zoom: number, face: Omit<FaceBox, "t"> | null): Rect | null {
  if (!v.videoWidth) return null;
  const vw = v.videoWidth, vh = v.videoHeight;
  const k = Math.max(w / vw, h / vh) * zoom;
  const sw = w / k, sh = h / k;
  const cx = face ? (face.x + face.w / 2) * vw : vw / 2;
  const cy = face ? (face.y + face.h * 0.55) * vh : vh * 0.42;
  const sx = Math.min(vw - sw, Math.max(0, cx - sw / 2));
  const sy = Math.min(vh - sh, Math.max(0, cy - sh / 2));
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x + w, y);
  ctx.scale(-1, 1);
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
  ctx.restore();
  if (!face) return null;
  // Caixa do rosto no quadro final (espelhado), com folga para cabelo e queixo.
  const fx0 = x + w - ((face.x + face.w) * vw - sx) * k;
  const fy0 = y + (face.y * vh - sy) * k;
  const fw = face.w * vw * k, fh = face.h * vh * k;
  return { x: fx0 - fw * 0.1, y: fy0 - fh * 0.35, w: fw * 1.2, h: fh * 1.55 };
}

/**
 * object-cover com movimento: `zoom` aproxima devagar (fotos), `scroll` desce pela página (prints,
 * de 0 a 1 do que sobra abaixo do quadro, até 35% da altura da página).
 */
function cover(ctx: CanvasRenderingContext2D, el: HTMLImageElement | HTMLVideoElement, x: number, y: number, w: number, h: number, o: { zoom?: number; scroll?: number } = {}) {
  const iw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const ih = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!iw || !ih) return;
  const k = Math.max(w / iw, h / ih) * (o.zoom ?? 1);
  const sw = w / k, sh = h / k;
  const sy = o.scroll === undefined ? (ih - sh) / 2 : Math.min(ih - sh, ih * 0.35) * o.scroll;
  ctx.drawImage(el, (iw - sw) / 2, sy, sw, sh, x, y, w, h);
}

/** Imagem inteira sobre uma cópia dela mesma ampliada, desfocada e escurecida (sem faixas vazias). */
function contain(ctx: CanvasRenderingContext2D, el: HTMLImageElement, x: number, y: number, w: number, h: number, zoom: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.filter = "blur(28px) brightness(0.55)";
  cover(ctx, el, x - 40, y - 40, w + 80, h + 80);
  ctx.filter = "none";
  const k = Math.min((w * 0.92) / el.naturalWidth, (h * 0.8) / el.naturalHeight) * zoom;
  const dw = el.naturalWidth * k, dh = el.naturalHeight * k;
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = Math.min(w, h) * 0.04;
  ctx.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** `p` = progresso (0 → 1) do tempo em tela, para o movimento lento. */
function drawMedia(ctx: CanvasRenderingContext2D, m: Media, x: number, y: number, w: number, h: number, s: number, p = 0, dt = 0) {
  if (m.kind === "news") return m.shot ? drawBrowser(ctx, m.shot, m.page, m.mark, x, y, w, h, dt, p) : drawNews(ctx, m, x, y, w, h, s, p);
  if (m.kind === "screenshot") return drawBrowser(ctx, m.el, m.page, m.mark, x, y, w, h, dt, p);
  ctx.fillStyle = STAGE;
  ctx.fillRect(x, y, w, h);
  if (m.kind === "image") {
    // Logo/imagem muito larga ou alta: o corte comeria mais da metade, então mostra inteira no papel.
    const r = m.el.naturalWidth / m.el.naturalHeight / (w / h);
    if (r > 2 || r < 0.5) contain(ctx, m.el, x, y, w, h, 1 + 0.05 * p);
    else cover(ctx, m.el, x, y, w, h, { zoom: 1 + 0.08 * p });
  }
  else cover(ctx, m.el, x, y, w, h);
}

/**
 * "Abrindo o site": janela de navegador em que a URL é digitada, a página carrega e rola até a
 * manchete (se houver), que recebe o marca-texto amarelo. Sem manchete, rola devagar pela página.
 */
const filled = new WeakMap<HTMLImageElement, number>();

function drawBrowser(ctx: CanvasRenderingContext2D, page: HTMLImageElement, url: string, mark: Mark | null, x: number, y: number, w: number, h: number, dt: number, p: number) {
  if (!filled.has(page)) filled.set(page, contentHeight(page));
  const u = Math.min(w, h);
  const m = u * 0.045;
  const win = { x: x + m, y: y + m, w: w - m * 2, h: h - m * 2 };
  const bar = Math.max(u * 0.085, 36);
  ctx.save();
  ctx.fillStyle = "#1c1e24";
  ctx.fillRect(x, y, w, h);
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = u * 0.04;
  ctx.beginPath();
  ctx.roundRect(win.x, win.y, win.w, win.h, u * 0.025);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.clip();

  // Barra do navegador: bolinhas, campo de endereço com a URL sendo digitada.
  ctx.fillStyle = "#ececef";
  ctx.fillRect(win.x, win.y, win.w, bar);
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(win.x + bar * (0.45 + i * 0.32), win.y + bar / 2, bar * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });
  const fx = win.x + bar * 1.45, fw = win.w - bar * 1.75;
  ctx.beginPath();
  ctx.roundRect(fx, win.y + bar * 0.2, fw, bar * 0.6, bar * 0.3);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  const shown = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const typed = shown.slice(0, Math.round(shown.length * ease(dt / 0.55)));
  ctx.fillStyle = "#3c3f46";
  ctx.font = `500 ${bar * 0.3}px Inter, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(`🔒 ${typed}${dt < 0.6 && Math.floor(dt * 6) % 2 === 0 ? "|" : ""}`, fx + bar * 0.25, win.y + bar / 2, fw - bar * 0.4);
  // Carregando: barra fina azul sob o endereço.
  const load = ease((dt - 0.5) / 0.35);
  if (load > 0 && load < 1) {
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(win.x, win.y + bar - 3, win.w * load, 3);
  }

  // Página: entra após carregar, ajustada à largura; rola até a manchete ou desce devagar.
  const area = { x: win.x, y: win.y + bar, w: win.w, h: win.h - bar };
  if (dt > 0.6) {
    const k = area.w / page.naturalWidth;
    const ph = page.naturalHeight * k;
    const room = Math.max(0, ph * filled.get(page)! - area.h); // nunca rola até a parte vazia
    const target = mark ? Math.min(room, Math.max(0, mark.y * ph - area.h * 0.25)) : room * 0.35;
    const scroll = target * ease((dt - 1.0) / 0.9) + (mark ? 0 : room * 0.1 * p);
    ctx.globalAlpha = ease((dt - 0.6) / 0.25);
    ctx.drawImage(page, area.x, area.y - scroll, area.w, ph);
    if (mark) {
      const sweep = ease((dt - 1.9) / 0.5);
      if (sweep > 0) {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = "rgba(255, 201, 40, 0.85)";
        ctx.fillRect(area.x + mark.x * area.w - 6, area.y - scroll + mark.y * ph - 4, (mark.w * area.w + 12) * sweep, mark.h * ph + 8);
        ctx.globalCompositeOperation = "source-over";
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** Card de notícia: foto da matéria, veículo e manchete. Lado a lado quando o espaço é largo (Split). */
function drawNews(ctx: CanvasRenderingContext2D, m: Extract<Media, { kind: "news" }>, x: number, y: number, w: number, h: number, s: number, p = 0) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);
  const wide = w / h > 1.6;
  const pad = 14 * s;
  let tx = x + pad, ty = y + pad, tw = w - pad * 2, th = h - pad * 2;
  if (m.img) {
    if (wide) {
      const iw = w * 0.42;
      cover(ctx, m.img, x, y, iw, h, { zoom: 1 + 0.06 * p });
      tx = x + iw + pad * 1.5;
      tw = w - iw - pad * 2.5;
    } else {
      const ih = h * 0.62;
      cover(ctx, m.img, x, y, w, ih, { zoom: 1 + 0.06 * p });
      ty = y + ih + pad * 0.8;
      th = h - ih - pad * 1.8;
    }
  }
  const small = wide ? 11 * s : w * 0.028;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#6b7280";
  ctx.font = `500 ${small}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.fillText(m.source.toUpperCase().slice(0, 40), tx, ty, tw);
  const size = wide ? 22 * s : w * 0.058;
  ctx.fillStyle = "#111318";
  ctx.font = `600 ${size}px "Bricolage Grotesque", Inter, sans-serif`;
  const lines = wrapLines(ctx, m.title, tw, Math.max(1, Math.floor((th - small * 1.8) / (size * 1.2))));
  lines.forEach((l, i) => ctx.fillText(l, tx, ty + small * 1.8 + i * size * 1.2));
}

/** Entrada "animate-pop": sobe 12px e cresce de 96% a 100% em 350ms. */
function pop(ctx: CanvasRenderingContext2D, dt: number, x: number, y: number, w: number, h: number, s: number, draw: () => void) {
  const p = ease(dt / POP);
  const k = 0.96 + 0.04 * p;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, dt / POP);
  ctx.translate(x + w / 2, y + h / 2 + 12 * s * (1 - p));
  ctx.scale(k, k);
  ctx.translate(-(x + w / 2), -(y + h / 2));
  draw();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export const once = (el: EventTarget, ev: string) => new Promise<void>((r) => el.addEventListener(ev, () => r(), { once: true }));

export async function loadMedia(a: Asset): Promise<Media | null> {
  if (a.type === "news") {
    const [img, shot] = await Promise.all([a.image ? loadImage(a.image) : null, a.shot ? loadImage(a.shot) : null]);
    return { kind: "news", title: a.title, source: a.source, img, credit: a.credit, page: a.page, shot, mark: a.mark, mobile: a.mobile };
  }
  if (a.type === "screenshot") {
    const el = await loadImage(a.url);
    return el && { kind: "screenshot", el, credit: a.credit, page: a.page, mark: a.mark, mobile: a.mobile };
  }
  if (a.type === "gif") {
    const el = Object.assign(document.createElement("video"), { src: a.url, muted: true, loop: true, playsInline: true });
    await Promise.race([once(el, "loadeddata"), once(el, "error")]);
    if (!el.videoWidth) return null;
    void el.play().catch(() => undefined);
    return { kind: "gif", el, credit: a.credit };
  }
  const el = await loadImage(a.url);
  return el && { kind: "image", el, credit: a.credit };
}

/** Altura (0–1) até onde o print tem conteúdo: ignora a faixa lisa no fim (vídeos/iframes não renderizados). */
function contentHeight(img: HTMLImageElement) {
  const w = 40, h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  for (let y = h - 1; y > 0; y--) {
    let min = 255, max = 0;
    for (let x = 0; x < w; x++) {
      const v = px[(y * w + x) * 4]! * 0.3 + px[(y * w + x) * 4 + 1]! * 0.59 + px[(y * w + x) * 4 + 2]! * 0.11;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    if (max - min > 24) return Math.min(1, (y + 2) / h);
  }
  return 1;
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((r) => {
    const img = new Image();
    img.onload = () => r(img);
    img.onerror = () => r(null);
    img.src = src;
  });
}

const MIMES = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1.42E01F,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];

/**
 * Monta o arquivo final em tempo real: toca a gravação pulando os cortes, desenha cada quadro
 * e grava o canvas + o áudio. Leva o tempo do vídeo editado; com a aba oculta o navegador
 * pode economizar a decodificação do vídeo, então o ideal é manter a aba visível.
 */
export async function exportVideo(o: { url: string; tl: Timeline; ratio: Ratio; media: (Media | null)[]; faces: FaceBox[]; signal: AbortSignal; onProgress: (p: number) => void }) {
  const [W, H] = SIZE[o.ratio];
  const video = document.createElement("video");
  video.src = o.url;
  video.playsInline = true;
  await once(video, "loadedmetadata");

  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d")!;
  const audio = new AudioContext();
  const dest = audio.createMediaStreamDestination();
  // Só para o arquivo, não sai no alto-falante. O ganho faz um fade de 30 ms em cada corte (sem estalo).
  const gain = audio.createGain();
  audio.createMediaElementSource(video).connect(gain).connect(dest);
  const fade = (to: number) => {
    const now = audio.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(to, now + 0.03);
  };
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mimeType = MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = once(rec, "stop");
  const draw = (t: number) => drawFrame(ctx, { video, tl: o.tl, t, ratio: o.ratio, media: o.media, faces: o.faces });
  // Relógio em Worker: requestAnimationFrame para quando a aba fica oculta e a exportação travaria.
  const ticker = new Worker(URL.createObjectURL(new Blob(["setInterval(() => postMessage(0), 1000 / 60)"], { type: "text/javascript" })));

  try {
    void audio.resume(); // sem gesto do usuário a promessa nunca resolve; não bloquear
    for (const seg of o.tl.segments) {
      if (o.signal.aborted) throw new DOMException("Cancelado", "AbortError");
      video.currentTime = seg.src0;
      await once(video, "seeked");
      draw(seg.src0);
      gain.gain.value = 0;
      if (rec.state === "inactive") rec.start(1000);
      else rec.resume();
      await video.play();
      fade(1);
      let closing = false;
      await new Promise<void>((resolve, reject) => {
        ticker.onmessage = () => {
          if (o.signal.aborted) return reject(new DOMException("Cancelado", "AbortError"));
          const t = video.currentTime;
          draw(t);
          o.onProgress(Math.min(1, (seg.out0 + t - seg.src0) / o.tl.duration));
          if (!closing && t >= seg.src1 - 0.04) {
            closing = true;
            fade(0);
          }
          if (t >= seg.src1 || video.ended) {
            ticker.onmessage = null;
            resolve();
          }
        };
      });
      video.pause();
      rec.pause();
    }
    rec.stop();
    await stopped;
  } finally {
    if (rec.state !== "inactive") rec.stop();
    video.pause();
    ticker.terminate();
    void audio.close();
  }
  const type = mimeType.split(";")[0] || "video/webm";
  return { blob: new Blob(parts, { type }), ext: type.includes("mp4") ? "mp4" : "webm" };
}
