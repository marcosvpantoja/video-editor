// Modelo puro da edição: palavras transcritas + plano da IA → linha do tempo editada.
// "src" = tempo na gravação original; "out" = tempo no vídeo editado (depois dos cortes).

export type Word = { w: string; start: number; end: number };
export type Transcript = { words: Word[]; language: string };

export type Plan = {
  topic: string;
  removeWords: number[];
  emphasis: number[];
  zooms: { from: number; to: number; strong: boolean }[];
  /** `prepared`: índice no acervo da pré-montagem cuja mídia já está pronta (ausente/-1 = pesquisar). */
  broll: { from: number; to: number; kind: MediaKind; brief: string; layout: Layout; label: string; text: string; prepared?: number }[];
  /** Frases de impacto que viram título grande no lugar da legenda. */
  titles: { from: number; to: number }[];
  /** Componentes animados gerados na hora (números, gráficos, listas…). */
  graphics: ({ from: number; to: number; layout: Layout } & Graphic)[];
};

/**
 * full = toma a tela inteira (a voz continua); split = metade de cima, pessoa embaixo.
 * Nunca há elemento flutuando sobre a pessoa (overlay/card): regra do projeto.
 */
export type Layout = "full" | "split";

/**
 * number: valor grande que conta até o número citado ("R$ 5 milhões", "2x") + rótulo
 * bars: barras que crescem (numbers + items como rótulos)
 * list: itens que entram um a um com ✓
 * compare: duas colunas, antes × depois (items[0] e items[1], "Título: texto")
 * steps: passos numerados ligados por uma linha
 * keyword: palavra/expressão-chave em tipografia grande
 */
export type GraphicType = "number" | "bars" | "list" | "compare" | "steps" | "keyword";
export type Graphic = { type: GraphicType; title: string; value: string; items: string[]; numbers: number[] };

/** Notícia (card com manchete), print de site, GIF ou imagem específica. */
export type MediaKind = "news" | "screenshot" | "gif" | "image";
/** Posição (0–1) da manchete dentro do print, para rolar até ela e marcar. */
export type Mark = { x: number; y: number; w: number; h: number };
export type Asset =
  | { type: "image"; url: string; credit: string }
  | { type: "screenshot"; url: string; credit: string; page: string; mark: Mark | null; mobile: boolean }
  | { type: "gif"; url: string; credit: string }
  | { type: "news"; title: string; source: string; image: string | null; credit: string; page: string; shot: string | null; mark: Mark | null; mobile: boolean };
export type Segment = { src0: number; src1: number; out0: number };
export type CaptionWord = Word & { emph: boolean };
export type Chunk = { start: number; end: number; words: CaptionWord[] };
export type Span = { start: number; end: number };
export type Timeline = {
  segments: Segment[];
  duration: number;
  chunks: Chunk[];
  zooms: (Span & { scale: number })[];
  broll: (Span & { kind: MediaKind; brief: string; layout: Layout; label: string; text: string; asset: number })[];
  titles: (Span & { words: Word[] })[];
  graphics: (Span & Graphic & { layout: Layout })[];
  /** Início de cada "tomada" (src): todo corte e todo começo de frase. Base do zoom alternado. */
  shots: number[];
};

// Cortes sutis: só pausas longas saem, e sobra respiro dos dois lados (o Whisper costuma marcar o
// início/fim das palavras um pouco "por dentro", então margem curta come sílabas).
const MAX_GAP = 0.6; // pausa maior que isso vira corte
const LEAD = 0.18; // respiro mantido antes da fala
const TAIL = 0.25; // respiro mantido depois da fala
const ZOOM = { soft: 1.12, strong: 1.25 };
const RAMP = 0.18;

