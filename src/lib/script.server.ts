// Roteiro para gravar: o Claude Code local pesquisa fatos reais e escreve uma fala curta na
// estrutura das referências (gancho → contexto → prova → virada → chamada).
import { claudeCli } from "./claude-cli.server";

export type Script = { title: string; script: string; sources: { fact: string; url: string }[] };

const SYSTEM = `Você é roteirista de vídeos curtos (Reels/TikTok) de negócios em português do Brasil, no estilo de Rafael Censon, Tiago Lage, Fernando Miranda e G4.
Escreva uma FALA para a pessoa ler num teleprompter, gravando sozinha para a webcam.

Estrutura (sem rótulos no texto):
1. Gancho na primeira frase: pergunta, cena ("Imagina comigo…"), dilema ("O dilema de X é o seguinte") ou promessa concreta. Nada de "Olá, pessoal".
2. Contexto rápido do problema.
3. Provas concretas: pelo menos 3 entre número/percentual, estudo, pessoa citada com uma frase dela, empresa ou caso real, site/produto, notícia recente. Cada prova deve ser algo que dá para MOSTRAR na tela.
4. Virada: a ideia central, numa frase curta de impacto ("Repara uma coisa:").
5. Chamada final clara (comentar, seguir, link aqui embaixo).

Regras:
- pesquise na web e use só fatos verificados; guarde a fonte de cada um em sources;
- linguagem falada, frases curtas, sem jargão, sem emojis, sem marcações;
- ritmo de ~200 palavras por minuto; respeite a duração pedida;
- quebre o texto em parágrafos curtos (uma ideia por parágrafo) para facilitar a leitura no teleprompter.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "script", "sources"],
  properties: {
    title: { type: "string", description: "Título curto do vídeo" },
    script: { type: "string", description: "A fala completa, parágrafos separados por linha em branco" },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fact", "url"],
        properties: { fact: { type: "string" }, url: { type: "string" } },
      },
    },
  },
};

export function writeScript(o: { topic: string; audience: string; seconds: number }) {
  const words = Math.round((o.seconds / 60) * 200);
  const prompt = `Tema: ${o.topic}\nPúblico: ${o.audience || "donos de pequenas e médias empresas"}\nDuração: ${o.seconds} segundos (~${words} palavras)`;
  return claudeCli<Script>({ prompt, system: SYSTEM, schema: SCHEMA, tools: ["WebSearch", "WebFetch"], timeoutMs: 6 * 60_000 });
}
