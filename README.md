# AI Video Editor

Editor de vídeo com IA que roda no navegador e **na sua máquina, sem nenhuma API key**. Você grava pela webcam, a própria tela vira iluminação e, ao parar, a IA transcreve, corta pausas e vícios de linguagem, cria legendas animadas, aplica zooms e busca na web as mídias de apoio (notícias, prints, GIFs e imagens) para cada momento da fala.

## Destaques

- **Gravação com iluminação por software:** Panel Light e Ring Light com cor, temperatura e intensidade, em 16:9, 9:16 ou 1:1
- **Transcrição local** com Whisper e tempo por palavra
- **Plano de edição com Claude** (via Claude Code local): cortes sutis, ênfases, zooms e momentos de b-roll
- **Mídias reais pesquisadas na web:** manchete e imagem da notícia, print da página pelo Chrome headless, GIF do GIPHY, imagens do Wikimedia
- **Legendas palavra a palavra** e componentes animados (números, barras, listas, comparações)
- **Exportação no navegador** (canvas + MediaRecorder) em MP4 ou WebM

```text
Gravar → Whisper (transcrição) → Claude (plano de edição) → Claude + web (mídias) → linha do tempo → prévia e exportação
```

## Como rodar

```sh
npm install
npm run setup:whisper   # uma vez (precisa de python3.12 e ffmpeg)
npm run dev             # precisa do Claude Code instalado e logado (`claude`)
```

---

# Documentação técnica

O restante deste documento reúne os requisitos do projeto: as regras fixas de produto, o que já está implementado e como configurar um backend gerenciado para publicar o app.


## 1. Visão geral

| | |
|---|---|
| **Produto** | AI Video Editor |
| **Público** | Criadores de conteúdo (YouTube, TikTok), marketing e educadores |
| **Problema** | Editar vídeo consome tempo na busca por imagens de apoio, e gravar pelo computador costuma resultar em vídeo mal iluminado |
| **Solução** | Iluminação via software (a própria tela) + edição automática por IA (transcrição, busca de imagens, legendas) |
| **Fase atual** | Funcional localmente: IA real com Whisper e Claude Code rodando na máquina |
| **Plataforma** | Navegador desktop (foco em telas de MacBook) |

---

## 2. Stack

