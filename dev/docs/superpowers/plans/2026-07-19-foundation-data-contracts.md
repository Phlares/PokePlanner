# PokéPlanner Foundation and Data Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested static React application foundation that pins the FireRed source dataset, validates shared data contracts, reads exact PokeAPI `api-data` resources, and loads a versioned bootstrap data pack.

**Architecture:** The repository hosts one Vite React application under `dev/` and Node-based TypeScript data tools under `dev/scripts/data/`. Upstream source revisions are immutable lockfile entries synced into an ignored cache; runtime code consumes generated pack contracts rather than upstream response shapes. JSON Schema validates curated progression data, while Zod validates runtime manifests and TypeScript domain objects.

**Tech Stack:** Node.js 22, npm 11, React 19.2.7, TypeScript 7.0.2, Vite 8.1.5, Vitest 4.1.10, Testing Library 16.3.2, Zod 4.4.3, Ajv 8.20.0, `tsx` 4.23.1.

## Global Constraints

- Keep project code and project documentation under `dev/`; repository automation may live under `.github/`.
- Use test-driven development for every behavior change: failing test, minimal implementation, passing test, then refactor.
- The production application is fully static and has no required backend or browser-time PokéAPI dependency.
- FireRed scope keys are version ID `10`, version-group ID `7`, and generation ID `3`.
- Pin PokeAPI `api-data` revision `0fb5313cb77f46269502e987a53a0bf751ae883d` in source control.
- Treat generated game data as immutable; later IndexedDB work stores user state only.
- Do not include Hidden Abilities or later-generation mechanics in FireRed output.
- Preserve source revision and provenance fields in every generated pack contract.
- Do not ingest or redistribute `pret/pokefirered` source data in this plan.
- Keep the initial UI grayscale, text-forward, responsive, keyboard accessible, and free of decorative glow effects.
- Commit after each task only when that task's focused tests and the repository check command pass.

## Plan Boundary

This is plan 1 of 3. It stops after the tested source and data foundation is usable. Plan 2 will compile the complete FireRed Pokémon, moves, encounters, progression, availability indexes, search indexes, and planner workbench. Plan 3 will add scripted opponents, exposure analysis, live-run checkoffs, end-to-end verification, and static deployment. Each boundary has its own test and review gate.

---

## Planned File Structure

```text
.github/
  workflows/ci.yml                 # Runs the reproducible app and data-contract checks.
.gitignore                         # Ignores local app artifacts and source caches.
dev/
  index.html                       # Vite document entry.
  package.json                     # Scripts and pinned dependencies.
  package-lock.json                # Reproducible npm dependency graph.
  tsconfig.json                    # Browser/shared TypeScript project.
  tsconfig.node.json               # Vite and data-script TypeScript project.
  vite.config.ts                   # Vite, Vitest, and jsdom configuration.
  data/
    schemas/route-progression.schema.json
    sources.lock.json              # Immutable upstream source declarations.
    fixtures/pokeapi-data/...      # Minimal source-reader test fixtures.
  public/data/firered/manifest.json
  scripts/data/
    source-cache.ts                # Syncs and verifies pinned Git sources.
    source-cache.test.ts
    pokeapi-data-reader.ts         # Reads api-data's static endpoint layout.
    pokeapi-data-reader.test.ts
    write-bootstrap-pack.ts        # Writes the initial validated manifest.
  src/
    App.tsx
    App.test.tsx
    main.tsx
    styles.css
    test/setup.ts
    domain/game.ts                 # FireRed context and supported-game contracts.
    domain/game.test.ts
    domain/progression.ts          # Curated progression TypeScript contracts.
    data/manifest.ts               # Runtime manifest validation and loading.
    data/manifest.test.ts
```

### Task 1: Establish the tested Vite application

