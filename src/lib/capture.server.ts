// Prints de sites com o Chrome local controlado (puppeteer-core): versão celular ou desktop,
// banners de cookie/newsletter/paywall escondidos (sem clicar nem aceitar nada), e a posição da
// manchete (h1) para o editor rolar até ela e marcar em amarelo.
import puppeteer, { type Browser } from "puppeteer-core";
import { env } from "./env.server";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export type Capture = { image: string; mark: { x: number; y: number; w: number; h: number } | null; title: string };

let browser: Promise<Browser> | null = null;
const getBrowser = () => {
  browser ??= puppeteer.launch({ executablePath: env("CHROME_PATH") ?? CHROME, headless: true, args: ["--no-first-run", "--mute-audio", "--hide-scrollbars", "--disable-notifications"] }).catch((e) => {
    browser = null;
    throw e;
  });
  return browser;
};

/**
 * Roda dentro da página: esconde banners de cookie/newsletter/paywall, diálogos de desconto e camadas
 * fixas grandes que cobrem o conteúdo, e destrava a rolagem. Não clica nem aceita nada.
 */
function cleanPage() {
  if (!document.body) return;
  const junk = /cookie|consent|gdpr|lgpd|onetrust|didomi|cmp|privacy|privacidade|newsletter|paywall|modal|popup|pop-up|overlay|banner|subscribe|assine|regwall|interstitial|klaviyo|dialog|promo|offer|discount|desconto|signup|cadastre/i;
  // Janelas de diálogo (descontos, cadastro, idioma) sempre saem.
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog[open]'))) el.style.setProperty("display", "none", "important");
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const cs = getComputedStyle(el);
    const fixed = cs.position === "fixed" || cs.position === "sticky";
    const tag = `${el.id} ${typeof el.className === "string" ? el.className : ""} ${el.getAttribute("role") ?? ""} ${el.getAttribute("aria-label") ?? ""}`;
    const big = el.getBoundingClientRect().height > innerHeight * 0.18;
    // Esconde camadas fixas que cobrem o conteúdo (banners, modais, barras grudadas grandes).
    const promo = /cookie|aceit|privacidade|consent|% off|desconto|cadastre|sign up|newsletter/i.test(el.innerText?.slice(0, 300) ?? "");
    if ((fixed && (junk.test(tag) || big || promo)) || (junk.test(tag) && cs.zIndex !== "auto" && +cs.zIndex > 100)) el.style.setProperty("display", "none", "important");
  }
  for (const el of [document.documentElement, document.body]) {
    el.style.setProperty("overflow", "auto", "important");
    el.style.setProperty("position", "static", "important");
  }
}

export async function capturePage(url: string, mobile: boolean): Promise<Capture> {
  const page = await (await getBrowser()).newPage();
  try {
    if (mobile) {
      await page.setUserAgent(MOBILE_UA);
      await page.setViewport({ width: 430, height: 860, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true });
    } else await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" });
    // Limpeza contínua desde o carregamento: pop-ups com timer também somem.
    await page.evaluateOnNewDocument(`setInterval(${cleanPage.toString()}, 300)`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 25_000 }).catch(() => undefined); // páginas que nunca "assentam" seguem assim mesmo
    await new Promise((r) => setTimeout(r, 800));

    // Rola até o fim do trecho capturado e volta: carrega imagens "lazy" e dispara pop-ups com timer.
    await page.evaluate(async () => {
      const end = Math.min(document.documentElement.scrollHeight, innerHeight * 3);
      for (let y = 0; y < end; y += innerHeight * 0.8) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 250));
      }
      scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 500));
    });
    await page.evaluate(cleanPage);

    const info = await page.evaluate(() => {
      const h1 = Array.from(document.querySelectorAll("h1")).find((h) => h.getBoundingClientRect().height > 0 && h.innerText.trim().length > 8);
      const r = h1?.getBoundingClientRect();
      return {
        title: (h1?.innerText ?? document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content ?? document.title).trim(),
        mark: r ? { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } : null,
        width: document.documentElement.clientWidth,
        height: Math.max(document.documentElement.scrollHeight, innerHeight),
      };
    });

    // Até 2,5 telas de altura: o bastante para rolar até a manchete e um pouco além.
    const vh = page.viewport()!.height;
    const height = Math.min(info.height, Math.round(vh * 2.5));
    const shot = await page.screenshot({ type: "jpeg", quality: 82, clip: { x: 0, y: 0, width: info.width, height }, captureBeyondViewport: true });
    const mark = info.mark && info.mark.y < height ? { x: info.mark.x / info.width, y: info.mark.y / height, w: info.mark.w / info.width, h: info.mark.h / height } : null;
    return { image: `data:image/jpeg;base64,${Buffer.from(shot).toString("base64")}`, mark, title: info.title };
  } finally {
    await page.close().catch(() => undefined);
  }
}
