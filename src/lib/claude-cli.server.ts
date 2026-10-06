// Chama o Claude Code instalado na máquina em modo não interativo (`claude -p`). Usa o login do
// próprio Claude Code (assinatura), sem API key — por isso só funciona rodando local.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { env } from "./env.server";

type Options = {
  prompt: string;
  system: string;
  schema: object;
  /** Ferramentas liberadas, ex.: ["WebSearch", "WebFetch"]. Nenhuma por padrão. */
  tools?: string[];
  timeoutMs?: number;
  /** Pasta de trabalho (onde o Read pode abrir arquivos). Padrão: pasta temporária do sistema. */
  cwd?: string;
};

export async function claudeCli<T>(o: Options): Promise<T> {
  const tools = o.tools ?? [];
  const args = [
    "-p",
    "--output-format", "json",
    // O validador do CLI não conhece o "$schema" que o zod coloca; o resto do schema é aceito.
    "--json-schema", JSON.stringify({ ...o.schema, $schema: undefined }),
    "--model", env("CLAUDE_MODEL") ?? "sonnet",
    "--effort", "medium",
    "--system-prompt", o.system,
    "--tools", tools.join(","),
    ...(tools.length ? ["--allowedTools", ...tools] : []),
    // Contexto mínimo: sem CLAUDE.md, configurações, MCPs, skills ou histórico de sessão.
    "--setting-sources", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
  ];
  const childEnv = { ...process.env };
  delete childEnv["ANTHROPIC_API_KEY"]; // garante o login da assinatura, nunca uma chave solta

  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(env("CLAUDE_BIN") ?? "claude", args, { cwd: o.cwd ?? tmpdir(), env: childEnv });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Claude Code demorou demais para responder."));
    }, o.timeoutMs ?? 5 * 60_000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Não foi possível executar o Claude Code (${e.message}). Ele está instalado e logado?`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Claude Code saiu com código ${code}: ${(stderr || stdout).slice(0, 300)}`));
    });
    child.stdin.end(o.prompt);
  });

  const r = JSON.parse(out) as { is_error?: boolean; result?: string; structured_output?: T };
  if (r.is_error || r.structured_output === undefined) throw new Error(`Claude Code não devolveu o formato esperado: ${String(r.result).slice(0, 300)}`);
  return r.structured_output;
}
