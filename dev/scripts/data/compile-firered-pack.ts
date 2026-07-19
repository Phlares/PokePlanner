import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EvolutionEdge, FireRedPackManifest, PokemonRecord } from '../../src/domain/pack';
import { REQUIRED_POKEAPI_SOURCE } from './source-lock';
import { PokeApiDataReader } from './pokeapi-data-reader';
import { assertFireRedSourceContext } from './firered/compiler-context';
import {
  normalizeLearnsets,
  normalizeMoveCatalog,
  normalizePokemonCatalog,
  normalizeTypeChart,
} from './firered/normalizer';
import { compileFireRedEncounters } from './firered/encounters';
import { compileEvolutions, type EvolutionOverride } from './firered/evolutions';
import { attachAcquisitionIds, loadFireRedAcquisitions, loadFireRedProgression } from './firered/curated';
import { buildFireRedIndexes } from './firered/indexes';
import { validateFireRedPack, type FireRedPackData } from './firered/validate-pack';
import {
  buildResearchReport,
  planFireRedPackFiles,
  serializeCanonical,
  type ManifestSource,
  type PlannedFile,
} from './firered/pack-writer';
import evolutionOverridesInput from '../../data/firered/evolution-overrides.json';

export type CompileMode = 'write' | 'check';

export interface CompileOptions {
  projectRoot: string;
  mode: CompileMode;
  /** Pinned PokeAPI checkout; defaults to the cached required revision under projectRoot. */
  sourceRoot?: string;
  /** Pack output root; defaults to `${projectRoot}/public/data/firered`. */
  outputRoot?: string;
  /** Research report root; defaults to `${projectRoot}/data/research/firered`. */
  reportRoot?: string;
}

export interface CompiledAsset {
  path: string;
  sha256: string;
  bytes: number;
}

export interface CompileResult {
  mode: CompileMode;
  manifest: FireRedPackManifest;
  packVersion: string;
  assets: CompiledAsset[];
  mismatches: string[];
  ok: boolean;
}

interface AssembledPack {
  data: FireRedPackData;
  builtAt: string;
  sources: ManifestSource[];
}

function defaultSourceRoot(projectRoot: string): string {
  return resolve(projectRoot, '.cache', 'sources', REQUIRED_POKEAPI_SOURCE.id, REQUIRED_POKEAPI_SOURCE.revision);
}

/**
 * Read the pinned source and run every FireRed compiler in dependency order, returning
 * the assembled pack plus the deterministic pinned `builtAt` and manifest sources.
 */
export function assembleFireRedPack(reader: PokeApiDataReader): AssembledPack {
  const context = assertFireRedSourceContext(reader);
  const pokemon = normalizePokemonCatalog(reader);
  const moves = normalizeMoveCatalog(reader);
  const typeChart = normalizeTypeChart(reader);
  const acquisitions = loadFireRedAcquisitions();
  const learnsets = attachAcquisitionIds(normalizeLearnsets(reader), acquisitions);
  const encounters = compileFireRedEncounters(reader);
  const evolutions: EvolutionEdge[] = compileEvolutions(
    reader,
    pokemon as Pick<PokemonRecord, 'id'>[],
    evolutionOverridesInput as EvolutionOverride[],
  );
  const progression = loadFireRedProgression();
  const indexes = buildFireRedIndexes({ pokemon, moves, learnsets, encounters, evolutions, acquisitions, progression });

  const data: FireRedPackData = {
    identity: {
      versionId: context.versionId,
      versionGroupId: context.versionGroupId,
      generationId: context.generationId,
    },
    pokemon,
    moves,
    learnsets,
    encounters,
    progression,
    acquisitions,
    evolutions,
    typeChart,
    indexes,
  };
  const sources = progression.sources.map((source) => ({ id: source.id, revision: source.revision }));
  return { data, builtAt: context.source.builtAt, sources };
}

interface PlannedOutput {
  outputRoot: string;
  reportRoot: string;
  packFiles: PlannedFile[];
  reportFiles: PlannedFile[];
}

