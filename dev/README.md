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

## Milestone team timeline

The team planner opens in **Major Events**, where Starter and each Gym or story checkpoint can hold an explicit six-slot party plus an unbounded reserve. Use **Copy previous** to create the next major keyframe; optional active-party leveling can target five levels under, at, or five levels over the challenge level. Reserve Pokémon keep the level and configuration they had when boxed.

Switch to **Detailed Planning** to inspect the routes, towns, and dungeons between major events. These route states are calculated from the surrounding keyframes and display **Auto-filled** until edited. Editing an auto-filled route saves an **Overridden** state for that route only. Acquisition timing is respected, so a member planned for Brock does not appear on routes before its first obtainable location.

Each member keeps one identity across every checkpoint. Duplicate species are numbered in acquisition order, such as `Mankey #1` and `Mankey #2`. Removing or replacing a party member sends that same identity to Reserve. Release requires confirmation and keeps the member in the historical archive; Restore returns it to Reserve and permanently records a **Restored Pokémon** finding.

Member edits are permissive and offer a scope before applying: this milestone, this and future populated milestones, or all populated milestones. A forward slot replacement stops at a later explicit route override. Levels, evolution stage, ability, moves, held item, nature, origin, and notes remain editable without hiding conflicts.

## Warnings and sharing

Findings are advice, not save blockers. Red findings identify known conflicts, yellow findings identify conditional or noteworthy plans, Review required marks copied configuration that deserves another look, and Unverified means the current FireRed evidence is incomplete. Finding summaries and explanations are keyboard-focusable, and available resolution buttons make provenance changes—such as marking an egg-move user as hatched—explicit.

**Export run** produces deterministic, validated JSON, exposes a **Download JSON** file, and retains copyable JSON text as a fallback. JSON imports are migrated and validated before they replace the active run; a failed import leaves the existing record untouched.

**Export plan code** produces a deterministic, self-contained `PP1` code containing persistent plan state only. Paste that text into **Import plan code** in either a fresh or existing session, select **Preview plan code**, review the run name, game, member and milestone counts, and any migration or pack warnings, then confirm the import. Previewing never writes local storage, and derived routes, findings, and canonical pack records are recalculated rather than embedded in the code.
