// Pesquisa de mídias de apoio: o Claude lê o que foi dito, pesquisa na web e escolhe, para cada
// momento, a referência concreta (notícia, site, GIF, imagem). Depois o servidor baixa cada uma.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Asset, MediaKind, Plan, Word } from "./edit-plan";
import { capturePage } from "./capture.server";
import { claudeCli } from "./claude-cli.server";
import { env } from "./env.server";

type Pick = { moment: number; kind: MediaKind; page_url: string; image_url: string; title: string; source: string; search_terms: string };

const SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["moment", "kind", "page_url", "image_url", "title", "source", "search_terms"],
          properties: {
            moment: { type: "integer", description: "Número do momento" },
            kind: { type: "string", enum: ["news", "screenshot", "gif", "image"] },
            page_url: { type: "string", description: "news: URL da matéria; screenshot: URL exata da página a capturar; gif: URL da página do GIF no GIPHY (giphy.com/gifs/...); image: página onde a imagem está. Vazio se não houver" },
            image_url: { type: "string", description: "URL direta de um arquivo de imagem (jpg/png/webp) quando você tiver certeza dela. Vazio se não" },
            title: { type: "string", description: "news: manchete exata da matéria; outros: descrição curta do que aparece" },
            source: { type: "string", description: "Veículo ou site (ex.: 'g1', 'Exame', 'whatsapp.com')" },
            search_terms: { type: "string", description: "gif: termo em inglês para buscar o GIF (ex.: 'typing fast'); image: nome exato do que mostrar para buscar no Wikimedia (ex.: 'WhatsApp logo'). Vazio se não se aplica" },
          },
        },
      },
    },
};

const SYSTEM = `Você é pesquisador de mídias de um editor profissional de vídeos curtos em português do Brasil.
Recebe a transcrição (e às vezes o roteiro) de um vídeo e uma lista de momentos que pedem uma mídia de apoio.
Para cada momento, pesquise na web e encontre uma referência REAL, específica e COERENTE com o que está sendo dito:
- news (prioridade): a matéria jornalística real sobre exatamente o fato/estudo/caso falado, de veículo confiável (de preferência brasileiro: g1, Folha, Estadão, Exame, Valor, InfoMoney, Meio & Mensagem, StartSe…; ou o veículo internacional original). page_url = a URL da própria matéria (não a home, não a editoria).
- image de pessoa: a foto DAQUELA pessoa. Use a página dela na Wikipedia (page_url) e o nome exato em search_terms.
- image de marca/lugar/produto: a página oficial ou da Wikipedia sobre ele.
- screenshot: só a página que mostra exatamente aquilo de que se fala (o recurso, a campanha, o post, o produto) — nunca a home genérica de uma empresa só porque ela foi citada; se não houver página assim, troque por notícia ou foto.
- gif: um GIF do GIPHY que mostre a pessoa citada, a marca/campanha citada (ex.: "will it blend"), uma cena famosa do assunto, ou a situação exata descrita. Reação genérica só se ela traduz exatamente o momento. page_url = URL da página do GIF (giphy.com/gifs/...); search_terms = termo em inglês, específico.
Regras:
- ABRA cada página com WebFetch antes de entregar e confirme que tem o conteúdo relevante carregado (sem paywall total, login, erro ou página vazia). Só entregue páginas em que você viu o conteúdo.
- Nunca use página de resultados de busca (google.com/search, bing.com/search…) como page_url.
- Seja coerente: tudo no vídeo deve ser sobre as pessoas, empresas e fatos da fala.
- Entregue um item para cada momento quando houver referência real; se a exata não existir, troque o tipo por outro igualmente coerente (sem matéria → site oficial; sem foto → GIF da marca/assunto). Omita se nada coerente existir: melhor sem mídia do que com mídia aleatória.
Responda só com a lista final, no formato pedido.`;

