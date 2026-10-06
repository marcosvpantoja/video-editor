import { describe, expect, it } from "vitest";
import { brollAt, buildTimeline, chunkAt, heuristicPlan, isFiller, safeRemovals, shotZoomAt, titleAt, visualAt, outToSrc, srcToOut, toSrt, zoomAt, type Plan, type Word } from "@/lib/edit-plan";

const words: Word[] = [
  { w: "Olá,", start: 0.5, end: 0.8 },
  { w: "hum,", start: 1.0, end: 1.3 },
  { w: "hoje", start: 1.5, end: 1.8 },
  { w: "vou", start: 1.8, end: 2.0 },
  { w: "falar", start: 2.0, end: 2.4 },
  { w: "de", start: 4.0, end: 4.1 }, // pausa longa antes
  { w: "marketing.", start: 4.1, end: 4.8 },
];
const empty: Plan = { topic: "", removeWords: [], emphasis: [], zooms: [], broll: [], titles: [], graphics: [] };

describe("buildTimeline", () => {
  it("corta pausas longas e palavras removidas", () => {
    const tl = buildTimeline(words, { ...empty, removeWords: [1] }, 6);
    expect(tl.segments.map((s) => [s.src0, s.src1].map((x) => +x.toFixed(2)))).toEqual([
      [0.32, 1],
      [1.32, 2.65],
      [3.82, 5.05],
    ]);
    expect(tl.duration).toBeCloseTo(0.68 + 1.33 + 1.23);
    expect(tl.chunks.flatMap((c) => c.words.map((w) => w.w))).not.toContain("hum,");
  });

  it("o respiro não invade a palavra removida", () => {
    const tl = buildTimeline(words, { ...empty, removeWords: [1] }, 6);
    expect(tl.segments[0]!.src1).toBeLessThanOrEqual(1.0);
    expect(tl.segments[1]!.src0).toBeGreaterThanOrEqual(1.3);
  });

  it("converte tempo da gravação ↔ vídeo editado", () => {
    const tl = buildTimeline(words, empty, 6);
    for (const t of [0.5, 2.0, 4.5]) expect(outToSrc(tl, srcToOut(tl, t))).toBeCloseTo(t);
    expect(srcToOut(tl, 3.0)).toBeCloseTo(tl.segments[1]!.out0); // dentro do corte → início do próximo trecho
  });

  it("agrupa legendas e quebra em pontuação", () => {
    const tl = buildTimeline(words, { ...empty, emphasis: [6] }, 6);
    expect(tl.chunks.map((c) => c.words.length)).toEqual([4, 1, 2]); // máx. 4 palavras; pausa e ponto quebram
    expect(tl.chunks.at(-1)!.words.at(-1)).toMatchObject({ w: "marketing.", emph: true });
    expect(chunkAt(tl, 1.6)?.words[0]?.w).toBe("Olá,");
  });

  it("zoom com rampa e b-roll por intervalo de palavras", () => {
    const tl = buildTimeline(words, { ...empty, zooms: [{ from: 2, to: 4, strong: true }], broll: [{ from: 5, to: 6, kind: "news", brief: "marketing", layout: "split", label: "", text: "" }], titles: [{ from: 2, to: 4 }] }, 6);
    expect(zoomAt(tl, 1.5)).toBe(1);
    expect(zoomAt(tl, 1.95)).toBeCloseTo(1.25);
    expect(brollAt(tl, 4.3)?.brief).toBe("marketing");
    expect(brollAt(tl, 1.0)).toBeNull();
    expect(titleAt(tl, 1.9)?.words.map((w) => w.w)).toEqual(["hoje", "vou", "falar"]);
    expect(titleAt(tl, 3.5)).toBeNull();
    expect(visualAt(tl, 4.3)).toMatchObject({ kind: "media", layout: "split" });
  });

  it("componente começa depois da mídia e assume a tela", () => {
    const g = { type: "number" as const, title: "pedidos", value: "2x", items: [], numbers: [], layout: "full" as const };
    const tl = buildTimeline(words, { ...empty, broll: [{ from: 2, to: 6, kind: "image", brief: "", layout: "split", label: "", text: "" }], graphics: [{ from: 5, to: 6, ...g }] }, 6);
    expect(visualAt(tl, 1.9)?.kind).toBe("media");
    expect(visualAt(tl, 4.5)).toMatchObject({ kind: "graphic", layout: "full" });
  });

  it("zoom alternado troca a cada corte e a cada frase", () => {
    const tl = buildTimeline(words, empty, 6);
    expect(tl.shots.map((x) => +x.toFixed(2))).toEqual([3.82]); // um corte (pausa longa); "falar" não fecha frase
    expect(shotZoomAt(tl, 1.0)).toBe(1);
    expect(shotZoomAt(tl, 4.2)).toBe(1.2);
  });

  it("sem fala mantém o vídeo inteiro", () => {
    const tl = buildTimeline([], empty, 5);
    expect(tl.segments).toEqual([{ src0: 0, src1: 5, out0: 0 }]);
    expect(tl.chunks).toEqual([]);
  });
});

describe("safeRemovals", () => {
  it("só corta hesitação e repetição imediata", () => {
    const ws = ["eu", "eu", "acho", "que", "ahn", "tipo", "isso", "a", "gente", "a", "gente", "faz"].map((w, i) => ({ w, start: i, end: i + 0.5 }));
    expect(safeRemovals(ws, [0, 2, 4, 5, 7, 8, 11])).toEqual([0, 4, 7, 8]);
  });
});

describe("heuristicPlan / SRT", () => {
  it("reconhece hesitações sem pegar palavras", () => {
    expect(["UUU,", "hum", "Ahn...", "éé", "hmm", "Ãh"].every(isFiller)).toBe(true);
    expect(["é", "a", "um", "uma", "humano", "ah!"].filter(isFiller)).toEqual(["ah!"]);
  });

  it("remove hesitações e gera SRT no tempo editado", () => {
    const plan = heuristicPlan(words);
    expect(plan.removeWords).toEqual([1]);
    const srt = toSrt(buildTimeline(words, plan, 6));
    expect(srt.startsWith("1\n00:00:00,180 --> ")).toBe(true);
    expect(srt).not.toContain("hum");
  });
});
