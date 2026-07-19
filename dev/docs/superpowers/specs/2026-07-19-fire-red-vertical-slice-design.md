# PokéPlanner FireRed Vertical Slice Design

Date: 2026-07-19
Status: Approved 2026-07-19

## 1. Summary

PokéPlanner is a static, client-side Pokémon run and team-planning hub. The first vertical slice supports Pokémon FireRed from game selection through route exploration, milestone-aware moveset planning, 6+6 team assembly, and exposure analysis against major scripted fights.

The product is primarily a planner. Lightweight live-run state—route completion, encountered Pokémon, and captured Pokémon—uses the same progression model but does not expand into Nuzlocke enforcement or battle simulation in this slice.

The application uses precompiled, version-specific static data. PokéAPI remains the main normalized upstream source, but browser-time API calls are not required for normal use. Curated FireRed progression and scripted-fight data fill gaps that PokéAPI does not cover.

## 2. Product goals

The FireRed slice must let a user:

1. Start at a generation/game selector where unsupported choices remain visible but disabled.
2. Select FireRed and create a Standard playthrough.
3. Browse FireRed locations in a practical golden-path order.
4. Inspect encounters, levels, methods, slot weights, conditions, EV yields, catch rates, stats, types, and historically valid abilities.
5. Inspect level-up moves and milestone-gated TM, HM, and tutor availability without leaving the route workbench.
6. Add Pokémon to six primary and six reserve slots.
7. Preview future levels and milestones while preserving the difference between currently available and future options.
8. View major story, Gym, Rival, Rocket, Elite Four, and Champion teams in sequence.
9. See explainable type and move exposure between the planned team and a scripted opponent.
10. Search the FireRed pool by Pokémon name, type, ability, or version-valid move and see matching routes.
11. Save locally and export/import playthrough state.

## 3. Non-goals

This slice does not:

- Simulate battles or encounters.
- Predict casualties, wins, sweeps, AI choices, or KO ranges.
- Implement a complete damage calculator.
- Model arbitrary IV, EV, nature, held-item, weather, status, or battle-stage state.
- Enforce Nuzlocke or Professor Oak rules.
- Cover LeafGreen or another game beyond disabled selector entries.
- Include comprehensive item acquisition beyond TM/HM/tutor data required for move availability.
- Include a geographic map.
- Require accounts, synchronization, or a custom backend.

## 4. Success criteria

The slice is successful when a user can complete this workflow locally:

1. Select Generation III and FireRed.
2. Create a Standard playthrough.
3. Open Route 22 in the chronological workbench.
4. Inspect Mankey and change its planned level.
5. See which level-up moves are available and which later moves are locked.
6. Expand TM/HM milestone drawers to see current and future machine availability.
7. Add Mankey to the primary team and another Pokémon to reserve.
8. Open the Brock milestone.
9. See that Mankey supplies a relevant Fighting-type answer, including the move and availability evidence behind the result.
10. Reload the page without losing the plan.

## 5. Architecture decision

### 5.1 Chosen approach

Use a deterministic per-game data compiler and a static React + TypeScript + Vite client.

```text
Pinned upstream sources
        ↓
Game-specific import adapters
        ↓
Generation/version normalization
        ↓
Curated progression overlays
        ↓
Schema validation and cross-checks
        ↓
Generated FireRed data pack
        ↓
Static client application
        ↓
IndexedDB playthrough state
```

The web application never needs to fan out chained PokéAPI calls for search, move filtering, or route lookup. Generated files are cacheable immutable assets. IndexedDB contains user state, not canonical game data.

### 5.2 Rejected alternatives

**Runtime PokéAPI enrichment:** smaller initial bundles, but it complicates historical normalization, caching, failure handling, offline behavior, and reverse indexes.

**Browser-hosted SQLite or DuckDB:** attractive for large cross-generation exploration, but unnecessary weight and complexity for the FireRed slice. Generated indexes can answer the required queries directly.

## 6. Component boundaries

### 6.1 Build-time components

