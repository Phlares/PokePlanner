# PokéPlanner FireRed Data and Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile and validate the complete Generation III FireRed planning catalog and deliver the static selector, chronological route workbench, milestone-aware move planning, search, 6+6 team manifest, and durable local playthrough state.

**Architecture:** A deterministic Node/TypeScript compiler reads the pinned PokeAPI `api-data` revision, applies independently curated FireRed progression and acquisition overlays, validates provenance and cross-file references, and emits immutable hashed JSON assets. The React client loads the complete pack through one manifest-first boundary, evaluates search and availability with pure domain functions, and stores only versioned user state behind an IndexedDB repository adapter.

**Tech Stack:** Node.js 22.17.1, npm 11.5.1, React 19.2.7, TypeScript 7.0.2, Vite 8.1.5, Vitest 4.1.10, Testing Library 16.3.2, Zod 4.4.3, Ajv 8.20.0, native IndexedDB, `fake-indexeddb` 6.2.4 for tests.

## Global Constraints

- Keep project code and project documentation under `dev/`; repository automation may live under `.github/`.
- Use test-driven development for every behavior change: write a focused failing test, run it and confirm the expected failure, implement the minimum behavior, run it green, then refactor.
- The production application is fully static and has no required backend or browser-time PokéAPI dependency.
- FireRed scope keys are version ID `10`, version-group ID `7`, and generation ID `3`; never treat them as interchangeable.
- Pin and consume PokeAPI `api-data` revision `0fb5313cb77f46269502e987a53a0bf751ae883d`.
- Compile all 386 species introduced in Generations I–III and all 354 moves legal in the main-series Generation III ruleset, including version-valid transfer-only records with explicit availability evidence. Exclude the 18 Orre-only Shadow moves (PokeAPI IDs `10001..10018`): they use the non-FireRed `shadow` type, have no FireRed learnset, and cannot be transferred while retained.
- Apply Generation III historical stats, types, abilities, move values, and the type-based physical/special split; exclude Hidden Abilities, Fairy, later ability slots, later evolutions, and later mechanics. Preserve Curse's Generation III `???` move type as the normalized move-only value `unknown`; it is not a Pokémon type or type-chart entry.
- Canonical data is generated at build time and emitted as immutable static assets; IndexedDB stores user state and referenced IDs only.
- Every generated or manually researched fact retains source revision, locator, import method, and confidence; provisional facts fail the verified pack build.
- Treat `pret/pokefirered` commit `df4449a27cd78dd747ce269e47d3ab4a0149d8f4` as an accuracy reference only. Do not clone it into the project, mechanically extract it into served assets, copy its source, or represent it as licensed.
- Curated facts are independently encoded from factual research. Do not copy walkthrough prose or copyrighted source layout.
- The chronology covers the main story and standard postgame through the Network Machine and Cerulean Cave. Event-only locations remain optional and explicitly gated; they do not enter the golden path.
- The interface is text-forward and grayscale, with a chronological field-ledger rail, semantic tables, visible focus, square geometry, no glow, no card wall, no filler, and no decorative product messaging.
- Do not implement opponents, exposure analysis, live-run encounter/capture checkoffs, battle or encounter simulation, damage, casualty prediction, end-to-end browser automation, or deployment; those remain Plan 3.
- Commit each task only after its focused tests and the full repository check command required by that task pass.

## Plan Boundary

This is Plan 2 of 3. It owns the complete FireRed mechanics/catalog compiler, research overlay and report, immutable pack, route/search/availability indexes, Generation III/FireRed Standard setup, timeline workbench, encounter and Pokémon inspection, current/future move planning, 6+6 team state, IndexedDB persistence, and validated export/import. It stops before scripted opponent data, exposure rules, live-run checkoffs, browser E2E, accessibility polish beyond the components changed here, and deployment.

## Locked File Structure

```text
dev/
  data/
    firered/
      sources.json                    # Research registry and licensing notes.
      progression.json                # Golden path, optional branches, milestones, and area mapping.
      acquisitions.json               # TM/HM/tutor and non-wild acquisition facts.
      evolution-overrides.json        # FireRed exclusions and National Dex gates.
    fixtures/firered-compiler/...      # Minimal endpoint-shaped RED/GREEN fixtures.
    research/firered/
      research-report.json             # Deterministic machine-readable coverage/conflict report.
      research-report.md               # Checked-in human-readable report.
  public/data/firered/
    manifest.json
    pokemon.json
    moves.json
    learnsets.json
    encounters.json
    progression.json
    acquisitions.json
    evolutions.json
    type-chart.json
    indexes/
      pokemon-by-move.json
      pokemon-by-type.json
      pokemon-by-ability.json
      routes-by-pokemon.json
      availability-by-milestone.json
  scripts/data/
    pokeapi-data-reader.ts
    firered/
      compiler-context.ts             # Version/generation assertions and source metadata.
      normalizer.ts                   # Historical Pokémon, ability, move, learnset, and type normalization.
      evolutions.ts                   # Gen III evolution filtering and FireRed overrides.
      encounters.ts                   # Version-10 encounter and method-rate normalization.
      curated.ts                      # Strict curated overlay parsing.
      indexes.ts                      # Search, route, and milestone indexes.
      validate-pack.ts                # Coverage, provenance, and referential-integrity checks.
      pack-writer.ts                  # Canonical JSON, hashes, manifest, and reports.
    compile-firered-pack.ts            # CLI and check-mode orchestration.
  src/
    domain/
      pack.ts                          # Shared Zod schemas and generated-record types.
      availability.ts                 # Pure current/future move evaluation.
      search.ts                        # Pure indexed FireRed search.
      team.ts                          # Fixed six-primary/six-reserve operations.
      playthrough.ts                   # Versioned save/import contracts and migrations.
    data/
      game-pack.ts                     # All-or-nothing manifest and asset loader.
    persistence/
      repository.ts                    # Repository contract and memory adapter.
      indexeddb-repository.ts          # Native IndexedDB implementation.
      export-import.ts                 # Portable JSON validation and atomic import preparation.
    features/
      setup/GameSetup.tsx
      workbench/Workbench.tsx
      workbench/ProgressionRail.tsx
      workbench/EncounterTable.tsx
      workbench/PokemonInspector.tsx
      workbench/MoveAvailability.tsx
      search/FireRedSearch.tsx
      team/TeamManifest.tsx
```