- **Framework:** TanStack Start v1 (React 19, Vite, SSR)
- **Roteamento:** TanStack Router, arquivos em `src/routes/`
- **Estilo:** Tailwind CSS v4, tokens em `src/styles.css`
- **Linguagem:** TypeScript
- **IA:** Whisper local (transcrição), Claude Code local sem API key (plano de edição + pesquisa web), Chrome headless (prints), GIPHY (GIFs, sem chave)
- **Backend:** funções de servidor do próprio TanStack Start; banco/armazenamento ainda não. Ver [seção 6](#6-como-configurar-o-backend)

Comandos:

```sh
npm i
npm run setup:whisper   # uma vez: cria .venv-whisper com o openai-whisper (precisa de ffmpeg e python3.12)
# precisa do Claude Code instalado e logado (`claude`); nenhuma API key
npm run dev      # ambiente local
npm run build    # build de produção
npm run lint     # verificação de código
npm run test     # testes
```

---

## 3. Requisitos de produto (regras fixas)

Estas regras foram definidas no decorrer do projeto e **não devem mudar** sem um pedido explícito.

### 3.1 Gravação e câmera

- Captura pela webcam nativa com `getUserMedia` (1280×720) e gravação com `MediaRecorder`.
- **Proporção** escolhida antes de gravar: `16:9`, `9:16`, `1:1`. A troca é imediata e bloqueada durante a gravação.
- **Câmera e áudio ligam e desligam** sem parar a gravação: cada botão altera `track.enabled` da faixa correspondente. Ao obter uma nova stream, os dois voltam a "ligado".
- **Todos os controles de gravação ficam juntos** na mesma barra, abaixo do vídeo: botão de câmera, botão de áudio, botão Gravar/Parar e os três formatos. Nada desses controles vai para a barra lateral.
- Se a câmera estiver desligada, o palco mostra o aviso "Câmera desligada". Se o acesso for negado, o aviso pede permissão e o botão Gravar fica desabilitado.
- Cronômetro da gravação em `JetBrains Mono`, no canto superior esquerdo.

### 3.2 Iluminação

Dois controles independentes, ambos na barra lateral, cada um com **intensidade de 0% a 200%** e **seis cores prontas** (temperaturas variadas, da mais quente à mais fria):

| # | Nome | Temperatura | Cor |
|---|---|---|---|
| 1 | Vermelho | — | `#ff2a2a` |
| 2 | Âmbar | 1900 K | `#ff8a1f` |
| 3 | Quente | 2700 K | `#ffb347` |
| 4 | Neutra | 4300 K | `#ffe2b0` |
| 5 | Branca | 6500 K | `#ffffff` |
| 6 | Fria | 9000 K | `#8fb4ff` |

As cores **não podem ser pastéis**: a lista acima é a aprovada. A primeira opção é obrigatoriamente um vermelho.

**Panel Light** (fundo atrás do usuário):
- 0% = **preto absoluto** (`#000`). Não é "apagar o efeito", é fundo preto.
- 0–100%: a cor de temperatura aparece cada vez mais forte sobre o preto — em `color-mix(in oklab, COR X%, black)`.
- 100–200%: vai clareando em direção ao branco — em `color-mix(in oklab, COR (100 − (X−100)/4)%, white)`. Serve para iluminar o rosto com força acima do branco neutro.
- Quando o fundo fica claro (acima de 55%, exceto o vermelho), o texto do palco troca para a cor de contraste.

**Ring Light** (anel de brilho ao redor do palco):
- 0% = anel apagado.
- 0–100%: o anel ganha a cor com opacidade proporcional (`ring / 100`).
- 100–200%: além da cor, soma um halo difuso (`box-shadow` com espalhamento proporcional ao excesso).
- O anel é o contorno externo do container do vídeo; não cobre o vídeo.

### 3.3 Linguagem de edição (automática)

Não há seletor de estilo: a IA monta cada vídeo combinando as referências em `~/Downloads/Referências` (Rafael Censon, Tiago Lage, G4, Fernando Miranda). A meta é **imersão alta**: o espectador vê o que está sendo dito.

- **Zoom a cada corte**: enquadramento alterna aberto (1×) / fechado (1,2×) a cada corte e começo de frase, troca seca; punch-ins extras nas ênfases (até 1,4×).
- **Legenda** (G4): branca com contorno escuro e sombra, centrada na altura do peito, palavras surgem conforme são ditas; a expressão-chave de cada frase em `Instrument Serif` itálica grande.
- **Títulos nos ganchos** (Tiago Lage): frases curtas de impacto em `Bricolage Grotesque` 700 no alto à esquerda.
- **Referências, em ordem**: 1) G4 (limpo, ênfase rara e certeira); 2) Tiago Lage (mídia real em cima, pessoa embaixo, título nos ganchos).
- **Prioridade das mídias**: print de notícia real > foto da pessoa citada > GIF da pessoa/marca/assunto > foto específica. Print de site só quando o próprio site é o assunto (nunca a home de uma empresa só por ela ter sido citada). Componentes criados são raros (≤ 1 a cada ~20 s); ênfase na legenda só quando faz muito sentido (≤ 1 a cada ~10 s).
- **Elementos visuais em 50–70% do vídeo**, trocando a cada 2–4 s:
  - **Mídias da internet**: notícia real, print de site (rolando), foto específica (zoom lento), GIF. Podem levar **rótulo** no topo e **frase** em destaque em amarelo (nome + citação de quem aparece, estudo + dado) — Rafael Censon.
  - **Componentes animados** com visual de relatório (papel claro, barras azul-marinho, marca-texto amarelo nos títulos, seta amarela no dado principal): número que conta, barras, lista, comparação ("Já que / Então"), passos, palavra-chave.
- **Layouts**: **tela dividida** (padrão: elemento em cima, pessoa embaixo) ou **tela cheia** (notícia com manchete, citação com foto). **Divisão sempre na horizontal.**
- **Animações**: na tela dividida, a pessoa desliza da tela cheia para a metade de baixo enquanto o elemento desce (e volta no fim); em tela cheia, notícia/site sobem como janela, foto entra com zoom e desfoque, GIF desliza de lado, componente cresce do centro — tudo com mola e saída animada. Comparação: cartões de lados opostos, selo "VS", risco no "antes", marca-texto e pulso no "depois".
- **Nunca overlay**: nada flutua sobre a pessoa (card/overlay foi removido a pedido e não deve voltar).

