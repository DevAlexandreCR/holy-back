# HolyVerso Web Landing

Static ad-campaign landing page for HolyVerso: three files (`index.html`, `styles.css`, `script.js`) plus `assets/`, with no build step. Everything in this folder is publicly served. It is served by Express static middleware in development (see `holy-back/src/app.ts`) and by nginx in production.

## Files and assets

```
web/
├── index.html                       # Markup, copy, structural data-* hooks
├── styles.css                       # Mobile-first styles, brand tokens, motion
├── script.js                        # Platform routing, tracking, sticky bar, deep links
├── .well-known/
│   └── apple-app-site-association   # iOS universal links config, served at /.well-known/...
└── assets/
    ├── favicon.svg                  # Favicon referenced by index.html
    ├── logo-96.webp                 # Logo, WebP, 1x
    ├── logo-192.webp                # Logo, WebP, 2x
    ├── logo-192.png                 # Logo, PNG fallback for <picture>
    ├── og-image.png                 # Open Graph / Twitter card image
    └── fonts/
        └── inter-latin-var.woff2    # Inter variable font, Latin subset, self-hosted
```

The Inter variable font comes from `@fontsource-variable/inter` 5.3.0 and is distributed under the SIL Open Font License 1.1. It is self-hosted (no Google Fonts request) and loaded with `font-display: swap` from the `@font-face` rule in `styles.css`.

A duplicate `apple-app-site-association` file also exists directly under `web/` (not inside `.well-known/`); the one Apple's universal links resolver actually reads is `/.well-known/apple-app-site-association`, which `app.ts` mounts explicitly with `dotfiles: 'allow'`.

## Page structure

`index.html` is a single page with these sections, in order:

- **hero** (`#hero`) — headline, "Gratis. Sin anuncios." line, one download action (`#hero-cta`), and an HTML/CSS phone mock of the home screen showing the HolyVerso widget.
- **cómo funciona** (`#how`) — three steps: download, create an account and add the widget, get a new verse automatically.
- **widget en tu pantalla de inicio** (`#widget-context`) — the small and medium widget sizes shown in context.
- **confianza** (`#trust`) — the free/no-ads statement and up to four `<details>` questions.
- **cierre** (`#cierre`) — closing headline and a second download action.
- **footer** (`.site-footer`) — copyright line and the privacy link.

Outside the document flow:

- **sticky bar** (`#sticky-cta`) — bottom download bar shown on mobile once the hero button scrolls out of view.
- **in-app hint** (`#inapp-hint`) — hidden by default; shown when a store tap does not leave an in-app browser.

## Configuration meta tags

Two `<meta>` tags in `index.html` act as the page's only configuration:

- `hv-meta-pixel-id` — Meta (Facebook/Instagram) Pixel ID. When empty, `script.js` never injects the Meta Pixel loader and no request is made to any Meta domain. When set, the pixel loads asynchronously and sends `PageView` on load.
- `hv-privacy-url` — URL of the privacy policy. When empty, the footer's `#privacy-link` stays `hidden` (a global `[hidden] { display: none !important; }` rule in `styles.css` keeps it a zero-size, unreachable element, overriding the component's own `display` declaration). When set, `script.js` sets its `href` and reveals it.

Both are plain text edits; there is no templating or environment-variable injection for the static files.

## Markup and script contract

`script.js` expects these hooks to exist in the markup (set by `index.html`, read or toggled by the script):

- `[data-store-pair]` with `data-placement="hero" | "closing" | "sticky" | "inapp_hint"` — wraps one App Store anchor and one Google Play anchor.
- `a[data-store="app-store"]`, `a[data-store="google-play"]` — the store anchors inside each pair.
- `<html data-platform="ios" | "android">` — set by script after user-agent detection; CSS uses it to show only the matching store anchor in each pair. Absent (no script, or an undetected platform) means both anchors show.
- `#hero-cta` — the hero's download wrapper, observed to decide when to reveal the sticky bar.
- `#cierre` — the closing section, observed to hide the sticky bar again.
- `#sticky-cta` — the sticky bar; script toggles the `is-visible` class on it.
- `#inapp-hint` — the in-app browser hint; starts `hidden`, revealed by script.
- `#privacy-link` — the footer privacy link; starts `hidden`, revealed and pointed at `hv-privacy-url` by script.
- `body[data-lp-variant="home_widget"]` — the landing-page variant value, read by `getBaseContext()` and forwarded to the store redirect.

## Tracking

### Store redirect