---

### Task 1: Define the complete pack and source-reader contracts

**Files:**
- Modify: `dev/scripts/data/pokeapi-data-reader.ts`
- Modify: `dev/scripts/data/pokeapi-data-reader.test.ts`
- Create: `dev/src/domain/pack.ts`
- Create: `dev/src/domain/pack.test.ts`
- Modify: `dev/tsconfig.node.json`

**Interfaces:**
- Produces: `PokeApiDataReader.listIds(resource): number[]`, `PokeApiDataReader.readReferenceId(url, resource): number`, strict schemas/types for `PokemonRecord`, `MoveRecord`, `LearnsetRecord`, `EncounterArea`, `AcquisitionRecord`, `EvolutionEdge`, `TypeChart`, `FireRedIndexes`, and `FireRedPackManifest` schema version `2`. The existing bootstrap manifest loader remains intact until Task 7 switches generated output atomically.
- The manifest file descriptor is `{ path: string; sha256: string; schemaVersion: 1 }`; required keys exclude `opponents`.

- [ ] **Step 1: Write the source-reader RED tests**

Add tests that create numeric fixture directories `10`, `2`, and `7`, ignore a non-numeric directory, sort IDs numerically, and reject references whose resource segment or origin is wrong:

```ts
expect(reader.listIds('pokemon')).toEqual([2, 7, 10]);
expect(reader.readReferenceId('https://pokeapi.co/api/v2/pokemon/56/', 'pokemon')).toBe(56);
expect(() => reader.readReferenceId('https://pokeapi.co/api/v2/move/56/', 'pokemon')).toThrow('Expected pokemon reference');
```

- [ ] **Step 2: Run the reader test and verify RED**

Run: `npm run test -- scripts/data/pokeapi-data-reader.test.ts`

Expected: FAIL because `listIds` and `readReferenceId` do not exist.

- [ ] **Step 3: Implement safe enumeration and reference parsing**

Use injected/default `readdirSync(..., { withFileTypes: true })`, keep `RESOURCE_PATTERN`, accept only positive integer directory names, and parse only credential-free `https://pokeapi.co/api/v2/<resource>/<id>/` URLs. Never turn a source URL into a filesystem path directly.

- [ ] **Step 4: Write pack/manifest RED tests**

Build a minimal valid pack with Mankey and assert that parsers reject a hidden ability, Fairy type, future move in `availableNow`, an unknown evolution target, an HTTP asset path, and a manifest missing `routes-by-pokemon`:

```ts
expect(parsePokemonRecords([mankey]).at(0)?.abilities).toEqual([
  { id: 72, name: 'Vital Spirit', slot: 1, shortEffect: expect.any(String) },
]);
expect(() => parsePokemonRecords([{ ...mankey, types: ['fairy'] }])).toThrow();
expect(() => parseFireRedPackManifest({ ...manifest, schemaVersion: 1 })).toThrow();
```

- [ ] **Step 5: Run the pack tests and verify RED**

Run: `npm run test -- src/domain/pack.test.ts`

Expected: FAIL because the pack schemas and manifest v2 contract are missing.

- [ ] **Step 6: Implement the shared strict schemas**

Use `.strict()` Zod objects, positive integer IDs, normalized slugs, nonempty provenance arrays, Gen III type literals, and discriminated acquisition/move-method unions. Export inferred types. Define required manifest keys exactly as the generated tree above and validate SHA-256 as 64 lowercase hex characters.

- [ ] **Step 7: Run focused and full checks, then commit**

Run: `npm run test -- scripts/data/pokeapi-data-reader.test.ts src/domain/pack.test.ts && npm run typecheck`

```powershell
git add dev/scripts/data/pokeapi-data-reader.ts dev/scripts/data/pokeapi-data-reader.test.ts dev/src/domain/pack.ts dev/src/domain/pack.test.ts dev/tsconfig.node.json
git commit -m "feat: define FireRed pack contracts"
```

### Task 2: Normalize Generation III Pokémon, abilities, moves, learnsets, and types

**Files:**
- Create: `dev/scripts/data/firered/compiler-context.ts`
- Create: `dev/scripts/data/firered/compiler-context.test.ts`
- Create: `dev/scripts/data/firered/normalizer.ts`
- Create: `dev/scripts/data/firered/normalizer.test.ts`
- Create: `dev/data/fixtures/firered-compiler/data/api/v2/...`

