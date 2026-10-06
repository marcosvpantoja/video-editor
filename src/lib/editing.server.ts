// Ajudantes só de servidor: Whisper local e plano de edição com o Claude Code local.
// Ambos rodam como processo filho — só funcionam no servidor local (npm run dev), não no runtime serverless.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import * as z from "zod/v4";
import { claudeCli } from "./claude-cli.server";
import { safeRemovals, type Plan, type Transcript, type Word } from "./edit-plan";
import { env } from "./env.server";

export async function whisperTranscribe(file: File): Promise<Transcript> {
  const dir = await mkdtemp(join(tmpdir(), "video-editor-"));
  const path = join(dir, file.name || "gravacao.webm");
  try {
    await writeFile(path, Buffer.from(await file.arrayBuffer()));
    const python = env("WHISPER_PYTHON") ?? join(process.cwd(), ".venv-whisper/bin/python");
    const args = [join(process.cwd(), "scripts/transcribe.py"), path, "--model", env("WHISPER_MODEL") ?? "small"];
    const { stdout } = await promisify(execFile)(python, args, { maxBuffer: 32 << 20, timeout: 10 * 60_000 });
    return JSON.parse(stdout) as Transcript;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const LAYOUT =
  "split = o padrão (estilo Tiago Lage): mídia na metade de cima, pessoa embaixo; full = tela cheia só para o que precisa de espaço (print de notícia com manchete, citação de pessoa com foto)";

const PlanSchema = z.object({
  topic: z.string().describe("Tópico central do vídeo, em poucas palavras"),
  remove_words: z.array(z.number()).describe("Índices de palavras a cortar: SÓ hesitações sem conteúdo (ahn, hum, éé) e a primeira ocorrência de repetições imediatas ('eu eu'); na dúvida, não corte"),
  emphasis_words: z.array(z.number()).describe("Índices das palavras de ênfase (aparecem grandes em serifa itálica): SÓ quando faz muito sentido — o número/valor central, o nome da ideia principal ou a virada; 1 a 3 palavras CONSECUTIVAS (ex.: 'R$ 5 milhões'); no máximo uma a cada ~10 s; na dúvida, nenhuma"),
  zooms: z.array(z.object({ from_word: z.number(), to_word: z.number(), strong: z.boolean() })).describe("Punch-ins de câmera nos momentos de ênfase; curtos (1 a 4 s) e espaçados"),
  broll: z
    .array(
      z.object({
        from_word: z.number(),
        to_word: z.number(),
        kind: z.enum(["news", "screenshot", "gif", "image"]).describe("news = manchete real sobre o que foi dito; screenshot = print de um site, app, perfil ou produto; gif = GIF de reação/ação que traduz a emoção ou a cena; image = foto específica (pessoa, marca, lugar, objeto, situação)"),
        brief: z.string().describe("O que exatamente deve aparecer, em português e específico ao que foi dito (ex.: 'manchete recente sobre restaurantes usando IA no atendimento', 'print da página do WhatsApp Business', 'GIF de alguém surpreso')"),
        layout: z.enum(["full", "split"]).describe(LAYOUT),
        label: z.string().describe("Rótulo escrito no topo da mídia, curto (nome da pessoa citada, nome do estudo/empresa, 'Dados x Criatividade'); vazio se não precisa"),
        text: z.string().describe("Frase escrita sobre a mídia em destaque (a citação exata de quem aparece, ou o dado-chave que a mídia prova); vazio se não precisa"),
        prepared_id: z.number().describe("Id da mídia do acervo pronto que ilustra este trecho; -1 se for preciso pesquisar outra"),
      }),
    )
    .describe("Mídias da internet: 1,5 a 4 s cada"),
  graphics: z
    .array(
      z.object({
        from_word: z.number(),
        to_word: z.number(),
        type: z.enum(["number", "bars", "list", "compare", "steps", "keyword"]).describe(
          "number = valor grande que conta até o número falado (só o número central do vídeo); bars = barras comparando valores numéricos falados; list = itens que entram um a um (enumeração explícita); compare = antes × depois explícito na fala; steps = passo a passo explícito; keyword = evite",
        ),
        title: z.string().describe("Rótulo curto do componente (ex.: 'pedidos em 3 meses', 'Como começar')"),
        value: z.string().describe("number: o valor exibido exatamente como dito, com unidade (ex.: 'R$ 5 milhões', '2x', '87%', '3 meses'); keyword: a expressão; outros: vazio"),
        items: z.array(z.string()).describe("list/steps: 2 a 5 itens curtos; compare: exatamente 2, no formato 'Título: texto' (ex.: 'Antes: atendimento manual'); bars: rótulo de cada barra; outros: vazio"),
        numbers: z.array(z.number()).describe("bars: um valor por barra, na mesma ordem de items; outros: vazio"),
        layout: z.enum(["full", "split"]).describe(LAYOUT),
      }),
    )
    .describe("Componentes animados: use POUCO (no máximo 1 a cada ~20 s), só quando a fala traz um número central ou uma estrutura explícita; prefira mídias reais"),
  titles: z
    .array(z.object({ from_word: z.number(), to_word: z.number() }))
    .describe("Frases curtas de impacto (2 a 5 palavras: ganchos, viradas, perguntas como 'Repara uma coisa:') que aparecem como título grande no lugar da legenda; no máximo 1 a cada ~15 s"),
});

const SYSTEM = `Você é editor de vídeos curtos para redes sociais (Reels, TikTok, YouTube), no estilo dos grandes criadores brasileiros de conteúdo de negócios.
Recebe a transcrição de uma gravação de webcam, palavra a palavra, no formato "índice|início(s)|palavra".
Devolva um plano de edição dinâmica com IMERSÃO ALTA: o espectador deve VER o que está sendo dito, não só ouvir.

Ritmo e cortes:
- cortes de áudio sutis: corte só hesitações sem conteúdo e repetições imediatas; nunca corte palavras do texto, conectivos ou finais de frase;
- em cada frase, destaque a expressão-chave (números, resultados, o conceito central);
- zooms só em ênfases reais (o vídeo já alterna o enquadramento a cada corte; estes são punch-ins extras);
- títulos grandes só para ganchos e viradas.

Referências de estilo, em ordem: 1) G4 — limpo, enquadramento próximo, legenda elegante, ênfase rara e certeira; 2) Tiago Lage — mídia real na metade de cima com a pessoa embaixo, título grande nos ganchos.

Elementos visuais — edição dinâmica, profissional e COERENTE:
- prioridade das mídias: 1) PRINT DE NOTÍCIA real (kind "news") sobre o fato, estudo, caso ou acontecimento falado — é o recurso principal; 2) FOTO real da pessoa citada (kind "image", brief "foto de <nome completo>", label com o nome); 3) GIF da pessoa, da marca/campanha ou do assunto exato; 4) foto específica do que foi citado;
- site/print de página (kind "screenshot") SÓ quando o próprio site/produto é o assunto do trecho e a página mostra aquilo de que se fala; nunca a home de uma empresa só porque ela foi citada;
- componentes animados criados: raros (no máximo 1 a cada ~20 s), só para o número central ou uma estrutura explícita (antes × depois, passos); nunca no lugar de uma notícia ou foto que exista;
- abra o vídeo com impacto: nos primeiros 2 s, uma mídia forte ligada ao gancho, com título;
- cubra 50% a 70% da duração, trocando a cada 2 a 4 s; a pessoa sozinha nos momentos pessoais e na chamada final;
- cada mídia ilustra exatamente o trecho falado naquele instante; toda escolha precisa ser entendida pelo espectador em 2 segundos;
- toda pessoa citada aparece em foto; se ela disse algo, a frase vai em text;
- elementos não se sobrepõem no tempo; alterne tipos (nunca 3 iguais seguidos);
- nada genérico, decorativo ou só "relacionado de longe".
Use apenas índices que existam na transcrição.`;

export type Prepared = { kind: string; brief: string; label: string; text: string; layout: string };

export async function claudePlan(words: Word[], script = "", library: Prepared[] = []): Promise<Plan> {
  const transcript = words.map((w, i) => `${i}|${w.start.toFixed(2)}|${w.w}`).join("\n");
  // O roteiro corrige nomes que a transcrição erra ("Hau Argoçage" → Howard Gossage); os índices
  // e tempos continuam vindo da transcrição.
  const shelf = library.length
    ? `\n\nAcervo de mídias JÁ PRONTAS e conferidas (pesquisadas a partir do roteiro). Sempre que um trecho falar disso, use a mídia do acervo (prepared_id = id) com o mesmo kind; só peça mídia nova (prepared_id = -1) para o que o acervo não cobre:\n${library.map((m, i) => `${i}. [${m.kind}] ${m.brief}${m.label ? ` — ${m.label}` : ""}`).join("\n")}`
    : "";
  const prompt = (script.trim()
    ? `Roteiro que a pessoa leu (use para corrigir nomes próprios, números e termos que a transcrição errou; a fala pode diferir):\n${script}\n\nTranscrição:\n${transcript}`
    : transcript) + shelf;
  const raw = await claudeCli<unknown>({ prompt, system: SYSTEM, schema: z.toJSONSchema(PlanSchema) });
  const p = PlanSchema.parse(raw);

  const ok = (i: number) => Number.isInteger(i) && i >= 0 && i < words.length;
  return {
    topic: p.topic,
    removeWords: safeRemovals(words, p.remove_words.filter(ok)),
    emphasis: p.emphasis_words.filter(ok),
    zooms: p.zooms.filter((z) => ok(z.from_word) && ok(z.to_word)).map((z) => ({ from: z.from_word, to: z.to_word, strong: z.strong })),
    broll: p.broll.filter((b) => ok(b.from_word) && ok(b.to_word)).map((b) => ({
      from: b.from_word,
      to: b.to_word,
      kind: b.kind,
      brief: b.brief,
      layout: b.layout,
      label: b.label,
      text: b.text,
      prepared: Number.isInteger(b.prepared_id) && b.prepared_id >= 0 && b.prepared_id < library.length ? b.prepared_id : -1,
    })),
    titles: p.titles.filter((x) => ok(x.from_word) && ok(x.to_word)).map((x) => ({ from: x.from_word, to: x.to_word })),
    graphics: p.graphics.filter((g) => ok(g.from_word) && ok(g.to_word)).map(({ from_word, to_word, ...g }) => ({ from: from_word, to: to_word, ...g })),
  };
}