/** `only`: índices de momentos a pesquisar (os demais já têm mídia, p. ex. da pré-montagem). */
export async function claudeResearch(words: Word[], plan: Plan, script = "", only?: number[]): Promise<Pick[]> {
  const todo = plan.broll.map((_, i) => i).filter((i) => !only || only.includes(i));
  if (!todo.length) return [];
  const said = (from: number, to: number) => words.slice(from, to + 1).map((w) => w.w).join(" ");
  const moments = todo.map((i) => `${i}. [${plan.broll[i]!.kind}] fala: "${said(plan.broll[i]!.from, plan.broll[i]!.to)}" → mostrar: ${plan.broll[i]!.brief}`).join("\n");
  const intro = script.trim() ? `Roteiro (grafia correta dos nomes):\n${script}\n\nTranscrição (pode ter nomes errados):` : "Transcrição completa:";
  const prompt = `Tópico: ${plan.topic || "(não informado)"}\n\n${intro}\n${words.map((w) => w.w).join(" ")}\n\nMomentos:\n${moments}`;
  const r = await claudeCli<{ items: Pick[] }>({ prompt, system: SYSTEM, schema: SCHEMA, tools: ["WebSearch", "WebFetch"], timeoutMs: 8 * 60_000 });
  const picks = (r.items ?? []).filter((p) => todo.includes(p.moment));
  console.info(`[pesquisa] ${picks.length}/${plan.broll.length} momentos:`, picks.map((p) => `${p.moment}:${p.kind} ${p.page_url || p.search_terms}`).join(" | "));
  return picks;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const MAX_BYTES = 12 << 20;

async function fetchData(url: string, accept: RegExp) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  const type = (r.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!r.ok || !accept.test(type)) throw new Error(`${url}: ${r.status} ${type}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`${url}: arquivo grande demais`);
  return `data:${type};base64,${buf.toString("base64")}`;
}

const fetchImage = (url: string) => fetchData(url, /^image\/(jpeg|png|webp|gif|avif)$/);

/** Lê og:title, og:image e og:site_name de uma página. */
async function pageMeta(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const html = (await r.text()).slice(0, 400_000);
  const meta = (prop: string) => {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i"))?.[0];
    return decode(tag?.match(/content=["']([^"']*)["']/i)?.[1] ?? "");
  };
  const image = meta("og:image") || meta("twitter:image");
  return {
    title: meta("og:title") || decode(html.match(/<title[^>]*>([^<]*)</i)?.[1] ?? "").trim(),
    site: meta("og:site_name"),
    image: image ? new URL(image, r.url).href : "",
  };
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Print com o Chrome local em modo headless. A janela é mais alta que 4:3 e o desenho recorta
 *  a partir do topo, então barras fixas no rodapé (cookies) ficam fora do quadro. */
async function screenshot(url: string) {
  const dir = await mkdtemp(join(tmpdir(), "video-editor-shot-"));
  const out = join(dir, "shot.png");
  try {
    await promisify(execFile)(
      env("CHROME_PATH") ?? CHROME,
      ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-first-run", `--user-data-dir=${dir}`, "--window-size=1280,1280", "--virtual-time-budget=6000", `--screenshot=${out}`, url],
      { timeout: 45_000 },
    );
    return `data:image/png;base64,${(await readFile(out)).toString("base64")}`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Primeira imagem do Wikimedia Commons para um termo (logos, pessoas, lugares). */
async function wikimedia(term: string) {
  const q = new URLSearchParams({ action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrlimit: "1", gsrsearch: `${term} filetype:bitmap`, prop: "imageinfo", iiprop: "url", iiurlwidth: "1024", origin: "*" });
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: { "User-Agent": "video-editor/1.0" } });
  const pages = ((await r.json()) as { query?: { pages: Record<string, { imageinfo?: { thumburl?: string; descriptionurl?: string }[] }> } }).query?.pages;
  const info = pages && Object.values(pages)[0]?.imageinfo?.[0];
  if (!info?.thumburl) throw new Error(`Wikimedia: nada para "${term}"`);
  return { url: await fetchImage(info.thumburl), credit: "Wikimedia Commons" };
}

/** MP4 de um GIF a partir da página ou do link de mídia do GIPHY (o ID fica no fim do caminho). */
async function giphyPage(url: string) {
  const id = url.match(/giphy\.com\/(?:gifs|stickers|clips)\/(?:[^/?#]*-)?([A-Za-z0-9]{8,})/)?.[1] ?? url.match(/giphy\.com\/media\/(?:v1\.[^/]+\/)?([A-Za-z0-9]{8,})\//)?.[1];
  if (!id) throw new Error(`não é um link do GIPHY: ${url}`);
  return { url: await fetchData(`https://media.giphy.com/media/${id}/giphy.mp4`, /^video\/mp4$/), credit: "GIPHY" };
}

/** Primeiro GIF da busca do site do GIPHY (sem chave), na versão MP4. */
async function giphy(term: string) {
  if (!term) throw new Error("sem termo de GIF");
  const r = await fetch(`https://giphy.com/search/${encodeURIComponent(term.trim().replace(/\s+/g, "-"))}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  const link = (await r.text()).match(/giphy\.com\/gifs\/[A-Za-z0-9-]+/)?.[0];
  if (!link) throw new Error(`GIPHY: nada para "${term}"`);
  return giphyPage(`https://${link}`);
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Tenta cada fonte em ordem até uma funcionar. */
async function first<T>(...tries: (() => Promise<T>)[]) {
  const errors: string[] = [];
  for (const t of tries) {
    try {
      return await t();
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(errors.join(" | "));
}

/** Páginas de resultado de busca não são referência: viram print de uma lista de links. */
const isSearchPage = (url: string) => /\/\/(www\.)?(google|bing|duckduckgo|yahoo)\.[^/]+\/(search|html|\?)|[?&]q=/.test(url);

/** `mobile`: print na versão celular (tela cheia em vídeo vertical); senão, desktop. */
/** Home de site ("spacex.com/") não ilustra nada específico: print só de página interna. */
const isHomePage = (url: string) => {
  try {
    return new URL(url).pathname.replace(/\/(index\.html?)?$/, "") === "";
  } catch {
    return false;
  }
};

export async function resolvePick(p: Pick, mobile = false): Promise<Asset> {
  if (p.page_url && isSearchPage(p.page_url)) p = { ...p, page_url: "" };
  if (p.kind === "screenshot" && isHomePage(p.page_url)) throw new Error(`home de site não entra: ${p.page_url}`);
  const source = p.source || host(p.page_url);
  const credit = [source, p.page_url && host(p.page_url) !== source ? host(p.page_url) : ""].filter(Boolean).join(" · ");
  const image = async (bySearch = true) => {
    const tries: (() => Promise<{ url: string; credit: string }>)[] = [];
    if (p.image_url) tries.push(async () => ({ url: await fetchImage(p.image_url), credit }));
    if (p.page_url) tries.push(async () => ({ url: await fetchImage((await pageMeta(p.page_url)).image), credit }));
    if (bySearch && p.search_terms) tries.push(() => wikimedia(p.search_terms));
    return { type: "image" as const, ...(await first(...tries)) };
  };

  if (p.kind === "news") {
    // Print da matéria aberta (com a manchete localizada) + dados para o card, se o print falhar.
    const [cap, m] = await Promise.all([capturePage(p.page_url, mobile).catch(() => null), pageMeta(p.page_url).catch(() => ({ title: "", site: "", image: "" }))]);
    if (!cap && !m.title) throw new Error(`matéria inacessível: ${p.page_url}`);
    const img = !cap && m.image ? await fetchImage(m.image).catch(() => null) : null;
    return {
      type: "news",
      title: p.title || cap?.title || m.title,
      source: source || m.site,
      image: img,
      credit: `Matéria: ${source || m.site} · ${host(p.page_url)}`,
      page: p.page_url,
      shot: cap?.image ?? null,
      mark: cap?.mark ?? null,
      mobile,
    };
  }
  if (p.kind === "screenshot") {
    return first<Asset>(
      async () => {
        const c = await capturePage(p.page_url, mobile);
        return { type: "screenshot" as const, url: c.image, credit: `Site: ${host(p.page_url)}`, page: p.page_url, mark: c.mark, mobile };
      },
      async () => ({ type: "screenshot" as const, url: await screenshot(p.page_url), credit: `Site: ${host(p.page_url)}`, page: p.page_url, mark: null, mobile: false }),
      () => image(false),
    );
  }
  // Termo de GIF ("typing fast") num banco de imagens daria foto aleatória: só cai para imagem se houver URL.
  if (p.kind === "gif")
    return first<Asset>(
      async () => ({ type: "gif" as const, ...(await giphyPage(p.page_url || p.image_url)) }),
      async () => ({ type: "gif" as const, ...(await giphy(p.search_terms)) }),
      () => image(false),
    );
  return image();
}

const VERIFY_SYSTEM = `Você é editor de vídeo e confere, olhando cada imagem, se as mídias escolhidas podem entrar no vídeo.
Aprove (ok=true) só quando a imagem:
- está carregada e legível (nada de página em branco, erro, 404, captcha, tela de login, paywall, banner de cookies cobrindo o conteúdo, só logo/menu sem conteúdo);
- mostra conteúdo claramente relacionado ao trecho falado e ao que deveria mostrar, a ponto de o espectador entender a ligação em 2 segundos (home genérica de empresa, foto de produto sem relação com o fato, página institucional vaga = reprovar);
- se deveria ser uma pessoa: aprove um retrato/foto reconhecível DAQUELA pessoa (não precisa ser do evento citado); reprove se for outra pessoa ou se a mesma foto já apareceu em outro arquivo;
- print de site: reprove página inicial/institucional genérica que não mostra exatamente o que é falado;
- notícia: aprove se for sobre o MESMO fato/assunto e as mesmas pessoas/empresas, mesmo que a manchete use outras palavras, outro ângulo ou seja de outro veículo; reprove só se for de outro assunto ou se a página não mostrar a matéria;
- se é um GIF, tem a ver com as pessoas, a marca, o assunto ou a situação exata do trecho (reação genérica sem relação = reprovar).
Abra cada arquivo com a ferramenta Read antes de decidir. Seja exigente com página quebrada, pessoa errada e mídia sem relação; não reprove por detalhe de redação.`;

const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "ok", "reason"],
        properties: { file: { type: "integer" }, ok: { type: "boolean" }, reason: { type: "string", description: "Motivo curto" } },
      },
    },
  },
};