**Files:**
- Create: `dev/package.json`
- Create: `dev/tsconfig.json`
- Create: `dev/tsconfig.node.json`
- Create: `dev/vite.config.ts`
- Create: `dev/index.html`
- Create: `dev/src/test/setup.ts`
- Create: `dev/src/App.test.tsx`
- Create: `dev/src/App.tsx`
- Create: `dev/src/main.tsx`
- Create: `dev/src/styles.css`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Node.js 22 and npm 11 from the local environment.
- Produces: `npm run test`, `npm run typecheck`, `npm run build`, and `npm run check`; exported `App(): JSX.Element`.

- [ ] **Step 1: Create the package and TypeScript configuration**

Create `dev/package.json`:

```json
{
  "name": "pokeplanner",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit && tsc -p tsconfig.node.json --noEmit",
    "build": "vite build",
    "check": "npm run test && npm run typecheck && npm run build"
  },
  "dependencies": {
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "16.3.2",
    "@types/node": "22.20.1",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "6.0.3",
    "ajv": "8.20.0",
    "ajv-formats": "3.0.1",
    "jsdom": "29.1.1",
    "tsx": "4.23.1",
    "typescript": "7.0.2",
    "vite": "8.1.5",
    "vitest": "4.1.10"
  }
}
```

Create `dev/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "useDefineForClassFields": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "scripts"]
}
```

Create `dev/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "strict": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts", "scripts/**/*.ts"]
}
```

Create `dev/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
```

Create `dev/index.html`:

```html
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
```

Append to `.gitignore`:

```gitignore
dev/node_modules/
dev/dist/
dev/coverage/
dev/.cache/
```

- [ ] **Step 2: Install the locked dependency graph**

Run: `cd dev && npm install`

Expected: exit code 0 and a new `dev/package-lock.json` using lockfile version 3.

- [ ] **Step 3: Write the failing application smoke test**

Create `dev/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Create `dev/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('identifies the product and the active FireRed slice', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'PokéPlanner' })).toBeVisible();
    expect(screen.getByText('FireRed planning data')).toBeVisible();
  });
});
```

- [ ] **Step 4: Run the smoke test and verify RED**

Run: `cd dev && npm run test -- src/App.test.tsx`

Expected: FAIL because `./App` does not exist.

- [ ] **Step 5: Implement the minimal accessible application shell**

Create `dev/src/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <header>
        <p className="eyebrow">Generation III vertical slice</p>
        <h1>PokéPlanner</h1>
      </header>
      <section aria-labelledby="data-status-heading">
        <h2 id="data-status-heading">FireRed planning data</h2>
        <p>Preparing the version-accurate planning workbench.</p>
      </section>
    </main>
  );
}
```

Create `dev/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Expected #root application mount');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Create `dev/src/styles.css`:

```css
:root {
  color: #202124;
  background: #eceeed;
  font-family: "Courier New", ui-monospace, monospace;
  font-synthesis: none;
}

* { box-sizing: border-box; }

body { margin: 0; }

button,
input,
select { font: inherit; }

.app-shell {
  width: min(100% - 2rem, 80rem);
  margin-inline: auto;
  padding-block: 2rem;
}

.eyebrow {
  margin-bottom: 0.25rem;
  color: #5f6368;
  text-transform: uppercase;
}
```

- [ ] **Step 6: Run the task checks and verify GREEN**

Run: `cd dev && npm run check`

Expected: one passing test, successful TypeScript checks, and a successful Vite production build.

- [ ] **Step 7: Commit the application foundation**

```powershell
git add .gitignore dev/package.json dev/package-lock.json dev/tsconfig.json dev/tsconfig.node.json dev/vite.config.ts dev/index.html dev/src
git commit -m "chore: establish tested web app foundation"
```

### Task 2: Define game and data-pack contracts

**Files:**
- Create: `dev/src/domain/game.test.ts`
- Create: `dev/src/domain/game.ts`
- Create: `dev/src/data/manifest.test.ts`
- Create: `dev/src/data/manifest.ts`

**Interfaces:**
- Consumes: Zod from Task 1.
- Produces: `GameContext`, `FIRERED_CONTEXT`, `GamePackManifest`, `parseGamePackManifest(input)`, and `loadGamePackManifest(fetcher, url)`.

