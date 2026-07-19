# PokéPlanner development

## Requirements

- Node.js 22
- npm 11
- Git

## Local checks

```powershell
npm ci
npm run data:sync
npm run check
npm run dev
```

`data:sync` checks out the pinned BSD-licensed PokeAPI `api-data` revision under `.cache/`. The browser never reads that cache directly; later compiler plans write validated static packs under `public/data/`.

## Hosting base path

Export `VITE_BASE_PATH` in the shell or CI build environment before building. It defaults to `/`; set it to `/PokePlanner/` for a project GitHub Pages deployment. The current Vite configuration does not load `.env` files.

The approved FireRed design is in `docs/superpowers/specs/2026-07-19-fire-red-vertical-slice-design.md`.
