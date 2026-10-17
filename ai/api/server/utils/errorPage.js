/**
 * Страница ошибки для того, кто пришёл сюда браузером, а не кодом.
 *
 * Часть эндпоинтов входа (`/oauth/**`) открывается верхнеуровневым переходом: туда
 * возвращает Keycloak после ввода пароля. Ответ `{"message":"..."}` в такой момент
 * человек видит буквально — голым JSON на белом фоне, без единого признака системы,
 * в которую он только что входил. Поэтому ответ выбирается по `Accept`: браузеру —
 * свёрстанная страница в оформлении входа Corporate, коду (fetch/axios шлют `*` или
 * `application/json`) — прежний JSON, чтобы ничего не сломать на клиенте.
 */

const RU = 'ru';
const EN = 'en';

const COPY = {
  [RU]: {
    pageTitle: 'Corporate AI',
    rateLimitTitle: 'Слишком много попыток входа',
    rateLimitOne: 'Попробуйте снова через минуту.',
    rateLimitMany: (minutes) => `Попробуйте снова через ${minutes} мин.`,
    action: 'Вернуться ко входу',
  },
  [EN]: {
    pageTitle: 'Corporate AI',
    rateLimitTitle: 'Too many sign-in attempts',
    rateLimitOne: 'Try again in a minute.',
    rateLimitMany: (minutes) => `Try again in ${minutes} min.`,
    action: 'Back to sign-in',
  },
};

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/**
 * Верхнеуровневый переход браузера просит `text/html` первым; `fetch` по умолчанию шлёт
 * `*` , axios — `application/json, text/plain, *`. Ни один из них сюда не попадает,
 * поэтому API-клиенты продолжают получать JSON.
 */
function wantsHtmlResponse(req) {
  if (req?.xhr) {
    return false;
  }
  const accept = typeof req?.get === 'function' ? req.get('accept') : req?.headers?.accept;
  return typeof accept === 'string' && accept.includes('text/html');
}

/** Язык страницы — из `Accept-Language`; по умолчанию русский, система русскоязычная. */
function pickLanguage(req) {
  const header = typeof req?.get === 'function' ? req.get('accept-language') : undefined;
  if (typeof header !== 'string' || header === '') {
    return RU;
  }
  const first = header.toLowerCase().split(',')[0]?.trim() ?? '';
  return first.startsWith('en') ? EN : RU;
}

function renderErrorPage({ lang = RU, title, description, actionHref, actionLabel }) {
  const copy = COPY[lang] ?? COPY[RU];
  const action =
    actionHref && actionLabel
      ? `<a class="nf-button" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a>`
      : '';

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${escapeHtml(title)} — ${escapeHtml(copy.pageTitle)}</title>
    <style>
      :root {
        --nf-bg: #ffffff;
        --nf-text: #212121;
        --nf-text-secondary: #424242;
        --nf-border: #e3e3e3;
        --nf-accent: #126e6b;
        --nf-accent-hover: #0a4f53;
        --nf-on-accent: #ffffff;
        color-scheme: light;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --nf-bg: #0d0d0d;
          --nf-text: #ececec;
          --nf-text-secondary: #cdcdcd;
          --nf-border: #2f2f2f;
          --nf-accent: #41a79d;
          --nf-accent-hover: #6dc8b9;
          --nf-on-accent: #0d0d0d;
          color-scheme: dark;
        }
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body {
        font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: var(--nf-bg);
        color: var(--nf-text);
      }
      .nf-page {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .nf-logo { margin: 2.5rem 0 1rem; }
      .nf-logo img { height: 42px; width: auto; display: block; }
      .nf-main {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding: 1rem;
      }
      .nf-card { width: 100%; max-width: 370px; text-align: center; }
      .nf-title {
        margin: 0 0 0.75rem;
        font-size: 1.75rem;
        font-weight: 600;
        line-height: 1.2;
      }
      .nf-text {
        margin: 0 0 1.5rem;
        font-size: 0.9375rem;
        line-height: 1.5;
        color: var(--nf-text-secondary);
      }
      .nf-button {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 3rem;
        border-radius: 1rem;
        background: var(--nf-accent);
        color: var(--nf-on-accent);
        font-size: 1rem;
        font-weight: 500;
        text-decoration: none;
        transition: background-color 0.2s;
      }
      .nf-button:hover { background: var(--nf-accent-hover); }
      .nf-button:focus-visible { outline: 2px solid var(--nf-accent); outline-offset: 2px; }
    </style>
  </head>
  <body>
    <div class="nf-page">
      <div class="nf-logo"><img src="/assets/logo.svg" alt="${escapeHtml(copy.pageTitle)}" /></div>
      <main class="nf-main">
        <div class="nf-card">
          <h1 class="nf-title">${escapeHtml(title)}</h1>
          <p class="nf-text">${escapeHtml(description)}</p>
          ${action}
        </div>
      </main>
    </div>
  </body>
</html>
`;
}

function loginUrl() {
  const domain = process.env.DOMAIN_CLIENT;
  return typeof domain === 'string' && domain !== '' ? `${domain}/login` : '/login';
}

/**
 * Ответ на срабатывание ограничителя попыток. JSON остаётся ровно тем же, что и был, —
 * меняется только то, что видит браузер.
 */
function sendRateLimitResponse(req, res, { message, windowInMinutes }) {
  if (!wantsHtmlResponse(req)) {
    return res.status(429).json({ message });
  }

  const lang = pickLanguage(req);
  const copy = COPY[lang];
  const minutes = Number(windowInMinutes);
  const description =
    Number.isFinite(minutes) && minutes > 1 ? copy.rateLimitMany(minutes) : copy.rateLimitOne;

  return res
    .status(429)
    .type('html')
    .send(
      renderErrorPage({
        lang,
        title: copy.rateLimitTitle,
        description,
        actionHref: loginUrl(),
        actionLabel: copy.action,
      }),
    );
}

module.exports = {
  escapeHtml,
  pickLanguage,
  renderErrorPage,
  sendRateLimitResponse,
  wantsHtmlResponse,
};