### 3.3.1 Roteiro e teleprompter

- **Roteiro** (barra lateral → Escrever roteiro): colar/escrever ou **gerar com IA** a partir de tema, público e duração. O Claude Code local pesquisa fatos reais e escreve na estrutura gancho → contexto → provas (número, pessoa, caso, site, notícia) → virada → chamada; as fontes aparecem abaixo do texto. Fica salvo no navegador.
- **Teleprompter**: logo acima da ring light, com a **mesma largura do bloco de transcrição** (até 920 px), mostrando **3 linhas** por vez; a palavra atual em amarelo, as já ditas apagadas. Controles de **velocidade** (110–280 palavras/min) e **tamanho do texto** (16–44 px), lembrados entre sessões. Começa do início ao gravar; ▶ ensaia sem gravar.
- O roteiro também vai para o plano e para a pesquisa como **grafia correta de nomes** (a transcrição erra nomes próprios).
- **Pré-montagem**: 1,5 s depois de salvar o roteiro (ou trocar a proporção), a IA planeja a edição sobre o texto e já pesquisa, baixa e confere as mídias em segundo plano; o andamento aparece na barra lateral. Depois de gravar, o plano real reaproveita esse acervo (`prepared_id`) e só pesquisa o que faltar.

### 3.3.2 Rosto

- Reconhecimento facial no navegador (MediaPipe BlazeFace, `src/lib/face.ts`) durante a gravação, 5×/s.
- **Legenda e títulos nunca cobrem o rosto**: se colidirem, descem para baixo do queixo; sem espaço, sobem acima da cabeça (inclusive na tela dividida).
- O enquadramento e os zooms centralizam no rosto.

### 3.3.3 Sites e notícias "abertos"

- Prints e matérias aparecem numa **janela de navegador animada**: a URL é digitada, a página carrega, rola até a **manchete (h1)** e ela recebe marca-texto amarelo.
- Captura com o Chrome local controlado (`src/lib/capture.server.ts`, puppeteer-core): versão celular para tela cheia em vídeo vertical, desktop nos demais; banners de cookie/newsletter/paywall são **escondidos** (nada é clicado ou aceito).

### 3.3.4 Conferência visual das mídias

- Depois de baixar, o Claude Code **abre cada print, foto e quadro de GIF** e reprova o que não estiver carregado (branco, erro, login, paywall, pop-up cobrindo), não tiver relação com o trecho falado, mostrar a pessoa errada ou for GIF genérico sem relação. Reprovado não entra no vídeo.
- A pesquisa prioriza **matérias jornalísticas** (print da própria matéria), **fotos das pessoas citadas** e **GIFs da pessoa, marca ou assunto**; só entrega páginas que abriu e em que viu o conteúdo.
- Na captura, pop-ups com timer e diálogos de desconto/cadastro somem continuamente; a página é rolada antes do print para carregar imagens, e o editor nunca rola até a faixa vazia no fim.

### 3.3.5 Texto vivo

- Cada palavra da legenda entra com um "pop" (60% → 112% → 100%); a expressão-chave ganha marca-texto amarelo correndo por trás enquanto é dita.

### 3.4 Tipografia

As fontes são **pré-definidas e fixas**. Não existe (nem deve voltar a existir) seletor de fonte na interface.

| Fonte | Uso |
|---|---|
| **Bricolage Grotesque** | título, botões, cabeçalhos |
| **Inter** | toda a interface e texto corrido |
| **JetBrains Mono** | cronômetro, percentuais, tempos, nomes de cor/temperatura |
| **Instrument Serif** | expressão-chave da legenda, em itálico |
| **Inter** (600) | demais palavras da legenda |
| **Bricolage Grotesque** (700) | títulos nos ganchos e manchetes dos cards de notícia |

Carregadas por `<link>` em `src/routes/__root.tsx`; os papéis ficam nos tokens `--font-display`, `--font-body`, `--font-serif`, `--font-mono` em `src/styles.css`.

### 3.5 Cor da marca

**Não há seletor de cor da marca.** A cor principal foi removida do projeto. Nada de tons de marca, gradientes decorativos, brilhos ou sombras de enfeite.