- `source-fetcher`: downloads or reads pinned upstream snapshots and records revisions.
- `pokeapi-normalizer`: constructs Generation III stats, types, abilities, moves, learnsets, evolution rules, and encounter facts.
- `firered-overlay`: supplies story chronology, non-wild availability, trainer teams, gates, and reviewed exceptions.
- `availability-indexer`: derives Pokémon, move, machine, tutor, and evolution availability by milestone.
- `exposure-indexer`: prepares type and opponent lookup indexes without producing conclusions tied to a particular user team.
- `data-validator`: validates schemas, referential integrity, chronology, source coverage, and selected cross-source facts.
- `pack-writer`: emits deterministic, content-addressable FireRed JSON assets and a manifest.

### 6.2 Runtime components

- `game-catalog`: Generation and game tiles, including disabled future entries.
- `playthrough-repository`: versioned IndexedDB persistence plus export/import.
- `progression-workbench`: chronological route/milestone rail and selected location.
- `encounter-table`: route encounters, methods, levels, weights, conditions, EV yields, and filters.
- `pokemon-inspector`: Dex data, stats, abilities, moves, evolutions, and acquisition sources.
- `generation-search`: searches FireRed Pokémon by name, type, historically valid ability, or version-valid learnable move and reports matching routes.
- `availability-engine`: evaluates selected Pokémon, level, and milestone against generated indexes.
- `team-manifest`: six primary and six reserve positions.
- `opponent-inspector`: scripted opponent roster and moves.
- `exposure-engine`: explainable team-versus-opponent coverage and danger rules.
- `live-state-controls`: optional completion, encounter, and capture checkoffs.

Each boundary uses typed domain interfaces rather than raw upstream response shapes.

## 7. Source strategy

### 7.1 PokéAPI

Use pinned data from the BSD-licensed `PokeAPI/api-data` repository or the canonical PokeAPI CSV snapshot as the normalized source for:

- IDs and localized names
- Base stats and EV yields
- Species metadata and capture rate, subject to historical validation
- Generation-correct types and type efficacy
- Generation-correct abilities
- Moves and historical move values
- Version-group learnsets and machines
- Version-specific encounters
- Evolution chains
- Generation III sprites

Scope keys are:

- Version: `firered` / PokéAPI version ID 10
- Version group: `firered-leafgreen` / version-group ID 7
- Generation: `generation-iii` / generation ID 3

Do not treat version, version group, and generation as interchangeable.

### 7.2 Historical corrections

The normalizer must apply past-value tables rather than copying modern Pokémon records. In particular:

- Hidden Abilities do not exist in FireRed and must be excluded.
- Ability slots introduced later must be removed.
- Changed base stats and types must roll back to Generation III.
- Fairy and later types must be excluded.
- Move values must be reconstructed for the FireRed/LeafGreen version group.
- FireRed uses a type-based physical/special split.
- Game-specific evolution exclusions require curated rules when the generic evolution chain is insufficient.

### 7.3 Story and trainer sources

PokéAPI does not provide trainer rosters, story chronology, mandatory/optional classification, event flags, badge/HM gating, or complete non-wild availability.

The `pret/pokefirered` decompilation is an accuracy reference for wild encounter tables, trainer parties, level-up moves, maps, scripts, items, and battle mechanics. Because that repository currently lacks an explicit license, the project must not blindly redistribute its source files or a bulk mechanical extraction without a licensing decision. Use it to verify independently encoded factual records and retain file/symbol/commit provenance.

Human-authored walkthroughs may seed and cross-check the golden path. Facts are encoded independently; prose and copyrighted layout are not copied.

### 7.4 Provenance

Every curated or generated record that is not a stable PokéAPI identifier must support provenance containing:

- Source repository or publication
- Revision, commit, or access date
- Source file, symbol, section, or URL
- Import method: generated, manually encoded, or inferred
- Confidence: verified, cross-checked, or provisional
- Optional reviewer note

Provisional data is visible in development validation reports and cannot silently become verified.

## 8. Repeatable game research playbook

Each later game gets a research package under a game-specific directory. The process is:

1. Define version, version group, generation, regional Dex, and target story boundary.
2. Record authoritative and supplemental sources with licensing notes.
3. Complete a coverage matrix for Pokémon, moves, encounters, evolutions, trainers, milestones, machines, tutors, gifts, trades, and items.
4. Create import adapters only for structured, licensable sources.
5. Encode a minimal golden-path event graph and optional branches.
6. Attach progression gates to acquisitions and scripted fights.
7. Generate normalized data and reverse indexes.
8. Cross-check counts and selected known cases between independent sources.
9. Run game-specific fixture tests.
10. Perform a manual audit of starters, exclusives, gifts, trades, fossils, static encounters, unusual evolutions, Gym teams, Rival variants, Elite Four, and Champion.
11. Produce a research report listing source revisions, coverage, provisional facts, conflicts, and overrides.
12. Pin the completed dataset version in the application manifest.

Research can be delegated by independent domain—encounters, progression/trainers, and mechanics—but final source interpretation and conflict resolution remain part of the main integration review.

## 9. Generated FireRed data pack

The pack is split by access pattern rather than mirroring upstream endpoints:

```text
firered/
  manifest.json
  pokemon.json
  moves.json
  learnsets.json
  encounters.json
  progression.json
  opponents.json
  acquisitions.json
  evolutions.json
  type-chart.json
  indexes/
    pokemon-by-move.json
    pokemon-by-type.json
    pokemon-by-ability.json
    routes-by-pokemon.json
    availability-by-milestone.json
```

The manifest includes schema versions, source revisions, generation ruleset, build timestamp, hashes, and validation status.

## 10. RouteProgression JSON Schema