/** Bytes de uma imagem representativa da mídia (para GIF, um quadro do MP4). */
async function previewOf(a: Asset, dir: string, i: number): Promise<string | null> {
  const dataUrl = a.type === "news" ? (a.shot ?? a.image) : a.url;
  if (!dataUrl) return null;
  const [head, b64] = dataUrl.split(",");
  const buf = Buffer.from(b64!, "base64");
  if (a.type === "gif") {
    const mp4 = join(dir, `${i}.mp4`), jpg = join(dir, `${i}.jpg`);
    await writeFile(mp4, buf);
    await promisify(execFile)("ffmpeg", ["-y", "-loglevel", "error", "-nostdin", "-ss", "0.6", "-i", mp4, "-frames:v", "1", jpg], { timeout: 20_000 });
    return jpg;
  }
  const ext = head!.includes("png") ? "png" : head!.includes("webp") ? "webp" : "jpg";
  const file = join(dir, `${i}.${ext}`);
  await writeFile(file, buf);
  return file;
}

/**
 * Conferência visual: o Claude Code abre cada mídia e reprova página não carregada, conteúdo
 * irrelevante, pessoa errada e GIF sem relação. Devolve um veredito por item, na mesma ordem.
 */
export async function verifyAssets(items: { asset: Asset; expected: string; said: string }[]) {
  const verdicts = items.map(() => ({ ok: true, reason: "" }));
  if (!items.length) return verdicts;
  const dir = await mkdtemp(join(tmpdir(), "video-editor-check-"));
  try {
    const files = await Promise.all(items.map((it, i) => previewOf(it.asset, dir, i).catch(() => null)));
    const listed = items.flatMap((it, i) => (files[i] ? [`Arquivo ${i}: ${files[i]}\n  tipo: ${it.asset.type}\n  deveria mostrar: ${it.expected}\n  trecho falado: "${it.said}"`] : []));
    // Sem imagem para conferir: só passa o card de notícia (manchete + veículo, sem foto).
    files.forEach((f, i) => !f && (verdicts[i] = { ok: items[i]!.asset.type === "news", reason: "sem imagem para conferir" }));
    if (!listed.length) return verdicts;
    const r = await claudeCli<{ results: { file: number; ok: boolean; reason: string }[] }>({
      prompt: listed.join("\n\n"),
      system: VERIFY_SYSTEM,
      schema: VERIFY_SCHEMA,
      tools: ["Read"],
      cwd: dir,
      timeoutMs: 4 * 60_000,
    });
    for (const v of r.results) if (verdicts[v.file]) verdicts[v.file] = { ok: v.ok, reason: v.reason };
    return verdicts;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
