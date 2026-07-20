# PokéPlanner development

## Requirements

- Node.js 22.17.1
- npm 11.5.1
- Git

## Local checks

```powershell
npm ci
npm run data:sync
npm run data:compile
npm run data:verify
npm run check
npm run dev
```

`data:sync` checks out the pinned BSD-licensed PokeAPI `api-data` revision under `.cache/`. The browser never reads that cache directly; the compiler writes validated, hashed static assets under `public/data/firered/`.

`data:compile` runs the deterministic FireRed compiler: it reads the pinned source, applies the curated FireRed overlays, validates provenance and cross-file references, and emits the immutable pack (386 species, 354 moves, 17 types) plus the v2 content-addressed `manifest.json` and the research report under `data/research/firered/`. Every emitted file is canonical (recursively key-sorted, newline-terminated) so repeat builds are byte-identical. `builtAt` is the pinned source timestamp, never a wall clock.

`data:verify` recomputes the expected bytes in memory and fails if any committed pack or report file differs. It reads only the files the compiler emits and rewrites nothing, so it never inspects unrelated working-tree files. A second `data:compile` produces byte-identical output and `data:verify` passes immediately after it.

## Hosting base path

Export `VITE_BASE_PATH` in the shell or CI build environment before building. The exported app uses that value as its asset and route base path; it defaults to `/`, while `/PokePlanner/` is required for a project GitHub Pages deployment. The current Vite configuration does not load `.env` files.

The approved FireRed design is in `docs/superpowers/specs/2026-07-19-fire-red-vertical-slice-design.md`.