The progression structure is a directed ordered graph rather than a strictly linear list. `goldenPathOrder` provides the default presentation order; prerequisites and `nextNodeIds` support optional or flexible Kanto sequencing.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://pokeplanner.dev/schemas/route-progression.schema.json",
  "title": "PokéPlanner Route Progression",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "game", "sources", "nodes"],
  "properties": {
    "schemaVersion": { "type": "integer", "minimum": 1 },
    "game": { "$ref": "#/$defs/game" },
    "sources": {
      "type": "array",
      "items": { "$ref": "#/$defs/source" },
      "minItems": 1
    },
    "nodes": {
      "type": "array",
      "items": { "$ref": "#/$defs/node" },
      "minItems": 1
    }
  },
  "$defs": {
    "game": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "name", "versionId", "versionGroupId", "generationId"],
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "name": { "type": "string", "minLength": 1 },
        "versionId": { "type": "integer", "minimum": 1 },
        "versionGroupId": { "type": "integer", "minimum": 1 },
        "generationId": { "type": "integer", "minimum": 1 },
        "regionId": { "type": ["integer", "null"], "minimum": 1 }
      }
    },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "name", "revision", "license", "url"],
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "name": { "type": "string" },
        "revision": { "type": "string" },
        "license": { "type": ["string", "null"] },
        "url": { "type": "string", "format": "uri" }
      }
    },
    "provenance": {
      "type": "object",
      "additionalProperties": false,
      "required": ["sourceId", "method", "confidence"],
      "properties": {
        "sourceId": { "type": "string" },
        "locator": { "type": ["string", "null"] },
        "method": { "enum": ["generated", "manual", "inferred"] },
        "confidence": { "enum": ["verified", "cross-checked", "provisional"] },
        "note": { "type": ["string", "null"] }
      }
    },
    "versionFlag": {
      "type": "object",
      "additionalProperties": false,
      "required": ["available", "exclusive"],
      "properties": {
        "available": { "type": "boolean" },
        "exclusive": { "type": "boolean" },
        "note": { "type": ["string", "null"] }
      }
    },
    "condition": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "operator", "value"],
      "properties": {
        "kind": {
          "enum": [
            "milestone-complete",
            "milestone-incomplete",
            "item-owned",
            "badge-owned",
            "starter-selected",
            "version",
            "choice",
            "time",
            "custom"
          ]
        },
        "operator": { "enum": ["equals", "not-equals", "includes", "excludes"] },
        "value": { "type": ["string", "number", "boolean"] },
        "note": { "type": ["string", "null"] }
      }
    },
    "flags": {
      "type": "object",
      "additionalProperties": false,
      "required": ["keyMilestone", "gym", "rivalFight", "bossFight", "storyFight", "optional"],
      "properties": {
        "keyMilestone": { "type": "boolean" },
        "gym": { "type": "boolean" },
        "rivalFight": { "type": "boolean" },
        "bossFight": { "type": "boolean" },
        "storyFight": { "type": "boolean" },
        "optional": { "type": "boolean" }
      }
    },
    "unlock": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "refId"],
      "properties": {
        "kind": {
          "enum": ["location", "encounter-method", "item", "tm", "hm", "tutor", "trade", "service", "custom"]
        },
        "refId": { "type": "string" },
        "note": { "type": ["string", "null"] }
      }
    },
    "event": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "order", "type", "name", "flags", "conditions", "unlocks", "versionFlags", "provenance"],
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "order": { "type": "integer", "minimum": 0 },
        "type": {
          "enum": [
            "story",
            "checkpoint",
            "gym",
            "rival",
            "trainer",
            "boss",
            "gift",
            "static-encounter",
            "trade",
            "item",
            "tm-hm",
            "tutor",
            "choice"
          ]
        },
        "name": { "type": "string", "minLength": 1 },
        "description": { "type": ["string", "null"] },
        "flags": { "$ref": "#/$defs/flags" },
        "opponentIds": { "type": "array", "items": { "type": "string" }, "uniqueItems": true },
        "acquisitionIds": { "type": "array", "items": { "type": "string" }, "uniqueItems": true },
        "conditions": { "type": "array", "items": { "$ref": "#/$defs/condition" } },
        "unlocks": { "type": "array", "items": { "$ref": "#/$defs/unlock" } },
        "versionFlags": {
          "type": "object",
          "additionalProperties": { "$ref": "#/$defs/versionFlag" },
          "minProperties": 1
        },
        "provenance": { "type": "array", "items": { "$ref": "#/$defs/provenance" }, "minItems": 1 }
      }
    },
    "node": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "name",
        "kind",
        "phase",
        "goldenPathOrder",
        "prerequisiteEventIds",
        "nextNodeIds",
        "location",
        "versionFlags",
        "events",
        "provenance"
      ],
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "name": { "type": "string", "minLength": 1 },
        "kind": { "enum": ["town", "city", "route", "dungeon", "building", "landmark", "facility"] },
        "phase": { "type": "string", "pattern": "^[a-z0-9-]+$" },
        "goldenPathOrder": { "type": "integer", "minimum": 0 },
        "branch": { "enum": ["main", "optional", "alternate", "postgame"] },
        "parentNodeId": { "type": ["string", "null"] },
        "prerequisiteEventIds": { "type": "array", "items": { "type": "string" }, "uniqueItems": true },
        "nextNodeIds": { "type": "array", "items": { "type": "string" }, "uniqueItems": true },
        "location": {
          "type": "object",
          "additionalProperties": false,
          "required": ["pokeApiLocationId", "pokeApiLocationAreaIds", "sourceMapIds"],
          "properties": {
            "pokeApiLocationId": { "type": ["integer", "null"], "minimum": 1 },
            "pokeApiLocationAreaIds": {
              "type": "array",
              "items": { "type": "integer", "minimum": 1 },
              "uniqueItems": true
            },
            "sourceMapIds": { "type": "array", "items": { "type": "string" }, "uniqueItems": true }
          }
        },
        "versionFlags": {
          "type": "object",
          "additionalProperties": { "$ref": "#/$defs/versionFlag" },
          "minProperties": 1
        },
        "events": { "type": "array", "items": { "$ref": "#/$defs/event" } },
        "provenance": { "type": "array", "items": { "$ref": "#/$defs/provenance" }, "minItems": 1 }
      }
    }
  }
}
```

Validation beyond JSON Schema must enforce unique IDs, valid references, contiguous or intentionally sparse ordering, acyclic prerequisite dependencies, source references, and at least one reachable main path.

## 11. Availability model

Availability is evaluated against a context:

```text
game version
+ completed or previewed milestone
+ planned Pokémon level
+ starter and branch choices
+ owned acquisition overrides
```

For a Pokémon, the engine returns separately:

- `availableNow`: legal level-up moves and acquired TM/HM/tutor moves.
- `futureLevel`: later level-up moves with required levels.
- `futureMilestone`: compatible machines or tutors with acquisition milestone, location, and prerequisite.
- `unavailable`: incompatible, version-exclusive, or impossible options with reasons.

The UI never merges future options into the currently available set. A preview context may deliberately move the milestone forward without altering saved run progress.

## 12. Workbench UX

### 12.1 Game setup

- Show generation tiles followed by game tiles.
- Generation III and FireRed are enabled.
- Other entries are visible, labeled as future support, and disabled.
- FireRed automatically selects the correct version group and ruleset.
- Standard is the enabled playthrough type; Nuzlocke and Professor Oak may appear disabled or as non-enforcing tags only if they do not confuse the path.

### 12.2 Timeline workbench

The desktop layout has three persistent regions and a manifest:

1. Left: chronological route and milestone rail.
2. Center: selected route encounters or selected milestone opponent table.
3. Right: contextual Pokémon or opponent inspector.
4. Bottom: primary six and reserve six.

Narrow screens stack the rail, table, inspector, and manifest. The content remains table-first and does not become a card wall.

### 12.3 Pokémon inspection

Selecting a Pokémon keeps the user on the workbench and opens inspector sections for:

- Dex and acquisition summary
- Base stats and EV yield
- Types and weaknesses
- Historically valid abilities
- Evolutions
- Moves
- Availability and exclusivity

Move and ability names support hover and keyboard-focus tooltips. Essential information remains available without hover.

The Moves section contains:

- Current level-up moves
- Upcoming level-up moves
- Collapsible TM/HM drawers grouped by milestone
- Collapsible tutor and other-source drawers when applicable
- Future acquisition location and prerequisite
- Clear current, future, exclusive, and unavailable states

### 12.4 Team manifest

- Six primary and six reserve slots are always visible on desktop.
- Users can add from encounter/search results, replace a chosen slot, reorder, and move between primary and reserve.
- Each planned Pokémon stores a planned level, selected ability where choice exists, and up to four planned moves.
- Moves may be selected from the current context or previewed from a future milestone, but the UI labels future choices.
- Multiple saved team snapshots are deferred; the data model should allow a later named-snapshot collection.

### 12.5 Search and reverse route lookup

- A global search field is scoped to FireRed and the Generation III ruleset.
- Search supports Pokémon name plus structured type, ability, and learnable-move filters.
- Move results use the FireRed/LeafGreen learnset and identify level-up, machine, tutor, breeding, or other methods.
- Search results reuse the encounter/Pokémon table and the same inspector instead of opening a separate product surface.
- The progression rail shows match counts or a restrained highlight for routes containing matching wild Pokémon.
- Non-wild acquisition results identify gifts, static encounters, trades, starters, fossils, events, or transfer-only availability separately.
- A Pokémon that can learn a move only at a future level or milestone remains a match, but its availability evidence is labeled precisely.

## 13. Scripted fights and exposure analysis

### 13.1 Included opponents

The slice targets major progression fights:

- Gyms
- Required or major Rival fights
- Major Team Rocket bosses
- Elite Four
- Champion

The opponent model stores variant conditions, Pokémon, levels, abilities when deterministic, held items when present, and explicit or reconstructed movesets with provenance.

### 13.2 Exposure engine

The engine reports evidence, not a battle outcome.

For each opponent Pokémon it determines:

- Planned team members with a currently legal super-effective move
- Team members resistant or immune to known opposing moves
- Opposing moves super-effective into planned team members
- Ability-based immunities or material type overrides
- Whether a damaging move uses Attack/Defense or Special Attack/Special Defense under Generation III rules
- Whether an answer is unavailable until a later level or milestone
- Answer redundancy: none, one, or multiple

Results use labels such as `covered`, `single answer`, `exposed`, and `uncertain`. Every conclusion links to its move, type relation, ability, and availability facts. There is no composite win score.

## 14. Persistence

IndexedDB stores versioned `Playthrough` records:

- ID, name, game, playthrough type, and creation/update timestamps
- Current and preview milestone IDs
- Starter and branch choices
- Primary and reserve team members
- Planned level, ability, moves, and notes per member
- Route completion, encountered, and captured checkoffs
- User acquisition overrides
- Data-pack version used when last saved

A repository adapter hides IndexedDB details from application state. Migrations are deterministic and tested. Export produces a portable JSON document with its schema and data-pack versions; import validates before writing.

## 15. Error handling

- Build fails on schema, reference, chronology, or required-provenance errors.
- Conflicting source facts generate an explicit report and require an override with rationale.
- Provisional facts remain labeled in development output.
- The client validates the pack manifest before loading a game.
- A corrupt or incompatible pack produces a recoverable error screen rather than partial data.
- IndexedDB failure falls back to a clearly labeled temporary in-memory session with export offered.
- Save migrations preserve the previous record until the migrated record validates.
- Runtime does not depend on PokéAPI availability.
- Missing optional sprites never block tables or planning.

## 16. Testing strategy

All code changes use test-driven development: add a failing test, make it pass, then refactor.

### 16.1 Compiler tests

- Fixture tests for PokéAPI response/CSV normalization
- Generation III stat, type, ability, and move rollback tests
- Version versus version-group filtering tests
- Encounter slot and method-rate separation tests
- Evolution-exception tests
- Deterministic pack and hash tests
- Schema and referential-integrity tests
- Provenance-coverage tests

### 16.2 Domain tests

- Level-up availability at boundary levels
- TM/HM availability before, at, and after acquisition milestones
- Preview milestone isolation from saved progress
- FireRed type-based physical/special classification
- Dual-type effectiveness and immunities
- Ability overrides in the supported registry
- Exposure results with zero, one, and multiple answers
- Future moves excluded from current exposure results
- Primary/reserve assignment invariants

### 16.3 Persistence tests

- Save/load round trips
- Schema migrations
- Data-pack version changes
- Export/import validation
- Corrupt record recovery

### 16.4 Interface tests

- Game selection and disabled states
- Route selection and encounter rendering
- Inspector selection and planned-level updates
- Collapsible milestone drawers
- Team assignment and reordering
- Name/type/ability/move search and reverse route highlighting
- Scripted-fight exposure evidence
- Keyboard navigation, focus-visible controls, and non-hover tooltip access
- Narrow-screen table overflow and layout stacking

### 16.5 Vertical-slice end-to-end test

Automate the success workflow from FireRed selection through Mankey inspection, team assignment, Brock exposure evaluation, save, and reload.

## 17. Deployment

The production output is a static site and immutable generated data assets. It can deploy unchanged to GitHub Pages, Cloudflare Pages, or Vercel. A Cloudflare Worker is optional later for headers, asset routing, or synchronization, but is not required for the vertical slice.

The deployment build runs:

1. Data-source revision verification
2. Data generation or verification of committed generated assets
3. Schema and domain tests
4. Client unit/integration tests
5. Static build
6. Browser end-to-end smoke test

## 18. Implementation decomposition

The vertical slice should be delivered in reviewable increments:

1. Repository/tooling foundation and data contracts
2. FireRed data compiler and research report
3. Game selector and progression workbench
4. Encounter tables and Pokémon inspector
5. FireRed search, reverse route lookup, and milestone-aware move/TM/HM availability
6. Primary/reserve team manifest and persistence
7. Scripted fight data and opponent inspector
8. Exposure engine and evidence UI
9. Live-run checkoffs, accessibility, responsive polish, and deployment

Later games reuse the contracts and research playbook but receive their own source audit, progression graph, curated overrides, fixtures, and validation report.

## 19. Deferred opportunities

- Exact Gen III damage calculation
- Encounter and battle simulation
- Casualty probability at selectable levels
- Full item acquisition timeline
- Named team snapshots for every milestone
- Nuzlocke and custom challenge rule engines
- Reverse-map highlights and geographic region maps
- EV training route optimization
- Cloud synchronization and shareable plans
- LeafGreen and later mainline or Legends games
