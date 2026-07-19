# PokéPlanner development

## Requirements

- Node.js 22.17.1
- npm 11.5.1
- Git

## Local checks

```powershell
npm ci
npm run data:sync
npm run data:verify
npm run check
npm run dev
```

`data:sync` checks out the pinned BSD-licensed PokeAPI `api-data` revision under `.cache/`. The browser never reads that cache directly; later compiler plans write validated static packs under `public/data/`.

`data:verify` deterministically regenerates only `public/data/firered/manifest.json` and fails if that committed file differs. It does not inspect unrelated working-tree files.

## Hosting base path

Export `VITE_BASE_PATH` in the shell or CI build environment before building. The exported app uses that value as its asset and route base path; it defaults to `/`, while `/PokePlanner/` is required for a project GitHub Pages deployment. The current Vite configuration does not load `.env` files.

The approved FireRed design is in `docs/superpowers/specs/2026-07-19-fire-red-vertical-slice-design.md`.