### 3.6 Resultado depois de gravar

Ao parar a gravação:

0. **Revisão**: a gravação aparece no palco (espelhada, com play/pausa e linha do tempo próprias) para você assistir. **Regravar** descarta e volta para a câmera; **Enviar para edição** começa o processamento. Nada é transcrito ou pesquisado antes disso.
1. Modal de processamento com as cinco etapas, uma por vez: **Analisando áudio → Entendendo o tópico → Buscando imagens e GIFs → Sincronizando com a fala → Renderizando**, com barra de progresso.
2. O **vídeo editado** aparece no palco (com imagens e legendas por cima, conforme o estilo escolhido).
3. **Logo abaixo do vídeo**, o painel "Transcrição" lista a narração com o tempo de cada frase.
4. Dois botões de exportação:
   - **Baixar vídeo** — arquivo `video-editado.webm`.
   - **Copiar legenda** — copia a transcrição no formato **SRT** para a área de transferência e confirma com "Copiado ✓".

Formato SRT gerado:

```text
1
00:00:00,000 --> 00:00:04,000
primeira frase falada
```

Cada frase dura 4 segundos. O tempo é o instante em que a frase foi finalizada, adiantado em 2 segundos (compensa o atraso do reconhecimento de fala).

### 3.7 Interface

- **Minimalista, com design bem aplicado.** Uma barra lateral estreita (256 px) para luz e estilo; o resto da tela é o palco de vídeo.
- Sem cor de marca, sem enfeites, sem tipografia decorativa.
- Botões de luz: seis bolinhas de cor, com anel de seleção; a intensidade aparece em porcentagem no cabeçalho da seção.

---

## 4. Requisitos não funcionais

- **Fluidez:** a imagem da câmera não pode ter atraso visível.
- **Preview em tempo real:** qualquer mudança (proporção, luz, estilo) reflete na hora.
- **Sem instalação:** funciona no navegador, sem conta.
- **Idioma:** interface e transcrição em português do Brasil.
- **Acesso à internet:** necessário para buscar as imagens de apoio.

---

## 5. O que já funciona

| Parte | Estado |
|---|---|
| Captura da webcam e gravação | **Real** (`MediaRecorder`) |
| Liga/desliga de câmera e áudio | **Real** (`track.enabled`) |
| Panel Light e Ring Light (cor, temperatura, 0–200%) | **Real** |
| Proporção 16:9 / 9:16 / 1:1 | **Real** |
| Transcrição | **Real, local** — Whisper (`scripts/transcribe.py`) com tempo por palavra. Se o Whisper falhar, cai no reconhecimento do navegador |
| Plano de edição | **Real** — Claude (`claude-sonnet-5-5`, saída estruturada) escolhe cortes de vícios/repetições, palavras de ênfase, zooms e os momentos de mídia, cada um com tipo (notícia, print, GIF, imagem) e o que mostrar. Sem `ANTHROPIC_API_KEY`, regra local (`heuristicPlan`) **sem mídias** |
| Cortes de áudio | **Sutis** — só pausas acima de 0,6 s saem, com 0,18 s de respiro antes da fala e 0,25 s depois; palavras só são removidas se forem hesitação ("ahn", "hum") ou repetição imediata ("eu eu"); fade de 30 ms em cada corte no arquivo exportado |
| Legendas | **Real** — palavra a palavra (até 4 por bloco), palavra atual sublinhada, ênfases maiores |
| Zoom / punch-in | **Real** — 1,12× ou 1,25× com rampa de 0,18 s, centrado no rosto |
| Mídias de apoio | **Real** — o Claude Code local pesquisa na web (WebSearch + WebFetch) uma referência concreta para cada momento. O servidor então baixa: **notícia** → manchete, veículo e imagem da matéria (`og:image`); **print** → captura da página com o Chrome local; **GIF** → página/busca do GIPHY em MP4 (sem chave); **imagem** → URL direta, `og:image` da página ou Wikimedia Commons. Nada de imagem aleatória: sem referência confiável, o momento fica sem mídia. Tudo volta como data URL (sem CORS no canvas) |
| Componentes animados | **Real** — número, barras, lista, comparação, passos, palavra-chave (`src/lib/graphics.ts`) |
| IA | **Claude Code local** (`claude -p` com o login da máquina, sem API key) — `src/lib/claude-cli.server.ts` |
| Etapas do modal | **Reais** — cada etapa corresponde a uma chamada |
| Prévia | **Canvas** — a mesma função de desenho (`drawFrame`) da exportação |
| **Arquivo baixado** | **O vídeo editado** — montado no navegador (canvas + `MediaRecorder`), MP4 quando o navegador suporta, senão WebM |

