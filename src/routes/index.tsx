import { createFileRoute } from "@tanstack/react-router";
import { ScriptDialog } from "@/components/ScriptDialog";
import { Teleprompter } from "@/components/Teleprompter";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { buildTimeline, outToSrc, type Asset, type GraphicType, type Layout, segmentAt, srcToOut, toSrt, wordsFromPhrases, type Plan, type Timeline, type Word } from "@/lib/edit-plan";
import { findAssets, planEdit, premount, transcribeRecording } from "@/lib/editing.functions";
import { loadFaceDetector, trackFaces, type FaceBox } from "@/lib/face";
import { drawFrame, exportVideo, loadMedia, SIZE, type Media, type Ratio } from "@/lib/render";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Video Editor — grave, ilumine e edite com IA" },
      { name: "description", content: "Grave pela webcam com Panel Light e deixe a IA inserir imagens, GIFs e legendas automaticamente." },
      { property: "og:title", content: "AI Video Editor" },
      { property: "og:description", content: "Grave pela webcam com Panel Light e deixe a IA editar seu vídeo." },
    ],
  }),
  component: Editor,
});

type Phrase = { t: number; text: string };
type Library = Awaited<ReturnType<typeof premount>>["library"];
type Result = { url: string; ratio: Ratio; tl: Timeline; media: (Media | null)[]; faces: FaceBox[]; topic: string; notes: string[] };

const ASPECT: Record<Ratio, string> = { "16:9": "16 / 9", "9:16": "9 / 16", "1:1": "1 / 1" };
const KIND: Record<Media["kind"], string> = { news: "notícia", screenshot: "print", gif: "gif", image: "imagem" };
const GRAPHIC: Record<GraphicType, string> = { number: "número", bars: "gráfico", list: "lista", compare: "comparação", steps: "passos", keyword: "palavra" };
const LAYOUT_ICON: Record<Layout, string> = { full: "■", split: "▀" };
const STEPS = ["Analisando áudio", "Entendendo o tópico", "Buscando imagens e GIFs", "Sincronizando com a fala", "Renderizando"];

const TEMPS = [
  { k: 0, name: "Vermelho", c: "#ff2a2a" },
  { k: 1900, name: "Âmbar", c: "#ff8a1f" },
  { k: 2700, name: "Quente", c: "#ffb347" },
  { k: 4300, name: "Neutra", c: "#ffe2b0" },
  { k: 6500, name: "Branca", c: "#ffffff" },
  { k: 9000, name: "Fria", c: "#8fb4ff" },
];