**Interfaces:**
- Consumes: exact endpoint objects from the pinned reader.
- Produces: `assertFireRedSourceContext(reader)`, `normalizePokemonCatalog(reader)`, `normalizeMoveCatalog(reader)`, `normalizeLearnsets(reader): NormalizedLearnsetRecord[]`, and `normalizeTypeChart(reader)`. The normalized learnset is deliberately pre-acquisition: machine/tutor entries retain method plus move ID but do not invent final `acquisitionIds` before Task 6's curated facts exist.

- [ ] **Step 1: Add endpoint-shaped fixtures and write context RED tests**

Include version `10`, version-group `7`, generation `3`, Clefairy, Gengar, Mankey, Tackle, and their referenced resources. Assert exact endpoint and inline-reference names as well as the 10 → 7 → 3 links, and make mismatches fail before any output is built.

- [ ] **Step 2: Run context tests and verify RED**

Run: `npm run test -- scripts/data/firered/compiler-context.test.ts`

Expected: FAIL because the context module does not exist.

- [ ] **Step 3: Implement immutable context checks and source provenance**

Return the exact game IDs plus PokeAPI revision/license and the pinned commit timestamp obtained with `git show -s --format=%cI`; this timestamp is the deterministic manifest build timestamp, never `Date.now()`.

- [ ] **Step 4: Write historical mechanics RED tests**

Cover these exact regressions:

```ts
expect(clefairy.types).toEqual(['normal']);
expect(clefairy.abilities.map(({ name }) => name)).toEqual(['Cute Charm']);
expect(gengar.abilities.map(({ name }) => name)).toEqual(['Levitate']);
expect(mankey.abilities.map(({ name }) => name)).toEqual(['Vital Spirit']);
expect(tackle).toMatchObject({ power: 35, accuracy: 95, damageClass: 'physical' });
expect(shadowBall.damageClass).toBe('physical');
expect(firePunch.damageClass).toBe('special');
expect(typeChart.steel.resists).toEqual(expect.arrayContaining(['ghost', 'dark']));
```

Also assert only version-group `7` learnset details survive; level-up, egg, machine, and tutor methods remain distinct; historical move and ability effect text uses the last value applicable to version-group `7`; no hidden ability or species/move introduced after generation 3 survives; and Fairy never enters the type chart.

- [ ] **Step 5: Run normalizer tests and verify RED**

Run: `npm run test -- scripts/data/firered/normalizer.test.ts`

Expected: FAIL because the normalizer does not exist.

- [ ] **Step 6: Implement historical rollback**

Start with current values, then apply `past_abilities`, `past_types`, and `past_stats` entries whose generation is at or after target generation `3`, newest boundary first. Apply move past values/effect changes and ability effect changes whose version-group order is at or after target group `7`, newest boundary first. Reconstruct type relations from `past_damage_relations` at generation `3`. Keep status moves as status; otherwise derive category from the fixed physical type set `normal,fighting,flying,poison,ground,rock,bug,ghost,steel` and special type set `fire,water,grass,electric,psychic,ice,dragon,dark`.

- [ ] **Step 7: Add catalog coverage assertions and run GREEN**

The pinned-source integration test must assert 386 Pokémon, 354 FireRed-compatible moves, 17 Pokémon/type-chart types, no hidden abilities, every Pokémon has one learnset record, and all emitted references resolve. It must explicitly reject Orre-only Shadow moves rather than mapping their `shadow` type into FireRed and must retain Curse as move-only type `unknown`.

Run: `npm run test -- scripts/data/firered/compiler-context.test.ts scripts/data/firered/normalizer.test.ts`

- [ ] **Step 8: Run type checks and commit**

```powershell
git add dev/scripts/data/firered dev/data/fixtures/firered-compiler
git commit -m "feat: normalize Generation III mechanics"
```

### Task 3: Compile FireRed evolution rules and species acquisition classes

**Files:**
- Create: `dev/data/firered/sources.json` (seed the central registry with evolution-rule sources; Task 5 extends it)
- Create: `dev/data/firered/evolution-overrides.json`
- Create: `dev/scripts/data/firered/evolutions.ts`
- Create: `dev/scripts/data/firered/evolutions.test.ts`

**Interfaces:**
- Produces: `compileEvolutions(reader, pokemon, overrides): EvolutionEdge[]` and `deriveEvolutionClosure(seedSpeciesIds, edges)`. Final `standard`, `postgame`, `version-exclusive`, `event-only`, or `transfer-only` classification happens in Task 6 after every acquisition source is available.

- [ ] **Step 1: Write evolution RED tests**