Every store anchor points at `/out/app-store` or `/out/google-play` (handled in `holy-back/src/modules/landing/landingRedirect.routes.ts`). `script.js` rewrites each anchor's query string on load (`rewriteStoreLinks()`) to carry: `cta_placement`, `target_platform`, `entry_context`, `lp_variant`, `landing_session_id`, and any captured `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` / `share_token`. The backend logs every hit before redirecting to the real store URL.

`cta_placement` values seen in the markup and script: `hero`, `closing`, `sticky`, `inapp_hint` (from each pair's `data-placement`), plus two values set programmatically for the open-in-app flow: `hero_deep_link` (tap on the hero button once it has been relabelled to open the app) and `deep_link_auto` (the automatic app-open attempt fired on page load when a deep link is present, not a tap).

### Meta Pixel events

When `hv-meta-pixel-id` is set:

- `PageView` — fired once on load, from `initMetaPixel()`.
- `Lead` — fired on every store-anchor tap, from `wireStoreTaps()`, with `content_name` set to the store (`app-store` / `google-play`), `content_category` set to the placement, and a per-tap unique `eventID`. The tap handler never calls `preventDefault` and never awaits the pixel call, so the store redirect always proceeds.

### `dataLayer` / `gtag` events

`trackEvent(name, params)` sends to `window.gtag` when present, otherwise pushes to `window.dataLayer`. Events fired by `script.js`:

- `landing_view` — once, after all setup runs.
- `store_redirect` — on every store-anchor tap.
- `store_open_stalled` — when the in-app browser hint is shown.
- `deep_link_attempt` / `deep_link_fallback` — around the open-in-app flow described below.

## Open-in-app flow

When the page loads at `/reset-password` (with its query string) or with a `?deeplink=holyverso://...` parameter, and the user agent is a phone, `script.js`:

1. Relabels the hero's primary store anchor to "Abrir en la app" and points it at the `holyverso://` deep link.
2. Attempts the deep link immediately (`openAppWithStoreFallback()`), firing `deep_link_attempt`.
3. If the page is still visible after 2 seconds (the app did not open), falls back to the tracked store redirect for the detected platform and fires `deep_link_fallback`.

An ordinary visit with no deep-link context shows the plain store download action, as described in the markup/script contract above.

The `/reset-password` path only reaches `script.js` when the web server itself serves `index.html` for that URL. In production, nginx's `try_files $uri $uri/ /index.html;` (see `docs/back/publish.md`) falls back to `index.html` for any unmatched path, including `/reset-password`. The Express backend in this repo has no such fallback: `app.ts` serves `index.html` only at `GET /`, so `/reset-password` returns 404 when running through `docker compose` locally. To exercise this flow locally, serve `web/` with a static server that falls back to `index.html` for unmatched paths (for example `npx serve -s web`), not the Docker backend.

Separately, inside the Instagram or Facebook in-app browser (`INAPP_BROWSER_PATTERN` matches `Instagram`, `FBAN`, `FBAV`), if the page is still visible 2 seconds after any store-anchor tap, `#inapp-hint` is revealed with instructions to open the page in the external browser, and `store_open_stalled` is tracked.

## Motion and reduced motion

Motion in `styles.css` is limited to: the hero's three-verse widget sequential fade loop (each verse fades out fully before the next fades in; the two are never visible at once), a one-time hero entrance, the sticky bar's slide transition, button press feedback, and the native `<details>` marker rotation. Animations use only `transform` and `opacity`; hover/press feedback also changes `background-color`. There is no `transition: all`, no parallax, and no particle effects.

Under `@media (prefers-reduced-motion: reduce)`, the widget shows its first verse statically, the hero entrance and sticky-bar transition become instant, and smooth scrolling is disabled. Hover-only effects are gated behind `@media (hover: hover) and (pointer: fine)` so they never apply on touch devices.

## Local preview

Two ways to preview, either serves the static files correctly over HTTP (never open `index.html` with `file://`: the page depends on absolute paths and on `/out/...` redirect behavior):

- **Static file server only** (fastest; store redirects and tracking will not work, since there is no backend):

  ```bash
  cd holy-back/web
  python3 -m http.server
  ```

  Then open `http://localhost:8000/`.

- **Full backend** (store redirects, outbound-click logging, and `/.well-known/...` work as in production):

  ```bash
  docker compose up -d
  ```

  Then open `http://localhost:3000/` (the `backend` service publishes container port 3000 to `127.0.0.1:3000`, per `docker-compose.yml`).
