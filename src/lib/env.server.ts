// Lê .env.local/.env sob demanda (nunca no topo do módulo) e devolve a variável.
let loaded = false;

export function env(name: string) {
  if (!loaded) {
    loaded = true;
    for (const f of [".env.local", ".env"]) {
      try {
        process.loadEnvFile(f);
      } catch {
        // arquivo ausente: segue com o ambiente do processo
      }
    }
  }
  return process.env[name] || undefined;
}