Use endpoint-shaped chains to assert Bulbasaur level evolutions, Kadabra trade evolution, Onix Metal Coat trade evolution, Golbat-to-Crobat gated by `national-dex`, Eevee-to-Espeon/Umbreon unavailable in FireRed, and later evolutions such as Rhyperior removed.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test -- scripts/data/firered/evolutions.test.ts`

Expected: FAIL because the evolution compiler and override file do not exist.

- [ ] **Step 3: Add strict provenance-backed overrides**

Each override includes `fromPokemonId`, `toPokemonId`, `status`, `milestoneId` or `reason`, and provenance resolving to `sources.json`. Encode National Dex locks, FireRed-impossible time evolutions, transfer-prepared Beauty evolution, and later-generation exclusions; do not paste decompilation tables or source prose.

- [ ] **Step 4: Implement and validate evolution compilation**

Traverse chains iteratively, keep only IDs 1–386, normalize trigger/item/level/gender/location details, apply overrides, sort by source/target ID, and fail when an override does not match a source edge.

- [ ] **Step 5: Verify coverage and commit**

Assert every target/source resolves, every species has an availability classification after encounters/acquisitions are merged later, and no generation IV+ target remains.

```powershell
git add dev/data/firered/sources.json dev/data/firered/evolution-overrides.json dev/scripts/data/firered/evolutions.ts dev/scripts/data/firered/evolutions.test.ts
git commit -m "feat: compile FireRed evolution rules"
```

### Task 4: Compile complete FireRed encounters without collapsing rates

**Files:**
- Create: `dev/scripts/data/firered/encounters.ts`
- Create: `dev/scripts/data/firered/encounters.test.ts`
- Extend: `dev/data/fixtures/firered-compiler/data/api/v2/location-area/...`

**Interfaces:**
- Produces: `compileFireRedEncounters(reader): EncounterArea[]`; encounter records retain `methodRate` separately from per-slot `chance`, `maxChance`, level range, and condition values.

- [ ] **Step 1: Write encounter RED tests**

Fixture Route 22 area `313` with Mankey slots and assert:

```ts
expect(route22.locationAreaId).toBe(313);
expect(route22.methodRates.walk).toBe(21);
expect(mankey.maxChance).toBe(45);
expect(mankey.slots.map(({ chance }) => chance)).toEqual([20, 10, 10, 4, 1]);
expect(mankey.slots.map(({ level }) => level)).toEqual([3, 4, 2, 5, 5]);
```

Add a LeafGreen-only version detail and assert it is absent. Assert encounter categories distinguish wild methods from `gift`, `gift-egg`, `only-one`, `pokeflute`, and event distribution.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test -- scripts/data/firered/encounters.test.ts`

Expected: FAIL because the encounter importer does not exist.

- [ ] **Step 3: Implement encounter normalization**

Scan numeric location-area IDs, filter version details to version `10`, hydrate location/method/condition names, preserve each slot, and sort areas, Pokémon, methods, conditions, levels, and chances deterministically.

- [ ] **Step 4: Run pinned-source coverage**

Assert the pinned snapshot yields 137 FireRed location areas, 136 unique encounter species before curated acquisitions/evolution closure, and only recognized method categories. Unknown methods must fail with the method name and area ID.

- [ ] **Step 5: Run focused tests and commit**

```powershell
git add dev/scripts/data/firered/encounters.ts dev/scripts/data/firered/encounters.test.ts dev/data/fixtures/firered-compiler
git commit -m "feat: compile FireRed encounter tables"
```

### Task 5: Curate and validate route progression with a research registry

**Files:**
- Modify: `dev/data/firered/sources.json`
- Create: `dev/data/firered/progression.json`
- Create: `dev/scripts/data/firered/curated.ts`
- Create: `dev/scripts/data/firered/curated.test.ts`

**Interfaces:**
- Consumes: the existing `validateRouteProgression` contract.
- Produces: `loadFireRedSources`, `loadFireRedProgression`, and a complete area-to-node mapping.

- [ ] **Step 1: Extend the exact research-source registry**

Include PokeAPI revision `0fb5313c…`, pret reference revision `df4449a…` with `license: null` and reference-only note, the Bulbapedia FireRed/LeafGreen walkthrough index, Generation III TM/HM locations, and FireRed/LeafGreen move tutor pages, all accessed `2026-07-19`. Store URLs and locator conventions, not copied prose.

- [ ] **Step 2: Write curated-data RED tests**

Assert Pallet Town is first, Route 22 is selectable before Brock but its later Victory Road visit is modeled separately by events/conditions, Brock is a key milestone, optional branches do not break the main path, Network Machine precedes Cerulean Cave access, every node/event has provenance, and event-only islands are not main nodes.

- [ ] **Step 3: Run and verify RED**

Run: `npm run test -- scripts/data/firered/curated.test.ts`

Expected: FAIL because curated files/loaders do not exist.

- [ ] **Step 4: Encode the complete practical chronology**

Cover the main walkthrough sequence Pallet through Indigo Plateau, standard Sevii postgame, Network Machine, Elite Four reopening, and Cerulean Cave. Preserve optional/flexible Kanto branches through prerequisites and `nextNodeIds`; do not force a false linear Gym order. Map all 137 encounter-bearing areas to exactly one progression node or an explicit event-only/unsupported-area exception with rationale.

- [ ] **Step 5: Validate provenance, graph semantics, and mapping coverage**

Fail on duplicate/unknown area IDs, missing source IDs, provisional confidence, unreachable main nodes, or encounter areas without an explicit disposition.

- [ ] **Step 6: Run focused/full domain tests and commit**

```powershell
git add dev/data/firered/sources.json dev/data/firered/progression.json dev/scripts/data/firered/curated.ts dev/scripts/data/firered/curated.test.ts
git commit -m "feat: curate FireRed route progression"
```

### Task 6: Curate non-wild, TM/HM, and tutor milestone availability

