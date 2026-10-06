import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { generateScript } from "@/lib/editing.functions";

type Source = { fact: string; url: string };

/** Escrever, colar ou gerar com a IA o roteiro que vai para o teleprompter. */
export function ScriptDialog({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (text: string) => void }) {
  const generate = useServerFn(generateScript);
  const [text, setText] = useState(initial);
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await generate({ data: { topic, audience, seconds } });
      setText(r.script);
      setSources(r.sources);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const words = text.split(/\s+/).filter(Boolean).length;
  const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-stage/70 p-6" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-auto rounded-2xl border border-border bg-card p-6 text-card-foreground" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-base font-semibold">Roteiro</h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {words} palavras · ~{Math.round((words / 200) * 60)}s
          </span>
        </div>

        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <input className={field} placeholder="Tema (ex.: IA no atendimento de restaurantes)" value={topic} onChange={(e) => setTopic(e.target.value)} />
          <input className={field} placeholder="Público (opcional)" value={audience} onChange={(e) => setAudience(e.target.value)} />
          <select className={field} value={seconds} onChange={(e) => setSeconds(+e.target.value)}>
            {[30, 45, 60, 90].map((s) => (
              <option key={s} value={s}>
                {s}s
              </option>
            ))}
          </select>
        </div>
        <button onClick={run} disabled={busy || !topic.trim()} className="rounded-lg bg-foreground py-2 text-sm font-medium text-background disabled:opacity-40">
          {busy ? "Pesquisando e escrevendo… (até 1 min)" : "Gerar roteiro com IA"}
        </button>
        {error && <p className="text-xs text-destructive">{error}</p>}

        <textarea
          className={`${field} min-h-64 font-display text-base leading-relaxed`}
          placeholder="Ou cole/escreva seu roteiro aqui. Uma ideia por parágrafo."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {sources.length > 0 && (
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <span className="font-medium uppercase tracking-wider">Fontes</span>
            {sources.map((s) => (
              <p key={s.url + s.fact} className="truncate">
                {s.fact} —{" "}
                <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                  {s.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}
                </a>
              </p>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full border border-border px-4 py-1.5 text-xs font-medium hover:bg-muted">
            Cancelar
          </button>
          <button onClick={() => onSave(text.trim())} className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background">
            Usar no teleprompter
          </button>
        </div>
      </div>
    </div>
  );
}
