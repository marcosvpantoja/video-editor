import { useEffect, useLayoutEffect, useRef, useState } from "react";

const LINES = 3;
const read = (k: string, d: number) => {
  try {
    const v = Number(localStorage.getItem(k));
    return v > 0 ? v : d;
  } catch {
    return d;
  }
};
const save = (k: string, v: number) => {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    // sem armazenamento: só não lembra a preferência
  }
};

/**
 * Teleprompter acima da ring light, na largura do quadro de vídeo: mostra 3 linhas por vez e
 * avança no ritmo escolhido (palavras por minuto). Roda sozinho enquanto grava; fora da gravação,
 * dá para ensaiar com o play.
 */
export function Teleprompter({ script, recording, width }: { script: string; recording: boolean; width: string }) {
  const [wpm, setWpm] = useState(() => read("tp-wpm", 190));
  const [size, setSize] = useState(() => read("tp-size", 26));
  const [rehearsing, setRehearsing] = useState(false);
  const [word, setWord] = useState(0);
  const [offset, setOffset] = useState(0);
  const textRef = useRef<HTMLDivElement>(null);
  const words = script.split(/\s+/).filter(Boolean);
  const running = recording || rehearsing;
  const lineH = Math.round(size * 1.35);

  // Começa do início a cada gravação.
  useEffect(() => {
    if (recording) setWord(0);
  }, [recording]);

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let acc = 0;
    const i = setInterval(() => {
      const now = performance.now();
      acc += ((now - last) / 60000) * wpm;
      last = now;
      if (acc >= 1) {
        const step = Math.floor(acc);
        acc -= step;
        setWord((w) => Math.min(words.length - 1, w + step));
      }
    }, 50);
    return () => clearInterval(i);
  }, [running, wpm, words.length]);

  // Mantém a linha da palavra atual como a primeira das 3 visíveis.
  useLayoutEffect(() => {
    const el = textRef.current?.querySelector<HTMLElement>(`[data-w="${word}"]`);
    if (el) setOffset(Math.max(0, el.offsetTop - 0));
  }, [word, size, width, script]);

  const set = (k: string, v: number, f: (n: number) => void) => {
    f(v);
    save(k, v);
  };

  return (
    <div className="w-full rounded-2xl bg-stage/90 px-5 pb-2 pt-3 text-primary-foreground" style={{ maxWidth: width }}>
      <div className="relative overflow-hidden" style={{ height: lineH * LINES }}>
        <div
          ref={textRef}
          className="relative font-display font-medium transition-transform duration-500 ease-out"
          style={{ fontSize: size, lineHeight: `${lineH}px`, transform: `translateY(${-offset}px)` }}
        >
          {words.map((w, i) => (
            <span key={i} data-w={i} className={i < word ? "opacity-35" : i === word ? "text-[#ffc928]" : undefined}>
              {w}{" "}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-4 border-t border-white/10 pt-2 font-mono text-[10px] text-white/60">
        <button onClick={() => setRehearsing((r) => !r)} disabled={recording} className="rounded-full px-2 py-0.5 hover:bg-white/10 disabled:opacity-40" title="Ensaiar">
          {running ? "❚❚" : "▶"}
        </button>
        <button onClick={() => setWord(0)} className="rounded-full px-2 py-0.5 hover:bg-white/10" title="Voltar ao início">
          ↺
        </button>
        <label className="flex flex-1 items-center gap-2">
          velocidade
          <input type="range" min={110} max={280} step={5} value={wpm} onChange={(e) => set("tp-wpm", +e.target.value, setWpm)} className="w-full accent-white" />
          <span className="w-16 whitespace-nowrap text-right text-white">{wpm} ppm</span>
        </label>
        <label className="flex flex-1 items-center gap-2">
          texto
          <input type="range" min={16} max={44} value={size} onChange={(e) => set("tp-size", +e.target.value, setSize)} className="w-full accent-white" />
          <span className="w-9 text-right text-white">{size}px</span>
        </label>
      </div>
    </div>
  );
}