**Files:**
- Create: `dev/data/firered/acquisitions.json`
- Modify: `dev/scripts/data/firered/curated.ts`
- Modify: `dev/scripts/data/firered/curated.test.ts`
- Create: `dev/scripts/data/firered/indexes.ts`
- Create: `dev/scripts/data/firered/indexes.test.ts`

**Interfaces:**
- Produces: validated acquisitions, `attachAcquisitionIds(normalizedLearnsets, acquisitions): LearnsetRecord[]`, and `buildFireRedIndexes(packInputs): FireRedIndexes`.

- [ ] **Step 1: Write acquisition RED tests**

Assert 50 TMs, eight HM compatibility records with HM08 explicitly unavailable in FireRed, seven available HMs, 18 FireRed tutor moves, and provenance for every acquisition. Cover TM39 after Brock, HM01 on S.S. Anne with Cascade Badge field-use evidence, HM03 in Safari Zone with Soul Badge evidence, Rock Slide tutor in Rock Tunnel, and future/postgame drawers.

- [ ] **Step 2: Add non-wild availability RED tests**

Cover starters, Celadon Eevee, Silph Co. Lapras, dojo/fossil choices, in-game trades, Game Corner prizes, Snorlax, Articuno/Zapdos/Moltres/Mewtwo, starter-dependent roaming beasts, event-only Mew/Deoxys/Ho-Oh/Lugia, version exclusives, and transfer-only species.

- [ ] **Step 3: Run curated tests and verify RED**

Run: `npm run test -- scripts/data/firered/curated.test.ts`

Expected: FAIL because acquisition coverage is absent.

- [ ] **Step 4: Encode independent factual acquisition records**

Each record includes kind, referenced Pokémon/move/item, node/event/milestone, prerequisites/choices, repeatability, FireRed status, and provenance. Multiple physical copies remain separate facts while the availability index records the earliest legal milestone and all later sources.

Join the Task 2 pre-acquisition learnsets to these validated records by move and method. Populate machine/tutor `acquisitionIds` with every matching concrete fact, keep other learn methods unchanged, and fail on either an unresolved machine/tutor entry or an acquisition ID that does not resolve.

- [ ] **Step 5: Write index RED tests**

Assert Mankey appears under Fighting, Vital Spirit, and Karate Chop; Route 22 appears in routes-by-Pokémon for Mankey; every index is sorted and duplicate-free; future machine/tutor evidence retains milestone and prerequisite; transfer-only remains searchable but never `availableNow`.

- [ ] **Step 6: Run and verify RED**

Run: `npm run test -- scripts/data/firered/indexes.test.ts`

Expected: FAIL because index generation does not exist.

- [ ] **Step 7: Implement derived indexes and complete classification**

Build indexes only from validated normalized/curated inputs. Close standard availability over legal evolutions, then classify every one of the 386 species exactly once while retaining multiple acquisition sources.

- [ ] **Step 8: Run focused tests and commit**

```powershell
git add dev/data/firered/acquisitions.json dev/scripts/data/firered/curated.ts dev/scripts/data/firered/curated.test.ts dev/scripts/data/firered/indexes.ts dev/scripts/data/firered/indexes.test.ts
git commit -m "feat: index FireRed milestone availability"
```

### Task 7: Validate, write, and verify the deterministic FireRed pack and research report

**Files:**
- Create: `dev/scripts/data/firered/validate-pack.ts`
- Create: `dev/scripts/data/firered/validate-pack.test.ts`
- Create: `dev/scripts/data/firered/pack-writer.ts`
- Create: `dev/scripts/data/firered/pack-writer.test.ts`
- Create: `dev/scripts/data/compile-firered-pack.ts`
- Create: `dev/scripts/data/compile-firered-pack.test.ts`
- Delete: `dev/scripts/data/write-bootstrap-pack.ts`
- Delete: `dev/scripts/data/write-bootstrap-pack.test.ts`
- Create/replace: generated files under `dev/public/data/firered/`
- Create: `dev/data/research/firered/research-report.json`
- Create: `dev/data/research/firered/research-report.md`
- Modify: `dev/src/data/manifest.ts`
- Modify: `dev/src/data/manifest.test.ts`
- Modify: `dev/package.json`
- Modify: `dev/README.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `compileFireRedPack({ projectRoot, mode: 'write' | 'check' })`, `npm run data:compile`, and deterministic `npm run data:verify`.

- [ ] **Step 1: Write validation RED tests**

Reject unknown cross-file IDs, missing provenance, provisional facts, duplicate slugs, missing required assets, a future move in current availability, an unmapped encounter area, or a species without acquisition classification. Require the exact 386/354/17 coverage and version 10/group 7/generation 3 identity, with PokeAPI Shadow move IDs `10001..10018` excluded as non-FireRed data.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test -- scripts/data/firered/validate-pack.test.ts`

Expected: FAIL because pack validation does not exist.

- [ ] **Step 3: Write canonical serialization/hash RED tests**

Assert recursive key ordering, stable array ordering owned by compilers, newline termination, SHA-256 of exact UTF-8 bytes, content-address-derived `packVersion`, deterministic source timestamp, and byte-identical repeat builds. Check mode compares expected bytes in memory and reports only mismatched generated paths; it must not inspect or rewrite unrelated working-tree files.

- [ ] **Step 4: Implement writer, manifest, and reports**