- [ ] **Step 1: Write failing tests for FireRed identity and manifest validation**

Create `dev/src/domain/game.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FIRERED_CONTEXT } from './game';

describe('FIRERED_CONTEXT', () => {
  it('keeps version, version-group, and generation IDs distinct', () => {
    expect(FIRERED_CONTEXT).toEqual({
      id: 'firered',
      name: 'Pokémon FireRed',
      versionId: 10,
      versionGroupId: 7,
      generationId: 3,
    });
  });
});
```

Create `dev/src/data/manifest.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { loadGamePackManifest, parseGamePackManifest } from './manifest';

const validManifest = {
  schemaVersion: 1,
  packVersion: 'firered-bootstrap-1',
  game: {
    id: 'firered',
    name: 'Pokémon FireRed',
    versionId: 10,
    versionGroupId: 7,
    generationId: 3,
  },
  sources: [{ id: 'pokeapi-api-data', revision: '0fb5313cb77f46269502e987a53a0bf751ae883d' }],
  files: {},
};

describe('game pack manifest', () => {
  it('rejects a manifest that confuses version and generation', () => {
    expect(() => parseGamePackManifest({ ...validManifest, game: { ...validManifest.game, versionId: 3 } })).toThrow();
  });

  it('loads and validates a manifest with an injected fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(validManifest)));
    await expect(loadGamePackManifest(fetcher, '/data/firered/manifest.json')).resolves.toEqual(validManifest);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cd dev && npm run test -- src/domain/game.test.ts src/data/manifest.test.ts`

Expected: FAIL because `game.ts` and `manifest.ts` do not exist.

- [ ] **Step 3: Implement the shared contracts**

Create `dev/src/domain/game.ts`:

```ts
export interface GameContext {
  id: string;
  name: string;
  versionId: number;
  versionGroupId: number;
  generationId: number;
}

export const FIRERED_CONTEXT = {
  id: 'firered',
  name: 'Pokémon FireRed',
  versionId: 10,
  versionGroupId: 7,
  generationId: 3,
} as const satisfies GameContext;
```

Create `dev/src/data/manifest.ts`:

```ts
import { z } from 'zod';
import { FIRERED_CONTEXT } from '../domain/game';

const gameContextSchema = z.object({
  id: z.literal(FIRERED_CONTEXT.id),
  name: z.literal(FIRERED_CONTEXT.name),
  versionId: z.literal(FIRERED_CONTEXT.versionId),
  versionGroupId: z.literal(FIRERED_CONTEXT.versionGroupId),
  generationId: z.literal(FIRERED_CONTEXT.generationId),
});

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  packVersion: z.string().min(1),
  game: gameContextSchema,
  sources: z.array(z.object({ id: z.string().min(1), revision: z.string().min(1) })).min(1),
  files: z.record(z.string(), z.string()),
});

export type GamePackManifest = z.infer<typeof manifestSchema>;

export function parseGamePackManifest(input: unknown): GamePackManifest {
  return manifestSchema.parse(input);
}

export async function loadGamePackManifest(
  fetcher: typeof fetch,
  url: string,
): Promise<GamePackManifest> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Unable to load game pack manifest: ${response.status}`);
  return parseGamePackManifest(await response.json());
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `cd dev && npm run test -- src/domain/game.test.ts src/data/manifest.test.ts`

Expected: 3 passing tests.

- [ ] **Step 5: Run all checks and commit**

Run: `cd dev && npm run check`

Expected: all tests, type checks, and build pass.

```powershell
git add dev/src/domain dev/src/data
git commit -m "feat: define FireRed pack contracts"
```

### Task 3: Add and validate the approved RouteProgression schema

**Files:**
- Create: `dev/data/schemas/route-progression.schema.json`
- Create: `dev/src/domain/progression.test.ts`
- Create: `dev/src/domain/progression.ts`