Limites conhecidos:

- A exportação roda em tempo real (1 min de vídeo ≈ 1 min) e começa sozinha quando a prévia aparece; mudar o estilo reinicia. Com a aba oculta o navegador pode economizar a decodificação, então o ideal é manter a aba visível.
- O Whisper roda como processo filho: funciona no `npm run dev` local, **não** no runtime serverless do Lovable/Cloudflare. Para publicar, `transcribeRecording` precisa trocar o processo local por uma API de transcrição.
- Modelo `small` do Whisper: ~7 s para 15 s de fala num Mac. `WHISPER_MODEL=medium` é mais preciso e mais lento.

### Fluxo

```text
Gravar → MediaRecorder
  → transcribeRecording (Whisper local)      → palavras com tempo
  → planEdit (Claude)                        → cortes, ênfases, zooms, b-roll
  → findAssets (Claude + web)                → notícia / print / GIF / imagem por momento
  → buildTimeline                            → trechos mantidos + legendas + zooms
  → prévia em canvas + exportação no navegador
```

## 6. Como configurar o backend

### 6.1 Passo 0 — ativar o backend gerenciado

Nenhum backend está conectado ao projeto. Antes de qualquer coisa, ative o **Lovable Cloud** (Cloud → ativar). Isso libera, sem configuração externa:

- banco de dados com controle de acesso por linha;
- armazenamento de arquivos (gravações e vídeos prontos);
- logins de usuário;
- funções de servidor para chamadas autenticadas a serviços de IA.

A ativação gera os clientes em `@/integrations/supabase/*` — eles **não existem antes** de ativar o Cloud, e importar um deles antes quebra o build.

### 6.2 Regras que o backend precisa respeitar

- **Toda lógica interna do app usa funções de servidor** (`createServerFn` de `@tanstack/react-start`), chamadas do componente com `useServerFn`. Não usar `fetch()` manual no endereço de uma função de servidor: elas usam um protocolo interno de serialização.
- **Rotas HTTP cruas** (`src/routes/api/...`) só para chamadores externos: webhooks, cron, ou endpoints que precisam devolver `Response` direto.
- **Chaves secretas só dentro do corpo do handler** (`process.env['NOME']`), nunca no topo do módulo — no topo o valor vem `undefined` e pode vazar para o pacote do navegador.
- **Nada de `Math.random()`, `crypto.randomUUID()` ou I/O no escopo global** dos arquivos que entram no servidor: isso quebra o ambiente de execução em produção.
- **Organização dos arquivos:**
  - `src/lib/<nome>.functions.ts` — funções de servidor que a interface importa;
  - `src/lib/<nome>.server.ts` — ajudantes que só o servidor pode ver;
  - nunca colocar funções de servidor que a interface importa dentro de `src/server/`.
- **Ambiente de execução do servidor:** é um runtime serverless sem Node completo. **Não há `ffmpeg`, `sharp`, `canvas`, `puppeteer`, nem processo filho disponível**, e não há um servidor Node para recorrer. A montagem de vídeo **não roda aqui** — precisa chamar um serviço externo por HTTP (ver 6.4) ou ser feita no próprio navegador.
- **Valores de `process.env`** só importam dentro de handler; para o navegador use `import.meta.env.VITE_*` (e nunca com nome de chave secreta).
- **Toda tabela criada** precisa de `GRANT` no mesmo arquivo de migração, antes das políticas de acesso — só a política não basta.
- **Uploads de arquivo usam a API de armazenamento**, com o bucket criado pela ferramenta própria (não por SQL).

### 6.3 Variáveis de ambiente e chaves