Write all required assets atomically from validated values. Replace the bootstrap writer with the compiler and update the lightweight manifest loader to accept and display the verified v2 manifest without loading individual assets yet. The report contains scope, source registry/licensing, coverage matrix, counts, conflicts, overrides, selected cross-checks, and zero provisional records. Do not serve pret source or copied tables.

- [ ] **Step 5: Write compiler integration RED test**

Compile the minimal fixture tree to a temporary directory and assert manifest hashes load every emitted asset, Route 22/Mankey and Brock evidence survive end-to-end, and `mode: 'check'` detects one changed byte.

- [ ] **Step 6: Implement compiler orchestration and scripts**

Set scripts to:

```json
"data:compile": "tsx scripts/data/compile-firered-pack.ts --write",
"data:verify": "tsx scripts/data/compile-firered-pack.ts --check",
"prebuild": "npm run data:verify"
```

Update CI to run `npm run data:sync`, `npm run data:verify`, and `npm run check` with the pinned runtime.

- [ ] **Step 7: Generate the real pack and inspect the report**

Run: `npm run data:sync && npm run data:compile && npm run data:verify`

Expected: exact scope counts, zero missing/provisional facts, all hashes verified, and no opponents asset.

- [ ] **Step 8: Run full checks and commit**

Run: `npm run check`

```powershell
git add .github/workflows/ci.yml dev/package.json dev/package-lock.json dev/README.md dev/scripts/data dev/data/firered dev/data/research/firered dev/public/data/firered
git commit -m "feat: generate complete FireRed data pack"
```

### Task 8: Load the hashed pack and implement pure availability and search

**Files:**
- Create: `dev/src/data/game-pack.ts`
- Create: `dev/src/data/game-pack.test.ts`
- Modify: `dev/src/data/manifest.ts`
- Modify: `dev/src/data/manifest.test.ts`
- Modify: `dev/src/data/manifest-url.ts`
- Create: `dev/src/domain/availability.ts`
- Create: `dev/src/domain/availability.test.ts`
- Create: `dev/src/domain/search.ts`
- Create: `dev/src/domain/search.test.ts`

**Interfaces:**
- Produces: `loadFireRedPack(fetcher, digest, baseUrl)`, `evaluateMoveAvailability(context, pokemonId, pack)`, and `searchFireRed(query, pack)`.

- [ ] **Step 1: Write loader RED tests**

Assert manifest-first loading, base-path anchoring, SHA-256 verification before parsing, all-or-nothing failure on a missing/corrupt/unknown asset, abort-signal forwarding, and no runtime request outside the static base path.

- [ ] **Step 2: Implement the loader and verify GREEN**

Fetch asset bytes, digest with an injectable Web Crypto adapter, compare lowercase hashes, parse the matching strict schema, validate cross-references, and return one immutable `FireRedPack`.

- [ ] **Step 3: Write availability RED tests**

Cover boundary levels, before/at/after acquisition milestones, preview milestone isolation, acquisition overrides, incompatible/exclusive moves, and disjoint `availableNow`, `futureLevel`, `futureMilestone`, `unavailable` sets. For Route 22 Mankey before Brock, current level-up moves must not include later levels or future machines.

- [ ] **Step 4: Implement pure availability evaluation**

The function receives saved current milestone and optional preview milestone as values and never mutates either. Every result carries method, level or milestone, location, prerequisite, and reason evidence.

- [ ] **Step 5: Write search RED tests**

Test name, type, ability, and move filters alone and intersected; version-valid egg/machine/tutor matches; future/transfer-only evidence; and route match counts from `routes-by-pokemon`.

- [ ] **Step 6: Implement indexed search, run focused checks, and commit**

```powershell
git add dev/src/data/game-pack.ts dev/src/data/game-pack.test.ts dev/src/domain/availability.ts dev/src/domain/availability.test.ts dev/src/domain/search.ts dev/src/domain/search.test.ts
git commit -m "feat: load and query FireRed planning data"
```

### Task 9: Define 6+6 team and versioned playthrough state

**Files:**
- Create: `dev/src/domain/team.ts`
- Create: `dev/src/domain/team.test.ts`
- Create: `dev/src/domain/playthrough.ts`
- Create: `dev/src/domain/playthrough.test.ts`

**Interfaces:**
- Produces: `type SixSlots = readonly [Slot, Slot, Slot, Slot, Slot, Slot]`, `TeamState { primary: SixSlots; reserve: SixSlots }`, immutable `assignMember`, `swapSlots`, `moveMember`, `updateMember`, `createStandardPlaythrough`, `parsePlaythrough`, and `migratePlaythrough`.

- [ ] **Step 1: Write team RED tests**

Assert exactly six slots per section, assign/replace, reorder, primary↔reserve movement, no duplicate playthrough member IDs, level 1–100, selected legal ability, and at most four unique version-valid move IDs with future labels preserved.

- [ ] **Step 2: Implement minimal immutable team operations**

Use explicit `{ section: 'primary' | 'reserve'; index: 0|1|2|3|4|5 }` addresses and return new arrays/records without mutating inputs.

- [ ] **Step 3: Write playthrough RED tests**

Assert FireRed/Standard are fixed, schema/pack version and timestamps are present, current and preview milestones are distinct, canonical data is absent, invalid referenced IDs fail against an injected pack index, and migrations preserve the prior value until validation succeeds.