**Interfaces:**
- Consumes: the complete approved JSON Schema in `dev/docs/superpowers/specs/2026-07-19-fire-red-vertical-slice-design.md`, Section 10.
- Produces: `validateRouteProgression(input): { valid: true } | { valid: false; errors: string[] }` and TypeScript interfaces for `RouteProgression`, `ProgressionNode`, and `ProgressionEvent`.

- [ ] **Step 1: Copy the approved schema without modification**

Copy the entire JSON code block from design-spec Section 10 into `dev/data/schemas/route-progression.schema.json`. Verify that the file starts with:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://pokeplanner.dev/schemas/route-progression.schema.json",
  "title": "PokéPlanner Route Progression"
}
```

The displayed four-property excerpt is a verification signature, not replacement content; the target file must contain the complete approved `$defs`, node, event, flags, conditions, version flags, and provenance definitions.

- [ ] **Step 2: Write a failing validator test with one valid and one invalid document**

Create `dev/src/domain/progression.test.ts` with a minimal document containing one `pallet-town` node, one verified provenance entry, FireRed version flags, and no events. Assert that it validates. Clone the document, set `nodes[0].provenance = []`, and assert that validation fails with an error mentioning `minItems`.

```ts
import { describe, expect, it } from 'vitest';
import { validateRouteProgression } from './progression';

const validProgression = {
  schemaVersion: 1,
  game: { id: 'firered', name: 'Pokémon FireRed', versionId: 10, versionGroupId: 7, generationId: 3, regionId: 1 },
  sources: [{ id: 'manual-research', name: 'FireRed research', revision: '1', license: null, url: 'https://example.invalid/research' }],
  nodes: [{
    id: 'pallet-town', name: 'Pallet Town', kind: 'town', phase: 'opening', goldenPathOrder: 1, branch: 'main', parentNodeId: null,
    prerequisiteEventIds: [], nextNodeIds: [],
    location: { pokeApiLocationId: 88, pokeApiLocationAreaIds: [285], sourceMapIds: ['MAP_PALLET_TOWN'] },
    versionFlags: { firered: { available: true, exclusive: false, note: null } },
    events: [],
    provenance: [{ sourceId: 'manual-research', locator: 'pallet-town', method: 'manual', confidence: 'verified', note: null }],
  }],
};

describe('validateRouteProgression', () => {
  it('accepts a provenance-backed FireRed progression document', () => {
    expect(validateRouteProgression(validProgression)).toEqual({ valid: true });
  });

  it('rejects a node without provenance', () => {
    const invalid = structuredClone(validProgression);
    invalid.nodes[0].provenance = [];
    const result = validateRouteProgression(invalid);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).toContain('minItems');
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `cd dev && npm run test -- src/domain/progression.test.ts`

Expected: FAIL because `validateRouteProgression` is undefined.

- [ ] **Step 4: Implement the Ajv validator and public contracts**

Create `dev/src/domain/progression.ts`:

```ts
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import routeProgressionSchema from '../../data/schemas/route-progression.schema.json';

export interface ProgressionEvent {
  id: string;
  order: number;
  type: string;
  name: string;
  flags: {
    keyMilestone: boolean;
    gym: boolean;
    rivalFight: boolean;
    bossFight: boolean;
    storyFight: boolean;
    optional: boolean;
  };
}

export interface ProgressionNode {
  id: string;
  name: string;
  kind: string;
  phase: string;
  goldenPathOrder: number;
  prerequisiteEventIds: string[];
  nextNodeIds: string[];
  events: ProgressionEvent[];
}

export interface RouteProgression {
  schemaVersion: number;
  game: { id: string; versionId: number; versionGroupId: number; generationId: number };
  nodes: ProgressionNode[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(routeProgressionSchema);

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };

export function validateRouteProgression(input: unknown): ValidationResult {
  if (validate(input)) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.keyword}: ${error.message ?? 'invalid'}`),
  };
}
```

- [ ] **Step 5: Run focused and full checks, then commit**

Run: `cd dev && npm run test -- src/domain/progression.test.ts && npm run check`

Expected: both progression tests and all repository checks pass.

```powershell
git add dev/data/schemas dev/src/domain/progression.ts dev/src/domain/progression.test.ts
git commit -m "feat: validate route progression contracts"
```

### Task 4: Pin and sync upstream source data

**Files:**
- Create: `dev/data/sources.lock.json`
- Create: `dev/scripts/data/source-cache.test.ts`
- Create: `dev/scripts/data/source-cache.ts`
- Modify: `dev/package.json`

**Interfaces:**
- Consumes: `SourceLock { id, repository, revision, license }` from `sources.lock.json`.
- Produces: `sourceCachePath(projectRoot, lock)`, `syncSource(projectRoot, lock, dependencies)`, and `npm run data:sync`.

- [ ] **Step 1: Add the immutable source lock**

Create `dev/data/sources.lock.json`:

```json
{
  "schemaVersion": 1,
  "sources": [
    {
      "id": "pokeapi-api-data",
      "repository": "https://github.com/PokeAPI/api-data.git",
      "revision": "0fb5313cb77f46269502e987a53a0bf751ae883d",
      "license": "BSD-3-Clause"
    }
  ]
}
```

- [ ] **Step 2: Write failing cache-path and sync-command tests**

Create `dev/scripts/data/source-cache.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { sourceCachePath, syncSource, type SourceLock } from './source-cache';