| Nome | De onde vem | Uso |
|---|---|---|
| `LOVABLE_API_KEY` | já provisionada pelo Lovable Cloud | chamadas ao Gateway de IA (transcrição, análise de tópico, geração de texto) |
| `IMAGE_SEARCH_API_KEY` | você obtém (Unsplash, Pexels ou Bing Images) | busca real de fotos por palavra-chave |
| `RENDER_API_URL`, `RENDER_API_KEY` | você obtém (serviço de renderização de vídeo) | montagem final do vídeo |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | gerados ao ativar o Cloud | acesso autenticado ao banco e ao armazenamento |
| `SUPABASE_SERVICE_ROLE_KEY` | gerado ao ativar o Cloud | apenas operações privilegiadas, dentro do handler |

Guarde essas chaves pelo cofre de segredos do projeto (não em `.env` no repositório). Depois de mudar um segredo usado por uma função de servidor, publique o app para que a versão publicada veja o valor novo; a prévia já usa o valor atualizado na hora.

### 6.4 Contrato das funções de servidor

Quatro operações, na ordem em que o usuário as vê. Os nomes de tipo abaixo são os que a interface já usa hoje (`Cue = { t: number; text: string; keyword: string }`), então a migração é só trocar a simulação pela chamada.

**1. `transcribeRecording` — substitui o reconhecimento do navegador**

```ts
// entrada
{ videoPath: string; duration: number; language?: "pt-BR" }
// saída
{ cues: Cue[]; language: string }
```

Recebe a gravação já salva no armazenamento e devolve a transcrição com o instante de cada frase. Mantém a regra atual: o tempo devolvido é o instante da frase finalizada, adiantado 2 s, e cada frase dura 4 s. Sem fala, devolve lista vazia e a interface decide se mostra as frases de demonstração.

**2. `analyzeTopic` — alimenta a etapa "Entendendo o tópico"**

```ts
// entrada
{ cues: Cue[] }
// saída
{ topic: string; keywords: string[]; suggestedCaptions: { t: number; text: string }[] }
```

Troca a heurística local de palavra-chave por análise real. A saída precisa continuar preenchendo `keyword` em cada frase, porque é dela que depende a busca de imagem.

**3. `findAssets` — substitui `loremflickr` / `picsum`**

```ts
// entrada
{ cues: Cue[]; perCue?: 1 }
// saída
{ assets: { cueIndex: number; url: string; type: "image" | "gif" | "screenshot"; attribution?: string }[] }
```

Regras: só mídias que correspondem ao que foi dito (nunca aleatórias), crédito da fonte sempre, e o momento fica sem mídia quando não há referência confiável. Implementado em `src/lib/media.server.ts`.

**4. `renderVideo` — a etapa que ainda não existe**

```ts
// entrada
{ videoPath: string; cues: Cue[]; assets: Asset[]; ratio: "16:9" | "9:16" | "1:1";
  captions: { font: "Instrument Serif"; sizePx: number; background: "neutral-dark" } }
// saída
{ jobId: string }
```

Depois, uma função de consulta (`getRenderStatus`) devolve `{ status: "queued" | "running" | "done" | "error"; url?: string; error?: string }` até o vídeo ficar pronto, e o botão **Baixar vídeo** passa a apontar para essa URL em vez do arquivo cru.

A montagem tem que reproduzir o que a prévia mostra:

- A linguagem descrita na seção 3.3 (zoom a cada corte, legenda com destaque, títulos, elementos em tela cheia ou dividida). Hoje isso já é feito no navegador por `drawFrame` em `src/lib/render.ts`; um serviço externo teria de reproduzir essa função.

**Onde a montagem roda:** como o runtime do servidor não tem `ffmpeg`, escolha uma das rotas:

- **Serviço externo de renderização** (recomendado): `renderVideo` envia a gravação + a lista de legendas/imagens por HTTP para um serviço que devolve o arquivo pronto, e o resultado é salvo no armazenamento. É a única rota que escala e que gera arquivo de verdade para qualquer navegador.
- **Montagem no próprio navegador:** desenhar o vídeo e as mídias em um `<canvas>` e gravar com `MediaRecorder`. Não precisa de backend nem de custo, mas só funciona enquanto a aba fica aberta e depende do desempenho da máquina do usuário.

As etapas do modal de edição devem passar a refletir o progresso real dessas quatro operações, e não mais um atraso fixo de 900 ms.

### 6.5 Banco de dados e armazenamento sugeridos

**Buckets de armazenamento** (privados, com políticas por linha):