- [ ] **Step 4: Implement the current schema and deterministic migration**

Include starter/branch choices, team, user notes, acquisition overrides, and reserved empty checkoff maps for Plan 3 compatibility without adding live-run UI or behavior.

- [ ] **Step 5: Run focused/full domain checks and commit**

```powershell
git add dev/src/domain/team.ts dev/src/domain/team.test.ts dev/src/domain/playthrough.ts dev/src/domain/playthrough.test.ts
git commit -m "feat: model FireRed playthrough teams"
```

### Task 10: Add IndexedDB persistence and validated export/import

**Files:**
- Modify: `dev/package.json`
- Modify: `dev/package-lock.json`
- Create: `dev/src/persistence/repository.ts`
- Create: `dev/src/persistence/repository.test.ts`
- Create: `dev/src/persistence/indexeddb-repository.ts`
- Create: `dev/src/persistence/indexeddb-repository.test.ts`
- Create: `dev/src/persistence/export-import.ts`
- Create: `dev/src/persistence/export-import.test.ts`

**Interfaces:**
- Produces: `PlaythroughRepository { list, get, put, delete }`, `MemoryPlaythroughRepository`, `openIndexedDbRepository(factory)`, `serializePlaythroughExport`, and `preparePlaythroughImport`.

- [ ] **Step 1: Add `fake-indexeddb` and write repository RED tests**

Test save/load/list/delete round trips, independent records, update timestamps, schema migration, blocked/corrupt database errors, and that canonical pack objects are never persisted.

- [ ] **Step 2: Implement memory and native IndexedDB adapters**

Use one database `pokeplanner`, a versioned `playthroughs` object store keyed by `id`, and transaction completion/error promises. Keep native APIs behind the repository; components never open IndexedDB.

- [ ] **Step 3: Write export/import RED tests**

Assert stable pretty JSON with schema and pack versions, valid round trip, rejection of malformed JSON/unknown IDs/invalid slots/unsupported future schema, migration of supported old schema, and no repository write before full validation.

- [ ] **Step 4: Implement parse-migrate-validate preparation**

`preparePlaythroughImport(text, packIndex)` returns a validated current record but performs no write. The caller writes once after success, preserving an existing record on every failure.

- [ ] **Step 5: Run focused tests and commit**

```powershell
git add dev/package.json dev/package-lock.json dev/src/persistence
git commit -m "feat: persist and exchange playthroughs"
```

### Task 11: Build Generation III/FireRed Standard setup and the workbench shell

**Files:**
- Create: `dev/src/features/setup/GameSetup.tsx`
- Create: `dev/src/features/setup/GameSetup.test.tsx`
- Create: `dev/src/features/workbench/Workbench.tsx`
- Create: `dev/src/features/workbench/Workbench.test.tsx`
- Create: `dev/src/features/workbench/ProgressionRail.tsx`
- Create: `dev/src/features/workbench/ProgressionRail.test.tsx`
- Modify: `dev/src/styles.css`

**Interfaces:**
- `GameSetup` emits a new Standard playthrough; `Workbench` owns ephemeral selected route/Pokémon/search state and emits validated playthrough changes.

- [ ] **Step 1: Write setup RED tests**

Assert Generation III and FireRed are enabled; other generation/game buttons remain visible and truly `disabled`; FireRed fixes IDs 10/7/3; Standard is the only enabled playthrough type; and creation emits a valid 6+6 empty playthrough.

- [ ] **Step 2: Implement setup with plain task copy**

Use real buttons and fieldsets. Labels describe controls, not roadmap marketing. Do not add hero copy, badges, gradients, or decorative messages.

- [ ] **Step 3: Write workbench/rail RED tests**

Assert chronological node selection, separate route/event selection, current versus preview milestone controls, optional branch labeling, search match counts, keyboard activation, and no opponent/exposure surface for milestone selection.

- [ ] **Step 4: Implement the three-region ledger shell**

Desktop grid: route rail, table region, inspector region, then a full-width team manifest row. The signature is the functional chronological spine with milestone notches and route match counts. Use system sans for reading, monospace for data, grayscale tokens, one-pixel rules, square controls, and no motion beyond native disclosure.

- [ ] **Step 5: Add narrow stacking CSS and commit**

At narrow widths stack rail → table → inspector → manifest. Preserve semantic tables with horizontal overflow rather than cards.

```powershell
git add dev/src/features/setup dev/src/features/workbench/Workbench.tsx dev/src/features/workbench/Workbench.test.tsx dev/src/features/workbench/ProgressionRail.tsx dev/src/features/workbench/ProgressionRail.test.tsx dev/src/styles.css
git commit -m "feat: add FireRed timeline workbench"
```

### Task 12: Add encounter tables, in-place inspector, and move drawers

**Files:**
- Create: `dev/src/features/workbench/EncounterTable.tsx`
- Create: `dev/src/features/workbench/EncounterTable.test.tsx`
- Create: `dev/src/features/workbench/PokemonInspector.tsx`
- Create: `dev/src/features/workbench/PokemonInspector.test.tsx`
- Create: `dev/src/features/workbench/MoveAvailability.tsx`
- Create: `dev/src/features/workbench/MoveAvailability.test.tsx`
- Modify: `dev/src/features/workbench/Workbench.tsx`
- Modify: `dev/src/styles.css`

