# ComiCode Web — Mission Control

Premium browser dashboard for the ComiCode multi-provider AI coding agent.

## Install size

The dashboard reuses the **root project's** `node_modules` — Vite and
TypeScript are already installed there for the CLI build and tests. No second
`npm install`, no duplicate 45 MB download. Only ~2 MB of extra dev packages
(`react-dom`, `@types/react-dom`) are added to the root install.

## Stack

- React 19 + TypeScript + Vite 7 (all from the root `package.json`)
- Plain CSS design tokens — no component library, no UI kit, no Three.js
- Canvas 2D starfield + CSS perspective grid, glassmorphism, glow accents
- React context for state; SSE for streaming

## Run

From the **project root**:

```bash
npm install                 # one install for CLI + tests + web
npm run web:dev             # dev server on :5173, proxies /api -> :8787
npm run web:build           # emits static assets to web/dist
npm run web:check           # typecheck the dashboard
```

Then start the API/engine:

```bash
comicode serve              # API on :8787, opens the built dashboard
```

`comicode serve` serves `web/dist` when it exists; otherwise it shows a short
build hint. During development, run `comicode serve --no-open` alongside
`npm run web:dev`.

## Demo mode

Append `?demo=1` to the dashboard URL (or stop the API server). The app falls
back to a scripted demo session with staged departments, streaming text, plan
and tool events — no API keys needed.