const lock: SourceLock = {
  id: 'pokeapi-api-data',
  repository: 'https://github.com/PokeAPI/api-data.git',
  revision: '0fb5313cb77f46269502e987a53a0bf751ae883d',
  license: 'BSD-3-Clause',
};

describe('source cache', () => {
  it('uses source ID and revision as the immutable cache key', () => {
    expect(sourceCachePath('C:/repo/dev', lock).replaceAll('\\', '/').endsWith(
      '/.cache/sources/pokeapi-api-data/0fb5313cb77f46269502e987a53a0bf751ae883d',
    )).toBe(true);
  });

  it('fetches only the pinned revision and verifies HEAD', () => {
    const runGit = vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined).mockReturnValueOnce(undefined).mockReturnValueOnce(lock.revision);
    const mkdir = vi.fn();
    syncSource('C:/repo/dev', lock, { runGit, exists: () => false, mkdir });
    expect(mkdir).toHaveBeenCalled();
    expect(runGit.mock.calls.map((call) => call[1])).toEqual([
      ['init'],
      ['remote', 'add', 'origin', lock.repository],
      ['fetch', '--depth', '1', 'origin', lock.revision],
      ['checkout', '--detach', 'FETCH_HEAD'],
      ['rev-parse', 'HEAD'],
    ]);
  });

  it('rejects an existing cache checked out at another revision', () => {
    const runGit = vi.fn().mockReturnValue('wrong-revision');
    expect(() => syncSource('C:/repo/dev', lock, { runGit, exists: () => true, mkdir: vi.fn() }))
      .toThrow('Source revision mismatch');
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `cd dev && npm run test -- scripts/data/source-cache.test.ts`

Expected: FAIL because `source-cache.ts` does not exist.

- [ ] **Step 4: Implement safe immutable source synchronization**

Create `dev/scripts/data/source-cache.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sourceFile from '../../data/sources.lock.json';

export interface SourceLock {
  id: string;
  repository: string;
  revision: string;
  license: string | null;
}

export type GitRunner = (cwd: string, args: string[]) => string | void;

export interface SourceCacheDependencies {
  runGit: GitRunner;
  exists: (path: string) => boolean;
  mkdir: (path: string) => void;
}

export function sourceCachePath(projectRoot: string, lock: SourceLock): string {
  return resolve(projectRoot, '.cache', 'sources', lock.id, lock.revision);
}

export function syncSource(
  projectRoot: string,
  lock: SourceLock,
  dependencies: SourceCacheDependencies,
): string {
  const target = sourceCachePath(projectRoot, lock);
  const verifyHead = () => {
    const head = dependencies.runGit(target, ['rev-parse', 'HEAD']);
    if (typeof head !== 'string' || head.trim() !== lock.revision) {
      throw new Error(`Source revision mismatch: expected ${lock.revision}, received ${String(head).trim()}`);
    }
  };
  if (dependencies.exists(join(target, '.git'))) {
    verifyHead();
    return target;
  }
  dependencies.mkdir(dirname(target));
  dependencies.mkdir(target);
  dependencies.runGit(target, ['init']);
  dependencies.runGit(target, ['remote', 'add', 'origin', lock.repository]);
  dependencies.runGit(target, ['fetch', '--depth', '1', 'origin', lock.revision]);
  dependencies.runGit(target, ['checkout', '--detach', 'FETCH_HEAD']);
  verifyHead();
  return target;
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

const dependencies: SourceCacheDependencies = {
  runGit,
  exists: existsSync,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const projectRoot = resolve(process.cwd());
  for (const source of sourceFile.sources) syncSource(projectRoot, source, dependencies);
}
```

Add to `dev/package.json` scripts:

```json
"data:sync": "tsx scripts/data/source-cache.ts"
```

- [ ] **Step 5: Run the tests and real source sync**

Run: `cd dev && npm run test -- scripts/data/source-cache.test.ts && npm run data:sync`

Expected: two passing tests and `dev/.cache/sources/pokeapi-api-data/0fb5313c…/data/api/v2/version/10/index.json` exists.

- [ ] **Step 6: Run all checks and commit**

Run: `cd dev && npm run check`

```powershell
git add dev/data/sources.lock.json dev/scripts/data/source-cache.ts dev/scripts/data/source-cache.test.ts dev/package.json dev/package-lock.json
git commit -m "feat: pin and sync Pokemon source data"
```

### Task 5: Read exact PokeAPI api-data resources

**Files:**
- Create: `dev/data/fixtures/pokeapi-data/data/api/v2/version/10/index.json`
- Create: `dev/data/fixtures/pokeapi-data/data/api/v2/pokemon/56/index.json`
- Create: `dev/scripts/data/pokeapi-data-reader.test.ts`
- Create: `dev/scripts/data/pokeapi-data-reader.ts`

**Interfaces:**
- Consumes: the root of a checked-out `PokeAPI/api-data` revision.
- Produces: `PokeApiDataReader.read(resource, id)` and convenience methods `readVersion(10)`, `readVersionGroup(7)`, `readGeneration(3)`, and `readPokemon(id)`.

- [ ] **Step 1: Add minimal representative fixtures**

Create the version fixture:

```json
{
  "id": 10,
  "name": "firered",
  "version_group": { "name": "firered-leafgreen", "url": "https://pokeapi.co/api/v2/version-group/7/" }
}
```

Create the Mankey fixture:

```json
{
  "id": 56,
  "name": "mankey",
  "abilities": [{ "is_hidden": false, "slot": 1, "ability": { "name": "vital-spirit", "url": "https://pokeapi.co/api/v2/ability/72/" } }],
  "moves": [],
  "past_abilities": [],
  "past_types": [],
  "stats": [],
  "types": [{ "slot": 1, "type": { "name": "fighting", "url": "https://pokeapi.co/api/v2/type/2/" } }]
}
```

- [ ] **Step 2: Write the failing source-reader tests**

Create `dev/scripts/data/pokeapi-data-reader.test.ts`:

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PokeApiDataReader } from './pokeapi-data-reader';

const reader = new PokeApiDataReader(resolve('data/fixtures/pokeapi-data'));

describe('PokeApiDataReader', () => {
  it('reads a version by the api-data endpoint layout', () => {
    expect(reader.readVersion(10)).toMatchObject({ id: 10, name: 'firered' });
  });

  it('reads a Pokemon without changing its upstream shape', () => {
    expect(reader.readPokemon(56)).toMatchObject({ id: 56, name: 'mankey' });
  });

  it('rejects path-like resource names', () => {
    expect(() => reader.read('../version', 10)).toThrow('Invalid resource');
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `cd dev && npm run test -- scripts/data/pokeapi-data-reader.test.ts`

Expected: FAIL because `PokeApiDataReader` does not exist.

- [ ] **Step 4: Implement the narrow filesystem reader**

Create `dev/scripts/data/pokeapi-data-reader.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RESOURCE_PATTERN = /^[a-z0-9-]+$/;

export class PokeApiDataReader {
  constructor(private readonly sourceRoot: string) {}

  read(resource: string, id: number): unknown {
    if (!RESOURCE_PATTERN.test(resource)) throw new Error(`Invalid resource: ${resource}`);
    if (!Number.isInteger(id) || id < 1) throw new Error(`Invalid resource ID: ${id}`);
    const path = resolve(this.sourceRoot, 'data', 'api', 'v2', resource, String(id), 'index.json');
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  }

  readVersion(id: number): unknown { return this.read('version', id); }
  readVersionGroup(id: number): unknown { return this.read('version-group', id); }
  readGeneration(id: number): unknown { return this.read('generation', id); }
  readPokemon(id: number): unknown { return this.read('pokemon', id); }
}
```

- [ ] **Step 5: Run focused and full checks, then commit**

Run: `cd dev && npm run test -- scripts/data/pokeapi-data-reader.test.ts && npm run check`

Expected: three source-reader tests and all checks pass.

```powershell
git add dev/data/fixtures dev/scripts/data/pokeapi-data-reader.ts dev/scripts/data/pokeapi-data-reader.test.ts
git commit -m "feat: read pinned PokeAPI resources"
```

### Task 6: Generate and load the bootstrap FireRed pack

**Files:**
- Create: `dev/scripts/data/write-bootstrap-pack.ts`
- Create: `dev/public/data/firered/manifest.json`
- Modify: `dev/package.json`
- Modify: `dev/src/App.test.tsx`
- Modify: `dev/src/App.tsx`

**Interfaces:**
- Consumes: `FIRERED_CONTEXT`, `GamePackManifest`, and the source lock from earlier tasks.
- Produces: `npm run data:bootstrap` and an application that renders validated pack status from `/data/firered/manifest.json`.

- [ ] **Step 1: Write the failing application loading tests**

Replace `dev/src/App.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const manifest = {
  schemaVersion: 1,
  packVersion: 'firered-bootstrap-1',
  game: { id: 'firered', name: 'Pokémon FireRed', versionId: 10, versionGroupId: 7, generationId: 3 },
  sources: [{ id: 'pokeapi-api-data', revision: '0fb5313cb77f46269502e987a53a0bf751ae883d' }],
  files: {},
};

describe('App', () => {
  it('shows a validated FireRed pack revision', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest)));
    render(<App fetcher={fetcher} />);
    expect(await screen.findByText('FireRed data ready')).toBeVisible();
    expect(screen.getByText(/0fb5313c/)).toBeVisible();
  });

  it('shows a recoverable message when the pack cannot load', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    render(<App fetcher={fetcher} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('FireRed data could not be loaded');
  });
});
```

- [ ] **Step 2: Run the application test and verify RED**

Run: `cd dev && npm run test -- src/App.test.tsx`

Expected: FAIL because `App` does not accept `fetcher` or load the manifest.

- [ ] **Step 3: Implement deterministic bootstrap-pack generation**

Create `dev/scripts/data/write-bootstrap-pack.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { FIRERED_CONTEXT } from '../../src/domain/game';
import { parseGamePackManifest } from '../../src/data/manifest';

const lock = JSON.parse(readFileSync(resolve('data/sources.lock.json'), 'utf8')) as {
  sources: Array<{ id: string; revision: string }>;
};

const manifest = parseGamePackManifest({
  schemaVersion: 1,
  packVersion: 'firered-bootstrap-1',
  game: FIRERED_CONTEXT,
  sources: lock.sources.map(({ id, revision }) => ({ id, revision })),
  files: {},
});

const output = resolve('public/data/firered/manifest.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
```

Add scripts to `dev/package.json`:

```json
"data:bootstrap": "tsx scripts/data/write-bootstrap-pack.ts",
"prebuild": "npm run data:bootstrap"
```

Run: `cd dev && npm run data:bootstrap`

Expected: a formatted `dev/public/data/firered/manifest.json` with the pinned revision.

- [ ] **Step 4: Implement manifest loading states in the application**

Replace `dev/src/App.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { loadGamePackManifest, type GamePackManifest } from './data/manifest';

interface AppProps { fetcher?: typeof fetch }

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: GamePackManifest }
  | { status: 'error' };

export function App({ fetcher = fetch }: AppProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    loadGamePackManifest(fetcher, './data/firered/manifest.json')
      .then((manifest) => { if (active) setState({ status: 'ready', manifest }); })
      .catch(() => { if (active) setState({ status: 'error' }); });
    return () => { active = false; };
  }, [fetcher]);

  return (
    <main className="app-shell">
      <header><p className="eyebrow">Generation III vertical slice</p><h1>PokéPlanner</h1></header>
      {state.status === 'loading' && <p>Loading FireRed data…</p>}
      {state.status === 'error' && <p role="alert">FireRed data could not be loaded. Reload to try again.</p>}
      {state.status === 'ready' && (
        <section aria-labelledby="data-status-heading">
          <h2 id="data-status-heading">FireRed data ready</h2>
          <p>Source revision <code>{state.manifest.sources[0].revision.slice(0, 8)}</code></p>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Run all checks and verify GREEN**

Run: `cd dev && npm run check`

Expected: all tests and type checks pass; build runs `data:bootstrap` and includes `dist/data/firered/manifest.json`.

- [ ] **Step 6: Commit the bootstrap data flow**

```powershell
git add dev/package.json dev/package-lock.json dev/scripts/data/write-bootstrap-pack.ts dev/public/data/firered/manifest.json dev/src/App.tsx dev/src/App.test.tsx
git commit -m "feat: load validated FireRed bootstrap pack"
```

### Task 7: Add continuous verification and foundation documentation

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `dev/README.md`

**Interfaces:**
- Consumes: `npm ci`, `npm run check`, and the committed bootstrap manifest.
- Produces: reproducible CI and local onboarding commands for the next data-compiler plan.

- [ ] **Step 1: Add the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: dev
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: dev/package-lock.json
      - run: npm ci
      - run: npm run check
```

- [ ] **Step 2: Document the exact foundation workflow**

Create `dev/README.md`:

````markdown
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

The approved FireRed design is in `docs/superpowers/specs/2026-07-19-fire-red-vertical-slice-design.md`.
````

- [ ] **Step 3: Run the clean-install verification**

Run: `cd dev && npm ci && npm run check`

Expected: reproducible install, all tests passing, successful type checks, and successful production build.

- [ ] **Step 4: Commit CI and documentation**

```powershell
git add .github/workflows/ci.yml dev/README.md
git commit -m "ci: verify the app and data foundation"
```

## Plan Completion Check

- [ ] Run `cd dev && npm run check` and record the passing test count.
- [ ] Run `git status --short` and confirm no untracked or modified project files remain.
- [ ] Confirm `dev/.cache/` is ignored and `dev/public/data/firered/manifest.json` is tracked.
- [ ] Confirm the source lock contains revision `0fb5313cb77f46269502e987a53a0bf751ae883d`.
- [ ] Confirm the RouteProgression schema validates the minimal FireRed fixture and rejects missing provenance.
- [ ] Confirm the production build loads with a relative base path suitable for GitHub Pages.
- [ ] After implementation is complete, follow the repository instruction for one appropriately scaled inline code review before considering the branch finished.