- `raw-recordings` — a gravação original;
- `rendered-videos` — o vídeo montado;
- `captions` — arquivos `.srt` gerados.

**Tabelas** (sempre com `GRANT` no mesmo arquivo de migração):

```sql
CREATE TABLE public.renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  source_path text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  style text NOT NULL,
  ratio text NOT NULL,
  cues jsonb NOT NULL DEFAULT '[]',
  assets jsonb NOT NULL DEFAULT '[]',
  output_path text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.renders TO authenticated;
GRANT ALL ON public.renders TO service_role;
ALTER TABLE public.renders ENABLE ROW LEVEL SECURITY;
CREATE POLICY renders_owner ON public.renders
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
```

E, se o app ganhar contas e histórico:

```sql
CREATE TABLE public.recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  path text NOT NULL,
  duration numeric NOT NULL,
  transcript jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recordings TO authenticated;
GRANT ALL ON public.recordings TO service_role;
ALTER TABLE public.recordings ENABLE ROW LEVEL SECURITY;
CREATE POLICY recordings_owner ON public.recordings
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
```

Se as gravações forem do usuário, as funções de servidor que as acessam precisam da verificação de sessão (`requireSupabaseAuth`), e a interface precisa enviar o token nas chamadas — isso já é configurado em `src/start.ts` ao ativar o Cloud.

### 6.6 Fluxo de dados com o backend ativo

```text
Gravar (navegador)
   → MediaRecorder gera a gravação
   → upload para o bucket raw-recordings
   → transcribeRecording  →  cues
   → analyzeTopic         →  tópico e palavras-chave
   → findAssets           →  uma mídia por frase
   → renderVideo          →  jobId (serviço externo de montagem)
   → getRenderStatus      →  URL do vídeo montado
   → prévia no palco + transcrição abaixo
   → Baixar vídeo (arquivo montado) / Copiar legenda (SRT)
```

---

## 7. Checklist para deixar o app de verdade

- [ ] Ativar o Lovable Cloud
- [ ] Criar os buckets `raw-recordings`, `rendered-videos`, `captions`
- [ ] Aplicar as migrações `renders` e `recordings` (com os `GRANT`s)
- [ ] Salvar `IMAGE_SEARCH_API_KEY` e as chaves de renderização no cofre de segredos
- [ ] Criar `src/lib/editing.functions.ts` com `transcribeRecording`, `analyzeTopic`, `findAssets`, `renderVideo`, `getRenderStatus`
- [ ] Enviar a gravação ao armazenamento ao parar de gravar
- [ ] Ligar as cinco etapas do modal ao progresso real
- [ ] Fazer o botão "Baixar vídeo" servir o arquivo montado
- [ ] Manter a simulação atual como reserva quando não houver chave configurada

---

## 8. Onde está o quê

| Arquivo | Conteúdo |
|---|---|
| `src/routes/index.tsx` | Interface do editor: gravação, luzes, estilo, pipeline de IA, prévia, painel de resultado |
| `src/lib/edit-plan.ts` | Modelo puro da edição: linha do tempo, cortes, legendas, zooms, b-roll, SRT (testado em `src/test/edit-plan.test.ts`) |
| `src/lib/render.ts` | Desenho em canvas (`drawFrame`) e exportação (`exportVideo`) |
| `src/lib/editing.functions.ts` | Funções de servidor: `transcribeRecording`, `planEdit`, `findAssets` |
| `src/lib/editing.server.ts` | Whisper (processo filho) e plano de edição com Claude |
| `src/lib/media.server.ts` | Pesquisa de mídias com Claude + web e resolvedores (matéria, print, GIPHY, Wikimedia) |
| `src/lib/graphics.ts` | Componentes animados (visual de relatório) |
| `src/lib/claude-cli.server.ts` | Chamada ao Claude Code local (`claude -p`, saída estruturada) |
| `scripts/transcribe.py` | Whisper local com tempo por palavra |
| `src/routes/__root.tsx` | Estrutura da página, `<head>` e o `<link>` das quatro fontes |
| `src/styles.css` | Tokens de cor e de fonte, animação das legendas |

Nada de `src/App.tsx`, `src/pages/` ou `react-router-dom`: este projeto é TanStack Start, e essas convenções não existem aqui.

---

Desenvolvido por **Marcos Pantoja** · [29Tech](https://www.vintenove.com)