function Editor() {
  const [ratio, setRatio] = useState<Ratio>("16:9");
  const [light, setLight] = useState(70);
  const [panelTemp, setPanelTemp] = useState(4);
  const [ring, setRing] = useState(100);
  const [ringTemp, setRingTemp] = useState(3);
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [camError, setCamError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [script, setScript] = useState(() => {
    try {
      return localStorage.getItem("roteiro") ?? "";
    } catch {
      return "";
    }
  });
  const [scriptOpen, setScriptOpen] = useState(false);
  // Gravação parada, aguardando você assistir e decidir: regravar ou enviar para edição.
  const [review, setReview] = useState<{ url: string; dur: number } | null>(null);
  const stopAt = useRef(0);
  // Pré-montagem em segundo plano a partir do roteiro salvo (mídias já pesquisadas e conferidas).
  type Prem = { key: string; status: "running" | "ready" | "error"; library: Library; promise: Promise<Library> };
  const [prem, setPrem] = useState<Prem | null>(null);
  const premRef = useRef<Prem | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<Result | null>(null);

  const liveRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const phrases = useRef<Phrase[]>([]);
  const speech = useRef<any>(null);
  const start = useRef(0);
  const faces = useRef<ReturnType<typeof trackFaces> | null>(null);
  const transcribe = useServerFn(transcribeRecording);
  const plan = useServerFn(planEdit);
  const assets = useServerFn(findAssets);
  const prepare = useServerFn(premount);

  useEffect(() => {
    if (!script.trim() || recording || result) return;
    const key = `${ratio}|${script}`;
    if (premRef.current?.key === key) return;
    const t = setTimeout(() => {
      const promise = prepare({ data: { script, ratio } }).then((r) => r.library);
      const entry: Prem = { key, status: "running", library: [], promise };
      premRef.current = entry;
      setPrem(entry);
      promise
        .then((library) => premRef.current === entry && setPrem((premRef.current = { ...entry, status: "ready", library })))
        .catch(() => premRef.current === entry && setPrem((premRef.current = { ...entry, status: "error" })));
    }, 1500);
    return () => clearTimeout(t);
  }, [script, ratio, recording, result, prepare]);

  useEffect(() => {
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 1280, height: 720 }, audio: true })
      .then((s) => {
        streamRef.current = s;
        setCamOn(true);
        setMicOn(true);
        if (liveRef.current) liveRef.current.srcObject = s;
        void loadFaceDetector().catch(() => undefined); // já deixa o modelo pronto para a gravação
      })
      .catch(() => setCamError("Permita o acesso à câmera e ao microfone para começar."));
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [result]);

  // Ao sair da revisão, o <video> ao vivo é recriado: religa a câmera nele.
  useEffect(() => {
    if (!review && liveRef.current && streamRef.current) liveRef.current.srcObject = streamRef.current;
  }, [review]);

  useEffect(() => {
    if (!recording) return;
    const i = setInterval(() => setElapsed((Date.now() - start.current) / 1000), 200);
    return () => clearInterval(i);
  }, [recording]);

  function toggleTrack(kind: "video" | "audio") {
    const on = kind === "video" ? !camOn : !micOn;
    streamRef.current?.getTracks().filter((t) => t.kind === kind).forEach((t) => (t.enabled = on));
    kind === "video" ? setCamOn(on) : setMicOn(on);
  }

  function startRec() {
    const s = streamRef.current;
    if (!s) return;
    chunks.current = [];
    phrases.current = [];
    const r = new MediaRecorder(s);
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      const blob = new Blob(chunks.current, { type: r.mimeType || "video/webm" });
      setReview({ url: URL.createObjectURL(blob), dur: (stopAt.current - start.current) / 1000 });
    };
    r.start();
    recRef.current = r;
    start.current = Date.now();
    setElapsed(0);
    setRecording(true);
    faces.current = trackFaces(liveRef.current!, () => (Date.now() - start.current) / 1000);
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      const sr = new SR();
      sr.lang = "pt-BR";
      sr.continuous = true;
      sr.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          const text = e.results[i][0].transcript.trim();
          if (text) phrases.current.push({ t: Math.max(0, (Date.now() - start.current) / 1000 - 2), text });
        }
      };
      sr.start();
      speech.current = sr;
    }
  }

  function stopRec() {
    stopAt.current = Date.now();
    void faces.current?.then((f) => f.stop());
    speech.current?.stop();
    recRef.current?.stop();
    setRecording(false);
  }

  function discardReview() {
    if (review) URL.revokeObjectURL(review.url);
    setReview(null);
  }

  async function sendToEdit() {
    if (review) URL.revokeObjectURL(review.url);
    setReview(null);
    await process();
  }

  async function process() {
    const blob = new Blob(chunks.current, { type: recRef.current?.mimeType || "video/webm" });
    const dur = (stopAt.current - start.current) / 1000;
    const notes: string[] = [];
    const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

    setStep(0);
    let words: Word[];
    try {
      const fd = new FormData();
      fd.append("video", new File([blob], "gravacao.webm", { type: blob.type }));
      words = (await transcribe({ data: fd })).words;
    } catch (e) {
      notes.push(`Whisper local indisponível (${why(e)}). Usada a transcrição do navegador.`);
      words = wordsFromPhrases(phrases.current);
    }
    if (!words.length) notes.push("Nenhuma fala detectada: o vídeo segue sem cortes nem legendas.");

    setStep(1);
    // Se a pré-montagem deste roteiro ainda está rodando, espera por ela: é mais rápido que recomeçar.
    const p = premRef.current;
    const library: Library = words.length && p && p.key === `${ratio}|${script}` ? await p.promise.catch(() => []) : [];
    let edit: Plan = { topic: "", removeWords: [], emphasis: [], zooms: [], broll: [], titles: [], graphics: [] };
    if (words.length) {
      try {
        const r = await plan({ data: { words, script, library: library.map(({ asset: _, ...m }) => m) } });
        edit = r.plan;
        if (r.note) notes.push(r.note);
      } catch (e) {
        notes.push(`Plano de edição falhou (${why(e)}).`);
      }
    }

    setStep(2);
    const ready = edit.broll.map((b) => (b.prepared !== undefined && b.prepared >= 0 ? (library[b.prepared]?.asset ?? null) : null));
    const skip = ready.flatMap((a, i) => (a ? [i] : []));
    if (skip.length) notes.push(`${skip.length} mídia(s) reaproveitada(s) da pré-montagem.`);
    const fetched = edit.broll.length > skip.length
      ? await assets({ data: { words, plan: edit, ratio, script, skip } }).catch((e) => ({ assets: [] as (Asset | null)[], notes: [`Pesquisa de mídias falhou (${why(e)}).`] }))
      : { assets: [] as (Asset | null)[], notes: [] };
    notes.push(...fetched.notes);
    const found = { assets: ready.map((a, i) => a ?? fetched.assets[i] ?? null) };

    setStep(3);
    const tl = buildTimeline(words, edit, dur);
    const media = await Promise.all(edit.broll.map((_, i) => (found.assets[i] ? loadMedia(found.assets[i]!) : null)));
    await document.fonts.load('24px "Instrument Serif"').catch(() => undefined);

    setStep(4);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    const track = (await faces.current)?.faces ?? [];
    if (!track.length) notes.push("Nenhum rosto detectado: legendas e zoom usam a posição padrão.");
    setResult({ url: URL.createObjectURL(blob), ratio, tl, media, faces: track, topic: edit.topic, notes });
    setStep(-1);
  }

  const panelColor = TEMPS[panelTemp]!.c;
  const ringColor = TEMPS[ringTemp]!.c;
  const bg = light <= 100 ? `color-mix(in oklab, ${panelColor} ${light}%, black)` : `color-mix(in oklab, ${panelColor} ${100 - (light - 100) / 4}%, white)`;
  const onLight = light > 55 && panelTemp !== 0;
  const fg = onLight ? "text-stage" : "text-primary-foreground";
  const ringA = Math.min(1, ring / 100);

  function saveScript(text: string) {
    setScript(text);
    try {
      localStorage.setItem("roteiro", text);
    } catch {
      // sem armazenamento: o roteiro vale só nesta sessão
    }
  }

  // Com teleprompter, o palco encolhe para os dois caberem na tela, ambos com a mesma largura.
  const prompter = !!script.trim() && !result && !review && step < 0;
  const stageH = prompter ? "calc(74vh - 10rem)" : "74vh";
  const stageW = { "16:9": `min(920px, calc(${stageH} * 16 / 9 + 1rem))`, "9:16": `min(500px, calc(${stageH} * 9 / 16 + 1rem))`, "1:1": `min(500px, calc(${stageH} + 1rem))` }[ratio];

  return (
    <div className="flex min-h-screen" style={{ background: bg, transition: "background .3s" }}>
      {scriptOpen && <ScriptDialog initial={script} onClose={() => setScriptOpen(false)} onSave={(t) => (saveScript(t), setScriptOpen(false))} />}
      <aside className="w-64 shrink-0 space-y-8 border-r border-border bg-card px-6 py-7 text-card-foreground">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-base font-semibold tracking-tight">Editor</h1>
          <span className="font-mono text-[10px] text-muted-foreground">IA</span>
        </div>

        <LightControl label="Panel Light" value={light} max={200} onValue={setLight} temp={panelTemp} onTemp={setPanelTemp} />
        <LightControl label="Ring Light" value={ring} max={200} onValue={setRing} temp={ringTemp} onTemp={setRingTemp} />

        <Section label="Roteiro" right={script ? `${script.split(/\s+/).filter(Boolean).length} palavras` : undefined}>
          <button onClick={() => setScriptOpen(true)} disabled={recording} className="w-full rounded-lg border border-border py-2 text-xs font-medium hover:bg-muted disabled:opacity-40">
            {script ? "Editar roteiro" : "Escrever roteiro"}
          </button>
          {script && (
            <button onClick={() => saveScript("")} disabled={recording} className="mt-1.5 w-full py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40">
              Gravar sem roteiro
            </button>
          )}
          {script && prem && (
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              {prem.status === "running" && "Pré-montagem: pesquisando notícias, fotos e GIFs do roteiro…"}
              {prem.status === "ready" && `Pré-montagem pronta: ${prem.library.length} mídia(s) conferida(s).`}
              {prem.status === "error" && "Pré-montagem falhou; as mídias serão buscadas depois de gravar."}
            </p>
          )}
        </Section>

        <Section label="Edição">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            A IA decide a edição de cada vídeo: cortes, zoom a cada corte, legenda com destaque, títulos nos ganchos e mídias e componentes em tela cheia ou dividida.
          </p>
        </Section>

        {result && (
          <button onClick={() => setResult(null)} className="w-full rounded-lg border border-border py-2 text-xs font-medium hover:bg-muted">Nova gravação</button>
        )}
      </aside>

      <main className={`flex flex-1 flex-col items-center gap-5 p-8 ${prompter ? "justify-start pt-4" : "justify-center"}`}>
        {prompter && <Teleprompter script={script} recording={recording} width="920px" />}
        <div
          className="w-full rounded-[1.5rem] p-2 transition-all"
          style={{
            maxWidth: stageW,
            background: ring ? `color-mix(in oklab, ${ringColor} ${ringA * 100}%, transparent)` : "transparent",
            boxShadow: ring > 100 ? `0 0 ${(ring - 100) * 0.5}px ${(ring - 100) * 0.15}px ${ringColor}` : "none",
          }}
        >
          <div className="relative w-full overflow-hidden rounded-2xl bg-stage" style={{ aspectRatio: ASPECT[ratio], maxHeight: stageH }}>
            {result ? (
              <Playback result={result} />
            ) : review ? (
              <ReviewPlayer url={review.url} dur={review.dur} />
            ) : (
              <>
                <video ref={liveRef} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" />
                {camError && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-primary-foreground">{camError}</div>}
                {recording && (
                  <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-stage/60 px-3 py-1 font-mono text-xs text-primary-foreground">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rec" /> {elapsed.toFixed(0)}s
                  </div>
                )}
              </>
            )}
            {!result && !review && !camOn && <div className="absolute inset-0 grid place-items-center bg-stage text-xs text-secondary">Câmera desligada</div>}
          </div>
        </div>

        {result && <ResultPanel result={result} />}
        {review && (
          <div className="flex items-center gap-2 rounded-full border border-border bg-card p-1.5 text-card-foreground">
            <span className="px-3 text-xs text-muted-foreground">Assista à gravação</span>
            <button onClick={discardReview} className="rounded-full border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted">
              Regravar
            </button>
            <button onClick={sendToEdit} className="flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90">
              Enviar para edição
            </button>
          </div>
        )}
        {!result && !review && (
          <div className="flex items-center gap-2 rounded-full border border-border bg-card p-1.5 text-card-foreground">
            <IconBtn on={camOn} label={camOn ? "Desligar câmera" : "Ligar câmera"} onClick={() => toggleTrack("video")}>
              <path d="M3 7h11v10H3zM14 10l6-3v10l-6-3" />{!camOn && <path d="M2 2l20 20" />}
            </IconBtn>
            <IconBtn on={micOn} label={micOn ? "Desligar áudio" : "Ligar áudio"} onClick={() => toggleTrack("audio")}>
              <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />{!micOn && <path d="M2 2l20 20" />}
            </IconBtn>
            <button
              disabled={!!camError}
              onClick={recording ? stopRec : startRec}
              className="mx-1 flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-40"
            >
              <span className={`h-2.5 w-2.5 bg-rec ${recording ? "rounded-[2px]" : "rounded-full"}`} />
              {recording ? "Parar" : "Gravar"}
            </button>
            <div className="flex gap-0.5 pr-1">
              {(["16:9", "9:16", "1:1"] as Ratio[]).map((r) => (
                <button key={r} disabled={recording} onClick={() => setRatio(r)} className={`rounded-full px-2.5 py-1.5 font-mono text-[11px] transition disabled:opacity-40 ${ratio === r ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{r}</button>
              ))}
            </div>
          </div>
        )}
        <p className={`text-[11px] opacity-60 ${fg}`}>Fale sobre seu tópico — a IA insere imagens e legendas.</p>
      </main>

      {step >= 0 && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-stage/80">
          <div className="w-72 rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-4 font-display text-sm font-semibold">Editando seu vídeo</h2>
            <ul className="space-y-2 text-xs">
              {STEPS.map((s, i) => (
                <li key={s} className={i <= step ? "text-foreground" : "text-muted-foreground"}>
                  <span className="mr-2 inline-block w-3">{i < step ? "✓" : i === step ? "•" : ""}</span>{s}
                </li>
              ))}
            </ul>
            <div className="mt-5 h-0.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-foreground transition-all duration-700" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultPanel({ result }: { result: Result }) {
  const { tl } = result;
  const [copied, setCopied] = useState(false);
  const [render, setRender] = useState<{ progress: number; file?: { url: string; name: string }; error?: string }>({ progress: 0 });

  // Exporta em segundo plano assim que o resultado fica pronto.
  useEffect(() => {
    const ac = new AbortController();
    let url: string | undefined;
    setRender({ progress: 0 });
    exportVideo({ url: result.url, tl, ratio: result.ratio, media: result.media, faces: result.faces, signal: ac.signal, onProgress: (p) => setRender((r) => (r.file ? r : { progress: p })) })
      .then(({ blob, ext }) => {
        url = URL.createObjectURL(blob);
        setRender({ progress: 1, file: { url, name: `video-editado.${ext}` } });
      })
      .catch((e) => !ac.signal.aborted && setRender({ progress: 0, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      ac.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [result, tl]);

  async function copy() {
    await navigator.clipboard.writeText(toSrt(tl));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const original = tl.segments.at(-1)?.src1 ?? tl.duration;
  // Mídias encontradas + componentes, em ordem de tempo.
  const used = [
    ...tl.broll.flatMap((b) => {
      const m = result.media[b.asset];
      return m ? [{ start: b.start, layout: b.layout, kind: KIND[m.kind], text: m.kind === "news" ? m.title : b.brief, credit: m.credit }] : [];
    }),
    ...tl.graphics.map((g) => ({ start: g.start, layout: g.layout, kind: GRAPHIC[g.type], text: [g.value, g.title, ...g.items].filter(Boolean).join(" · "), credit: "componente" })),
  ].sort((a, b) => a.start - b.start);
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const saved = Math.max(0, original - tl.duration);
  const stats = [
    n(tl.segments.length - 1, "corte", "cortes") + (saved >= 0.1 ? ` (−${saved.toFixed(1)}s)` : ""),
    n(tl.shots.length + tl.zooms.length, "zoom", "zooms"),
    n(tl.titles.length, "título", "títulos"),
    n(result.media.filter(Boolean).length, "mídia", "mídias"),
    n(tl.graphics.length, "componente", "componentes"),
  ];

  return (
    <div className="w-full max-w-[920px] rounded-2xl border border-border bg-card p-5 text-card-foreground">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Transcrição</span>
          <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{[result.topic, ...stats].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={copy} disabled={!tl.chunks.length} className="rounded-full border border-border px-4 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40">{copied ? "Copiado ✓" : "Copiar legenda"}</button>
          {render.file ? (
            <a href={render.file.url} download={render.file.name} className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background hover:opacity-90">Baixar vídeo</a>
          ) : (
            <span className="rounded-full bg-muted px-4 py-1.5 font-mono text-xs text-muted-foreground" title={render.error}>
              {render.error ? "Falha ao renderizar" : `Renderizando ${Math.round(render.progress * 100)}%`}
            </span>
          )}
        </div>
      </div>
      <ul className="max-h-40 space-y-1.5 overflow-auto text-sm">
        {tl.chunks.map((c) => (
          <li key={c.start} className="flex gap-3">
            <span className="w-10 shrink-0 font-mono text-[11px] leading-5 text-muted-foreground">{srcToOut(tl, c.start).toFixed(1)}s</span>
            <span>{c.words.map((w, i) => <span key={i} className={w.emph ? "font-semibold" : undefined}>{i ? " " : ""}{w.w}</span>)}</span>
          </li>
        ))}
      </ul>
      {used.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
          {used.map((u) => (
            <li key={`${u.start}-${u.kind}`} className="flex gap-3">
              <span className="w-10 shrink-0 font-mono text-[11px] leading-5 text-muted-foreground">{srcToOut(tl, u.start).toFixed(1)}s</span>
              <span className="w-24 shrink-0 font-mono text-[10px] uppercase leading-5 text-muted-foreground">{u.kind} {LAYOUT_ICON[u.layout]}</span>
              <span className="truncate leading-5">{u.text}</span>
              <span className="ml-auto shrink-0 truncate pl-2 leading-5 text-muted-foreground">{u.credit}</span>
            </li>
          ))}
        </ul>
      )}
      {(result.notes.length > 0 || !render.file) && (
        <div className="mt-3 space-y-0.5 border-t border-border pt-3 text-[11px] text-muted-foreground">
          {!render.file && !render.error && <p>A renderização acontece em tempo real: mantenha esta aba visível até terminar.</p>}
          {result.notes.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}
    </div>
  );
}

function LightControl({ label, value, max, onValue, temp, onTemp }: { label: string; value: number; max: number; onValue: (n: number) => void; temp: number; onTemp: (n: number) => void }) {
  return (
    <Section label={label} right={`${value}%`}>
      <input type="range" min={0} max={max} value={value} onChange={(e) => onValue(+e.target.value)} className="w-full accent-foreground" />
      <div className="mt-3 flex justify-between">
        {TEMPS.map((t, i) => (
          <button key={t.k} title={t.name} aria-label={t.name} onClick={() => onTemp(i)}
            className={`h-6 w-6 rounded-full border border-border transition ${temp === i ? "ring-2 ring-foreground ring-offset-2 ring-offset-card" : "hover:scale-110"}`}
            style={{ background: t.c }} />
        ))}
      </div>
      <div className="mt-2 font-mono text-[10px] text-muted-foreground">{TEMPS[temp]!.name}{TEMPS[temp]!.k ? ` · ${TEMPS[temp]!.k}K` : ""}</div>
    </Section>
  );
}

function IconBtn({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={`grid h-9 w-9 place-items-center rounded-full transition ${on ? "hover:bg-muted" : "bg-rec/15 text-rec"}`}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
    </button>
  );
}

/**
 * Revisão da gravação crua, espelhada como a câmera ao vivo (e como o vídeo final). Controles
 * próprios: os nativos do <video> sairiam espelhados junto.
 */
function ReviewPlayer({ url, dur }: { url: string; dur: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const toggle = () => {
    const v = ref.current!;
    if (v.paused) void v.play();
    else v.pause();
  };
  return (
    <div className="relative h-full">
      <video
        ref={ref}
        src={url}
        autoPlay
        playsInline
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        className="h-full w-full -scale-x-100 cursor-pointer object-cover"
      />
      <button onClick={toggle} className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-stage/60 px-3 py-1 font-mono text-xs text-primary-foreground">
        {playing ? "❚❚" : "▶"} {t.toFixed(1)}s{dur ? ` / ${dur.toFixed(1)}s` : ""}
      </button>
      <div
        onClick={(e) => {
          if (!dur) return;
          const r = e.currentTarget.getBoundingClientRect();
          ref.current!.currentTime = ((e.clientX - r.left) / r.width) * dur;
        }}
        className="group absolute inset-x-0 bottom-0 h-3 cursor-pointer"
      >
        <div className="absolute inset-x-0 bottom-0 h-1 bg-stage/50 transition-all group-hover:h-1.5">
          <div className="h-full bg-primary-foreground" style={{ width: `${dur ? Math.min(100, (t / dur) * 100) : 0}%` }} />
        </div>
      </div>
    </div>
  );
}

/** Prévia: toca a gravação pulando os cortes e desenha o quadro editado no canvas. */
function Playback({ result }: { result: Result }) {
  const { tl } = result;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [W, H] = SIZE[result.ratio];

  useEffect(() => {
    const v = videoRef.current!, ctx = canvasRef.current!.getContext("2d")!;
    let raf = 0, shown = -1;
    const loop = () => {
      let src = v.currentTime;
      const seg = segmentAt(tl, src);
      if (!seg) v.pause();
      else if (src < seg.src0 && !v.seeking) v.currentTime = src = seg.src0;
      drawFrame(ctx, { video: v, tl, t: src, ratio: result.ratio, media: result.media, faces: result.faces });
      const out = srcToOut(tl, src);
      if (Math.abs(out - shown) > 0.1) setT((shown = out));
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [result, tl]);

  function toggle() {
    const v = videoRef.current!;
    if (!v.paused) return v.pause();
    if (!segmentAt(tl, v.currentTime)) v.currentTime = tl.segments[0]?.src0 ?? 0;
    void v.play();
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    videoRef.current!.currentTime = outToSrc(tl, ((e.clientX - r.left) / r.width) * tl.duration);
  }

  return (
    <div className="relative h-full">
      <video ref={videoRef} src={result.url} autoPlay playsInline onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} className="hidden" />
      <canvas ref={canvasRef} width={W} height={H} onClick={toggle} className="h-full w-full cursor-pointer object-cover" />
      <button onClick={toggle} className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-stage/60 px-3 py-1 font-mono text-xs text-primary-foreground">
        {playing ? "❚❚" : "▶"} {t.toFixed(1)}s / {tl.duration.toFixed(1)}s
      </button>
      <div onClick={seek} className="group absolute inset-x-0 bottom-0 h-3 cursor-pointer">
        <div className="absolute inset-x-0 bottom-0 h-1 bg-stage/50 transition-all group-hover:h-1.5">
          <div className="h-full bg-primary-foreground" style={{ width: `${tl.duration ? (t / tl.duration) * 100 : 0}%` }} />
        </div>
      </div>
    </div>
  );
}

function Section({ label, right, children }: { label: string; right?: string | undefined; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-medium uppercase tracking-wider">{label}</span>
        {right && <span className="font-mono text-foreground">{right}</span>}
      </div>
      {children}
    </div>
  );
}