**Interfaces:**
- Encounter selection stays inside the workbench; inspector planned-level/ability/move edits emit member drafts; availability drawers consume pure Task 8 results.

- [ ] **Step 1: Write encounter table RED tests**

Assert route name, Pokémon, method, levels, slot chance, separate method rate, conditions, EV yield, and selection. Route 22 must show Mankey and its exact level/chance evidence. Table headers and row buttons remain keyboard accessible.

- [ ] **Step 2: Implement the semantic table**

Keep probabilities factual and separate; do not calculate encounter simulations or expected time.

- [ ] **Step 3: Write inspector RED tests**

Assert catch rate, base stats, EV yield, Gen III types/weaknesses, legal abilities, evolutions and gates, acquisition sources, planned level updates, and visible descriptions for focused/hovered names without hiding essential facts in tooltips.

- [ ] **Step 4: Implement the in-place inspector**

Use headings, definition lists, compact stat tables, and visible provenance/evidence links. Missing sprites never block data and no large artwork is required.

- [ ] **Step 5: Write move drawer RED tests**

Assert separate current level-up, future level-up, available machine/tutor, and future milestone groups; native disclosure expanded state; milestone/location/prerequisite evidence; and future choices labeled when selected.

- [ ] **Step 6: Implement move availability and commit**

```powershell
git add dev/src/features/workbench dev/src/styles.css
git commit -m "feat: inspect FireRed encounters and moves"
```

### Task 13: Add indexed search, reverse route lookup, team manifest, and App persistence integration

**Files:**
- Create: `dev/src/features/search/FireRedSearch.tsx`
- Create: `dev/src/features/search/FireRedSearch.test.tsx`
- Create: `dev/src/features/team/TeamManifest.tsx`
- Create: `dev/src/features/team/TeamManifest.test.tsx`
- Modify: `dev/src/App.tsx`
- Modify: `dev/src/App.test.tsx`
- Modify: `dev/src/main.tsx`
- Modify: `dev/src/features/workbench/Workbench.tsx`
- Modify: `dev/src/styles.css`

**Interfaces:**
- App boot flow: load/validate pack → open repository or explicit memory fallback → list/create/restore playthrough → render setup/workbench → persist validated changes.

- [ ] **Step 1: Write search UI RED tests**

Test debounced-free name input and explicit type/ability/move selects, intersected results, learn-method/current-future/transfer evidence, selection into the same inspector, and restrained route match counts in the rail.

- [ ] **Step 2: Implement search without a query language**

Use the generated indexes and pure search function. Reuse table/inspector surfaces; do not create result cards or navigate away.

- [ ] **Step 3: Write team manifest RED tests**

Assert six primary and six reserve slots are always rendered, add/replace, reorder, primary↔reserve movement, planned level/ability/four-move display, keyboard-operable slot actions, and future move labels.

- [ ] **Step 4: Implement the fixed manifest**

Use ordered lists/tables and domain operations from Task 9. Do not implement team scoring, recommendations, damage, or snapshots.

- [ ] **Step 5: Replace App smoke tests with boot/persistence RED tests**

Cover setup on no saved records, restore on reload, save after team/level/milestone edits, validated export, rejected import without overwrite, corrupt pack recovery, IndexedDB failure with a visible temporary-session banner and working export, and FireRed data never written to storage.

- [ ] **Step 6: Implement App orchestration**

Keep `App` as the boundary coordinator. Inject fetch/digest/repository factories in tests. Surface actionable load/storage/import errors; do not silently render partial data.

- [ ] **Step 7: Run focused interface tests**

Run: `npm run test -- src/features src/App.test.tsx`

Expected: all setup, workbench, inspector, search, team, and persistence integration tests pass with no React accessibility warnings.

- [ ] **Step 8: Run full checks and commit**

Run: `npm run check && npm run data:verify`

```powershell
git add dev/src dev/package.json dev/package-lock.json
git commit -m "feat: complete FireRed planning workbench"
```

## Plan Completion Check

- [ ] Re-run `npm run data:sync`, then `npm run data:verify`; record exact catalog, encounter, acquisition, and provisional counts from the report.
- [ ] Run `npm run test`, `npm run typecheck`, and `npm run build` separately with fresh output.
- [ ] Confirm the generated pack contains all required Plan 2 assets and no `opponents.json`.
- [ ] Confirm all 386 species, 354 FireRed-compatible moves, 17 Pokémon/type-chart types, FireRed version 10 encounters, version-group 7 learnsets, and Generation III mechanics validate; confirm Curse retains move-only type `unknown` and all 18 Orre-only Shadow moves are excluded.
- [ ] Confirm Route 22 → Mankey → planned level → current/future moves → TM/HM drawers → primary/reserve assignment → reload works in component integration tests.
- [ ] Confirm IndexedDB records and exports contain user state only and invalid imports cannot overwrite a valid record.
- [ ] Confirm disabled selector entries use native disabled controls; narrow layout remains table-first; focus is visible; essential tooltip content is visible without hover.
- [ ] Confirm `git status --short`, generated-byte verification, and branch diff contain no source cache, pret source, unlicensed extracted tables, opponents, exposure, live-run UI, simulations, or deployment work.
- [ ] Run one combined `/simplify`-angle pass only if the feature diff is messy; then run one inline medium `/code-review` pass over the whole branch, address all findings, and re-run the affected focused tests plus the full verification suite.