// Hesitações sem conteúdo: "ahn", "hum", "UUU", "éé", "hmm"…
export const isFiller = (w: string) => /^(a+h+n*|a{2,}h*n*|ã+h*n*|h+u+m+|h+m+|u{2,}[hm]*|uh+|é{2,}h*|é+h+|eh+|m{2,})$/.test(norm(w));

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function buildTimeline(words: Word[], plan: Plan, duration: number): Timeline {
  const removed = new Set(plan.removeWords);
  const kept = words.map((w, i) => ({ ...w, i })).filter((w) => !removed.has(w.i));

  const segments: Segment[] = [];
  let out = 0;
  if (!kept.length) segments.push({ src0: 0, src1: duration, out0: 0 });
  for (let k = 0; k < kept.length; ) {
    let j = k;
    while (j + 1 < kept.length && kept[j + 1]!.start - kept[j]!.end <= MAX_GAP && kept[j + 1]!.i === kept[j]!.i + 1) j++;
    const prevEnd = segments.at(-1)?.src1 ?? 0;
    // O respiro nunca invade uma palavra removida vizinha.
    const before = removed.has(kept[k]!.i - 1) ? words[kept[k]!.i - 1]!.end : 0;
    const after = removed.has(kept[j]!.i + 1) ? words[kept[j]!.i + 1]!.start : duration;
    const src0 = Math.max(prevEnd, kept[k]!.start - LEAD, before, 0);
    const src1 = Math.min(duration, kept[j]!.end + TAIL, after);
    if (src1 > src0) {
      segments.push({ src0, src1, out0: out });
      out += src1 - src0;
    }
    k = j + 1;
  }
  const total = segments.reduce((s, x) => s + (x.src1 - x.src0), 0);

  const at = (i: number, edge: "start" | "end") => words[Math.max(0, Math.min(words.length - 1, i))]?.[edge] ?? 0;
  const span = (from: number, to: number): Span => ({ start: at(Math.min(from, to), "start"), end: at(Math.max(from, to), "end") });

  const chunks = chunkWords(kept, new Set(plan.emphasis));
  const sentenceStarts = chunks.filter((c, i) => i > 0 && /[.!?…:]$/.test(chunks[i - 1]!.words.at(-1)!.w)).map((c) => c.start);
  const shots = [...new Set([...segments.slice(1).map((x) => x.src0), ...sentenceStarts])].sort((a, b) => a - b);

  return {
    segments,
    duration: total,
    chunks,
    shots,
    zooms: plan.zooms.map((z) => ({ ...span(z.from, z.to), scale: z.strong ? ZOOM.strong : ZOOM.soft })),
    broll: plan.broll.map((b, n) => ({ ...span(b.from, b.to), kind: b.kind, brief: b.brief, layout: b.layout, label: b.label, text: b.text, asset: n })).filter((b) => b.end - b.start >= 0.6),
    titles: plan.titles.map((x) => {
      const ws = kept.filter((w) => w.i >= Math.min(x.from, x.to) && w.i <= Math.max(x.from, x.to));
      return { ...span(x.from, x.to), words: ws.map(({ w, start, end }) => ({ w, start, end })) };
    }).filter((x) => x.words.length),
    graphics: plan.graphics.map(({ from, to, ...g }) => ({ ...span(from, to), ...g })).filter((g) => g.end - g.start >= 0.6),
  };
}

function chunkWords(words: (Word & { i: number })[], emph: Set<number>): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (cur.length) chunks.push({ start: cur[0]!.start, end: cur.at(-1)!.end, words: cur });
    cur = [];
  };
  for (const w of words) {
    const last = cur.at(-1);
    const chars = cur.reduce((s, x) => s + x.w.length + 1, 0);
    if (last && (w.start - last.end > 0.6 || cur.length >= 4 || chars + w.w.length > 24)) flush();
    cur.push({ w: w.w, start: w.start, end: w.end, emph: emph.has(w.i) });
    if (/[.!?…]$/.test(w.w)) flush();
  }
  flush();
  // Segura cada legenda até a próxima começar (máx. 0,4 s), para não piscar.
  chunks.forEach((c, i) => (c.end = Math.min(c.end + 0.4, chunks[i + 1]?.start ?? Infinity)));
  return chunks;
}

export function srcToOut(tl: Timeline, t: number) {
  for (const s of tl.segments) if (t < s.src1) return s.out0 + Math.max(0, t - s.src0);
  return tl.duration;
}

export function outToSrc(tl: Timeline, t: number) {
  for (const s of tl.segments) if (t < s.out0 + (s.src1 - s.src0)) return s.src0 + Math.max(0, t - s.out0);
  return tl.segments.at(-1)?.src1 ?? 0;
}

/** Segmento que contém `t` (src), ou o próximo depois de um corte; `null` no fim. */
export function segmentAt(tl: Timeline, t: number) {
  return tl.segments.find((s) => t < s.src1 - 0.01) ?? null;
}