function planOutput(options: CompileOptions): { plan: PlannedOutput; assembled: AssembledPack } {
  const sourceRoot = options.sourceRoot ?? defaultSourceRoot(options.projectRoot);
  const outputRoot = options.outputRoot ?? resolve(options.projectRoot, 'public', 'data', 'firered');
  const reportRoot = options.reportRoot ?? resolve(options.projectRoot, 'data', 'research', 'firered');

  const reader = new PokeApiDataReader(sourceRoot);
  const assembled = assembleFireRedPack(reader);
  validateFireRedPack(assembled.data);

  const packFiles = planFireRedPackFiles(assembled.data, { builtAt: assembled.builtAt, sources: assembled.sources });
  const report = buildResearchReport(assembled.data, { builtAt: assembled.builtAt, sources: assembled.sources });
  const reportJsonBytes = serializeCanonical(report.json);
  const reportFiles: PlannedFile[] = [
    { path: 'research-report.json', bytes: reportJsonBytes, sha256: '' },
    { path: 'research-report.md', bytes: report.markdown, sha256: '' },
  ];

  return { plan: { outputRoot, reportRoot, packFiles, reportFiles }, assembled };
}

function manifestFromPlan(packFiles: PlannedFile[]): FireRedPackManifest {
  const manifestFile = packFiles.find((file) => file.path === 'manifest.json');
  if (manifestFile === undefined) throw new Error('Planned pack is missing its manifest');
  return JSON.parse(manifestFile.bytes) as FireRedPackManifest;
}

function writeFile(root: string, file: PlannedFile): void {
  const target = resolve(root, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.bytes, 'utf8');
}

function readIfPresent(target: string): string | null {
  try {
    return readFileSync(target, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Compile the deterministic FireRed pack. In `write` mode it emits every asset, the v2
 * manifest, and the research reports. In `check` mode it recomputes the expected bytes in
 * memory and compares them to the on-disk files, reading only the files it would emit and
 * rewriting nothing; the returned `mismatches` list names only the differing paths.
 */
export function compileFireRedPack(options: CompileOptions): CompileResult {
  const { plan } = planOutput(options);
  const manifest = manifestFromPlan(plan.packFiles);
  const assets: CompiledAsset[] = plan.packFiles.map((file) => ({
    path: file.path,
    sha256: file.sha256,
    bytes: Buffer.byteLength(file.bytes, 'utf8'),
  }));

  if (options.mode === 'write') {
    for (const file of plan.packFiles) writeFile(plan.outputRoot, file);
    for (const file of plan.reportFiles) writeFile(plan.reportRoot, file);
    return { mode: 'write', manifest, packVersion: manifest.packVersion, assets, mismatches: [], ok: true };
  }

  const mismatches: string[] = [];
  for (const file of plan.packFiles) {
    if (readIfPresent(resolve(plan.outputRoot, file.path)) !== file.bytes) mismatches.push(file.path);
  }
  for (const file of plan.reportFiles) {
    if (readIfPresent(resolve(plan.reportRoot, file.path)) !== file.bytes) mismatches.push(file.path);
  }
  return { mode: 'check', manifest, packVersion: manifest.packVersion, assets, mismatches, ok: mismatches.length === 0 };
}

function main(argv: string[]): void {
  const mode: CompileMode | null = argv.includes('--check') ? 'check' : argv.includes('--write') ? 'write' : null;
  if (mode === null) {
    console.error('Usage: compile-firered-pack.ts (--write | --check)');
    process.exit(2);
  }
  const projectRoot = resolve(process.cwd());
  const result = compileFireRedPack({ projectRoot, mode });

  if (mode === 'write') {
    console.log(`Wrote FireRed pack ${result.packVersion} (${result.assets.length} assets).`);
    return;
  }
  if (!result.ok) {
    console.error(`FireRed pack verification failed; ${result.mismatches.length} file(s) differ from the committed pack:`);
    for (const path of result.mismatches) console.error(`  - ${path}`);
    console.error('Run `npm run data:compile` to regenerate the pack.');
    process.exit(1);
  }
  console.log(`FireRed pack ${result.packVersion} verified byte-for-byte (${result.assets.length} assets).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
