import { createServerFn } from "@tanstack/react-start";
import { heuristicPlan, type Asset, type Plan, type Word } from "./edit-plan";
import { claudePlan, whisperTranscribe, type Prepared } from "./editing.server";
import { claudeResearch, resolvePick, verifyAssets } from "./media.server";
import { writeScript } from "./script.server";

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const transcribeRecording = createServerFn({ method: "POST" })
  .validator((data: FormData) => {
    const file = data.get("video");
    if (!(file instanceof File)) throw new Error("Envie a gravação no campo 'video'.");
    return file;
  })
  .handler(({ data }) => whisperTranscribe(data));

export const planEdit = createServerFn({ method: "POST" })
  .validator((data: { words: Word[]; script?: string; library?: Prepared[] }) => data)
  .handler(async ({ data }): Promise<{ plan: Plan; source: "claude" | "local"; note?: string }> => {
    try {
      return { plan: await claudePlan(data.words, data.script, data.library), source: "claude" };
    } catch (e) {
      return { plan: heuristicPlan(data.words), source: "local", note: `Claude indisponível (${why(e)}): cortes e destaques por regra local, sem mídias de apoio.` };
    }
  });

type Ratio = "16:9" | "9:16" | "1:1";

/**
 * Pesquisa, baixa e confere a mídia de cada momento do b-roll. `skip`: momentos que já têm mídia
 * (vinda da pré-montagem) e não precisam de nada.
 */
async function gatherAssets(data: { words: Word[]; plan: Plan; ratio: Ratio; script?: string; skip?: number[] }) {
  const assets: (Asset | null)[] = data.plan.broll.map(() => null);
  const notes: string[] = [];
  const todo = data.plan.broll.map((_, i) => i).filter((i) => !data.skip?.includes(i));
  if (!todo.length) return { assets, notes };
  let picks;
  try {
    picks = await claudeResearch(data.words, data.plan, data.script, todo);
  } catch (e) {
    return { assets, notes: [`Pesquisa de mídias falhou (${why(e)}).`] };
  }
  await Promise.all(
    picks.map(async (p) => {
      try {
        const vertical = data.ratio === "9:16" && data.plan.broll[p.moment]?.layout === "full";
        assets[p.moment] = await resolvePick(p, vertical);
      } catch (e) {
        console.warn(`[mídias] momento ${p.moment} (${p.kind}):`, why(e));
      }
    }),
  );
  // Conferência visual: só entra o que está carregado, legível e coerente com a fala.
  const found = assets.flatMap((a, i) => (a ? [i] : []));
  try {
    const said = (i: number) => data.words.slice(data.plan.broll[i]!.from, data.plan.broll[i]!.to + 1).map((w) => w.w).join(" ");
    const verdicts = await verifyAssets(found.map((i) => ({ asset: assets[i]!, expected: [data.plan.broll[i]!.brief, data.plan.broll[i]!.label].filter(Boolean).join(" — "), said: said(i) })));
    found.forEach((i, n) => {
      if (verdicts[n]!.ok) return;
      console.info(`[conferência] momento ${i} reprovado: ${verdicts[n]!.reason}`);
      assets[i] = null;
    });
    const dropped = verdicts.filter((v) => !v.ok).length;
    if (dropped) notes.push(`${dropped} mídia(s) descartada(s) na conferência visual (página não carregada ou sem relação com a fala).`);
  } catch (e) {
    notes.push(`Conferência visual indisponível (${why(e)}); mídias usadas sem conferir.`);
  }
  const missing = todo.filter((i) => !assets[i]).length;
  if (missing) notes.push(`${missing} de ${todo.length} momentos pesquisados ficaram sem mídia: nenhuma referência confiável.`);
  return { assets, notes };
}

/** Pesquisa na web uma referência real para cada momento do b-roll e baixa a mídia. */
export const findAssets = createServerFn({ method: "POST" })
  .validator((data: { words: Word[]; plan: Plan; ratio: Ratio; script?: string; skip?: number[] }) => data)
  .handler(({ data }): Promise<{ assets: (Asset | null)[]; notes: string[] }> => gatherAssets(data));

/**
 * Pré-montagem a partir do roteiro salvo, antes de gravar: planeja a edição sobre o texto (tempos
 * estimados) e já pesquisa, baixa e confere as mídias. Na gravação, o plano real reaproveita isso.
 */
export const premount = createServerFn({ method: "POST" })
  .validator((data: { script: string; ratio: Ratio }) => {
    if (!data.script.trim()) throw new Error("Roteiro vazio.");
    return data;
  })
  .handler(async ({ data }) => {
    const words: Word[] = data.script.split(/\s+/).filter(Boolean).map((w, i) => ({ w, start: i * 0.3, end: i * 0.3 + 0.28 }));
    const plan = await claudePlan(words, data.script);
    const { assets, notes } = await gatherAssets({ words, plan, ratio: data.ratio, script: data.script });
    // Só interessa o que foi encontrado: a lista vira o "acervo" do vídeo.
    const library = plan.broll.flatMap((b, i) => (assets[i] ? [{ kind: b.kind, brief: b.brief, label: b.label, text: b.text, layout: b.layout, asset: assets[i]! }] : []));
    return { library, notes };
  });

/** Gera o roteiro para o teleprompter a partir de um tema. */
export const generateScript = createServerFn({ method: "POST" })
  .validator((data: { topic: string; audience: string; seconds: number }) => {
    if (!data.topic.trim()) throw new Error("Informe o tema do vídeo.");
    return { ...data, seconds: Math.min(180, Math.max(20, data.seconds || 60)) };
  })
  .handler(({ data }) => writeScript(data));