export function zoomAt(tl: Timeline, t: number) {
  for (const z of tl.zooms) {
    if (t < z.start || t > z.end) continue;
    const ramp = Math.min(1, (t - z.start) / RAMP, (z.end - t) / RAMP);
    return 1 + (z.scale - 1) * ease(ramp);
  }
  return 1;
}

/** Zoom alternado: tomadas pares abertas, ímpares fechadas. Troca seca, sem rampa. */
export function shotZoomAt(tl: Timeline, t: number, close = 1.2) {
  let n = 0;
  while (n < tl.shots.length && tl.shots[n]! <= t) n++;
  return n % 2 ? close : 1;
}

export const brollAt = (tl: Timeline, t: number) => tl.broll.find((b) => t >= b.start && t < b.end) ?? null;
/** Elemento visual ativo: componente ou mídia, o que tiver começado por último. */
export function visualAt(tl: Timeline, t: number) {
  const g = tl.graphics.filter((x) => t >= x.start && t < x.end).at(-1);
  const b = brollAt(tl, t);
  if (g && (!b || g.start >= b.start)) return { kind: "graphic" as const, g, start: g.start, end: g.end, layout: g.layout };
  if (b) return { kind: "media" as const, b, start: b.start, end: b.end, layout: b.layout };
  return null;
}

export const titleAt = (tl: Timeline, t: number) => tl.titles.find((x) => t >= x.start && t < x.end + 0.4) ?? null;
export const chunkAt = (tl: Timeline, t: number) => tl.chunks.find((c) => t >= c.start && t < c.end) ?? null;
export const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

/**
 * Só deixa cortar o que é seguro: hesitação ("ahn", "hum") ou repetição imediata de 1 a 3 palavras
 * ("eu eu", "a gente a gente"). Qualquer outra palavra pedida para corte é mantida.
 */
export function safeRemovals(words: Word[], asked: number[]) {
  const n = (i: number) => norm(words[i]?.w ?? "");
  // Frase de k palavras começando em `s` repetida logo em seguida; `i` precisa estar na primeira cópia.
  const repeatAt = (s: number, k: number) => s >= 0 && s + k * 2 <= words.length && Array.from({ length: k }, (_, j) => n(s + j) !== "" && n(s + j) === n(s + k + j)).every(Boolean);
  const repeats = (i: number) => [1, 2, 3].some((k) => Array.from({ length: k }, (_, d) => repeatAt(i - d, k)).some(Boolean));
  return asked.filter((i) => isFiller(words[i]?.w ?? "") || repeats(i));
}

/** Plano local, sem IA: remove hesitações óbvias e marca palavras longas. Sem b-roll:
 *  mídia sem entender o contexto vira imagem aleatória. */
export function heuristicPlan(words: Word[]): Plan {
  const removeWords = words.flatMap((w, i) => (isFiller(w.w) ? [i] : []));
  const content = words.map((w, i) => ({ k: norm(w.w), i })).filter((x) => x.k.length > 5);
  const emphasis = content.filter((_, n) => n % 4 === 0).map((x) => x.i);
  return { topic: "", removeWords, emphasis, zooms: [], broll: [], titles: [], graphics: [] };
}

/** Converte frases do reconhecimento do navegador em palavras com tempo aproximado. */
export function wordsFromPhrases(phrases: { t: number; text: string }[]): Word[] {
  return phrases.flatMap((p) => {
    const ws = p.text.split(/\s+/).filter(Boolean);
    const step = 3 / Math.max(1, ws.length);
    return ws.map((w, i) => ({ w, start: p.t + i * step, end: p.t + (i + 1) * step }));
  });
}

function fmt(t: number) {
  const ms = Math.floor((t % 1) * 1000), sec = Math.floor(t);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(Math.floor(sec / 3600))}:${p(Math.floor(sec / 60) % 60)}:${p(sec % 60)},${p(ms, 3)}`;
}

export const chunkText = (c: Chunk) => c.words.map((w) => w.w).join(" ");

export function toSrt(tl: Timeline) {
  return tl.chunks
    .map((c, i) => `${i + 1}\n${fmt(srcToOut(tl, c.start))} --> ${fmt(srcToOut(tl, c.end))}\n${chunkText(c)}\n`)
    .join("\n");
}
