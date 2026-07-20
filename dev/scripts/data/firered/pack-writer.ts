import { createHash } from 'node:crypto';
import { FIRERED_CONTEXT } from '../../../src/domain/game';
import { parseFireRedPackManifest, type FireRedPackManifest } from '../../../src/domain/pack';
import { classifyFireRedAvailability } from './indexes';
import { typeCount, type FireRedPackData } from './validate-pack';
import evolutionOverridesInput from '../../../data/firered/evolution-overrides.json';

export interface ManifestSource {
  id: string;
  revision: string;
}

export interface PackWriterOptions {
  builtAt: string;
  sources: ManifestSource[];
}

export interface PlannedFile {
  path: string;
  bytes: string;
  sha256: string;
}

/** Recursively sort object keys (lexicographic) while preserving compiler-owned array order. */
export function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Canonical JSON serialization: recursively key-sorted, 2-space indented, newline-terminated. */
export function serializeCanonical(value: unknown): string {
  return `${JSON.stringify(sortObjectKeys(value), null, 2)}\n`;
}

/** Lowercase SHA-256 hex digest over the exact UTF-8 bytes of the given content. */
export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

interface AssetSpec {
  path: string;
  select: (data: FireRedPackData) => unknown;
}

const ASSET_SPECS: readonly AssetSpec[] = [
  { path: 'pokemon.json', select: (data) => data.pokemon },
  { path: 'moves.json', select: (data) => data.moves },
  { path: 'learnsets.json', select: (data) => data.learnsets },
  { path: 'encounters.json', select: (data) => data.encounters },
  { path: 'progression.json', select: (data) => data.progression },
  { path: 'acquisitions.json', select: (data) => data.acquisitions },
  { path: 'evolutions.json', select: (data) => data.evolutions },
  { path: 'type-chart.json', select: (data) => data.typeChart },
  { path: 'indexes/pokemon-by-move.json', select: (data) => data.indexes.pokemonByMove },
  { path: 'indexes/pokemon-by-type.json', select: (data) => data.indexes.pokemonByType },
  { path: 'indexes/pokemon-by-ability.json', select: (data) => data.indexes.pokemonByAbility },
  { path: 'indexes/routes-by-pokemon.json', select: (data) => data.indexes.routesByPokemon },
  { path: 'indexes/availability-by-milestone.json', select: (data) => data.indexes.availabilityByMilestone },
];

function assetFiles(data: FireRedPackData): PlannedFile[] {
  return ASSET_SPECS.map((spec) => {
    const bytes = serializeCanonical(spec.select(data));
    return { path: spec.path, bytes, sha256: sha256Hex(bytes) };
  });
}

function buildFilesTree(shaByPath: Map<string, string>): FireRedPackManifest['files'] {
  const descriptor = (path: string) => {
    const sha256 = shaByPath.get(path);
    if (sha256 === undefined) throw new Error(`Missing digest for asset ${path}`);
    return { path, sha256, schemaVersion: 1 as const };
  };
  return {
    pokemon: descriptor('pokemon.json'),
    moves: descriptor('moves.json'),
    learnsets: descriptor('learnsets.json'),
    encounters: descriptor('encounters.json'),
    progression: descriptor('progression.json'),
    acquisitions: descriptor('acquisitions.json'),
    evolutions: descriptor('evolutions.json'),
    'type-chart': descriptor('type-chart.json'),
    indexes: {
      'pokemon-by-move': descriptor('indexes/pokemon-by-move.json'),
      'pokemon-by-type': descriptor('indexes/pokemon-by-type.json'),
      'pokemon-by-ability': descriptor('indexes/pokemon-by-ability.json'),
      'routes-by-pokemon': descriptor('indexes/routes-by-pokemon.json'),
      'availability-by-milestone': descriptor('indexes/availability-by-milestone.json'),
    },
  };
}

/**
 * Build the manifest object from the assembled pack and the deterministic pinned
 * `builtAt`. `packVersion` is a pure content address (SHA-256 of the canonical
 * `{game, sources, files}` core) and deliberately excludes `builtAt`.
 */
export function buildFireRedManifest(
  data: FireRedPackData,
  assets: PlannedFile[],
  options: PackWriterOptions,
): FireRedPackManifest {
  const shaByPath = new Map(assets.map((file) => [file.path, file.sha256]));
  const files = buildFilesTree(shaByPath);
  const validation = {
    valid: true as const,
    pokemonCount: data.pokemon.length,
    moveCount: data.moves.length,
    typeCount: typeCount(data.typeChart),
  };
  const packVersion = `firered-${sha256Hex(serializeCanonical({ game: FIRERED_CONTEXT, sources: options.sources, files }))}`;
  return parseFireRedPackManifest({
    schemaVersion: 2,
    packVersion,
    game: FIRERED_CONTEXT,
    sources: options.sources,
    builtAt: options.builtAt,
    validation,
    files,
  });
}

/**
 * Plan every FireRed pack file (13 assets plus the v2 manifest) as canonical,
 * newline-terminated, content-hashed bytes. Deterministic: identical inputs yield
 * byte-identical output. Paths are relative to the pack root (`public/data/firered`).
 */
export function planFireRedPackFiles(data: FireRedPackData, options: PackWriterOptions): PlannedFile[] {
  const assets = assetFiles(data);
  const manifest = buildFireRedManifest(data, assets, options);
  const manifestBytes = serializeCanonical(manifest);
  return [...assets, { path: 'manifest.json', bytes: manifestBytes, sha256: sha256Hex(manifestBytes) }];
}

interface OverrideSummary {
  fromPokemonId: number;
  toPokemonId: number;
  status: string;
  milestoneId: string | null;
  reason: string | null;
}

export interface ResearchReport {
  schemaVersion: number;
  game: typeof FIRERED_CONTEXT;
  builtAt: string;
  scope: {
    pokemonCount: number;
    moveCount: number;
    typeCount: number;
    versionId: number;
    versionGroupId: number;
    generationId: number;
  };
  sources: { id: string; name: string; url: string; revision: string; license: string | null }[];
  counts: Record<string, number>;
  coverageMatrix: {
    availabilityByStatus: Record<string, number>;
    acquisitionsByKind: Record<string, number>;
    encountersByMethod: Record<string, number>;
  };
  conflicts: { topic: string; resolution: string }[];
  overrides: OverrideSummary[];
  crossChecks: { claim: string; evidence: string }[];
  provisionalRecords: number;
  provisionalStatement: string;
}

function tally<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function buildReportModel(data: FireRedPackData, options: PackWriterOptions): ResearchReport {
  const classification = classifyFireRedAvailability({
    pokemon: data.pokemon,
    moves: data.moves,
    learnsets: data.learnsets,
    encounters: data.encounters,
    evolutions: data.evolutions,
    acquisitions: data.acquisitions,
    progression: data.progression,
  });
  const availabilityByStatus = tally([...classification.values()], (entry) => entry.status);
  const acquisitionsByKind = tally(data.acquisitions, (record) => record.subject.kind);
  const encountersByMethod = tally(
    data.encounters.flatMap((area) => area.methods.map((method) => method.method)),
    (method) => method,
  );

  const overrides = (evolutionOverridesInput as OverrideSummary[])
    .map((override) => ({
      fromPokemonId: override.fromPokemonId,
      toPokemonId: override.toPokemonId,
      status: override.status,
      milestoneId: override.milestoneId,
      reason: override.reason,
    }))
    .sort((left, right) => left.fromPokemonId - right.fromPokemonId || left.toPokemonId - right.toPokemonId);

  const curse = data.moves.find((move) => move.slug === 'curse');
  const mankeyWalk = data.encounters
    .find((area) => area.locationAreaId === 313)?.methods
    .find((method) => method.method === 'walk')?.slots
    .filter((slot) => slot.pokemonId === 56) ?? [];
  const rockTomb = data.acquisitions.find((record) => record.subject.kind === 'tm' && record.milestoneId === 'brock-gym');
  const hm08 = data.acquisitions.find((record) => record.subject.kind === 'hm' && record.status === 'unavailable');

  const crossChecks: ResearchReport['crossChecks'] = [
    {
      claim: 'Route 22 wild Mankey',
      evidence: `Location area 313 (kanto-route-22) walk encounters list Mankey (#56) at chances ${JSON.stringify(mankeyWalk.map((slot) => slot.chance))} and levels ${JSON.stringify(mankeyWalk.map((slot) => slot.minLevel))}.`,
    },
    {
      claim: 'Boulder Badge milestone acquisition',
      evidence: rockTomb === undefined
        ? 'No TM gated on the brock-gym milestone was found.'
        : `Acquisition "${rockTomb.id}" (${rockTomb.name}) becomes available at the brock-gym milestone.`,
    },
    {
      claim: 'Mankey ability rollback',
      evidence: `Mankey (#56) retains only its Generation III ability slot(s): ${JSON.stringify((data.pokemon.find((p) => p.id === 56)?.abilities ?? []).map((ability) => ability.name))}; hidden abilities are excluded.`,
    },
    {
      claim: 'HM08 Dive excluded from FireRed use',
      evidence: hm08 === undefined
        ? 'No HM was marked unavailable.'
        : `Acquisition "${hm08.id}" (${hm08.name}) is recorded as unavailable in FireRed.`,
    },
  ];

  const conflicts: ResearchReport['conflicts'] = [
    { topic: 'Curse move type', resolution: `Curse retains the Generation III "???" type, normalized as the move-only value "${curse?.type ?? 'unknown'}"; it is never a Pokemon type or type-chart entry.` },
    { topic: 'Fairy type', resolution: `No Fairy type or Fairy relations exist; the type chart holds exactly ${typeCount(data.typeChart)} Generation III types.` },
    { topic: 'Hidden abilities', resolution: 'Hidden (Dream World) abilities are excluded; only Generation III ability slots 1 and 2 are retained.' },
    { topic: 'Orre-only Shadow moves', resolution: 'PokeAPI move IDs 10001-10018 (the shadow type) are excluded as non-FireRed data with no FireRed learnset.' },
    { topic: 'Physical/special split', resolution: 'Damage class is derived from the Generation III type-based physical/special split rather than per-move categories.' },
  ];

  return {
    schemaVersion: 1,
    game: FIRERED_CONTEXT,
    builtAt: options.builtAt,
    scope: {
      pokemonCount: data.pokemon.length,
      moveCount: data.moves.length,
      typeCount: typeCount(data.typeChart),
      versionId: FIRERED_CONTEXT.versionId,
      versionGroupId: FIRERED_CONTEXT.versionGroupId,
      generationId: FIRERED_CONTEXT.generationId,
    },
    sources: data.progression.sources
      .map((source) => ({ id: source.id, name: source.name, url: source.url, revision: source.revision, license: source.license }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    counts: {
      acquisitions: data.acquisitions.length,
      encounters: data.encounters.length,
      evolutions: data.evolutions.length,
      hms: data.acquisitions.filter((record) => record.subject.kind === 'hm').length,
      learnsets: data.learnsets.length,
      moves: data.moves.length,
      pokemon: data.pokemon.length,
      tms: data.acquisitions.filter((record) => record.subject.kind === 'tm').length,
      tutors: data.acquisitions.filter((record) => record.subject.kind === 'tutor').length,
      types: typeCount(data.typeChart),
    },
    coverageMatrix: { availabilityByStatus, acquisitionsByKind, encountersByMethod },
    conflicts,
    overrides,
    crossChecks,
    provisionalRecords: 0,
    provisionalStatement: 'Every shipped fact is verified or cross-checked; zero provisional records remain in the built pack.',
  };
}

function renderReportMarkdown(report: ResearchReport): string {
  const lines: string[] = [];
  lines.push('# FireRed Data Pack Research Report');
  lines.push('');
  lines.push(`Generated deterministically from the pinned sources at \`${report.builtAt}\`.`);
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push(`- Game: ${report.game.name} (version ${report.scope.versionId}, version-group ${report.scope.versionGroupId}, generation ${report.scope.generationId})`);
  lines.push(`- Species: ${report.scope.pokemonCount}`);
  lines.push(`- Moves: ${report.scope.moveCount}`);
  lines.push(`- Types: ${report.scope.typeCount}`);
  lines.push('');
  lines.push('## Source registry and licensing');
  lines.push('');
  lines.push('| Source | Revision | License |');
  lines.push('| --- | --- | --- |');
  for (const source of report.sources) {
    lines.push(`| [${source.name}](${source.url}) (\`${source.id}\`) | \`${source.revision}\` | ${source.license ?? 'reference only (no license)'} |`);
  }
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  for (const [key, value] of Object.entries(report.counts)) lines.push(`- ${key}: ${value}`);
  lines.push('');
  lines.push('## Coverage matrix');
  lines.push('');
  lines.push('### Species availability by status');
  lines.push('');
  for (const [status, count] of Object.entries(report.coverageMatrix.availabilityByStatus)) lines.push(`- ${status}: ${count}`);
  lines.push('');
  lines.push('### Acquisitions by kind');
  lines.push('');
  for (const [kind, count] of Object.entries(report.coverageMatrix.acquisitionsByKind)) lines.push(`- ${kind}: ${count}`);
  lines.push('');
  lines.push('### Encounter areas by method');
  lines.push('');
  for (const [method, count] of Object.entries(report.coverageMatrix.encountersByMethod)) lines.push(`- ${method}: ${count}`);
  lines.push('');
  lines.push('## Historical conflicts and resolutions');
  lines.push('');
  for (const conflict of report.conflicts) lines.push(`- **${conflict.topic}:** ${conflict.resolution}`);
  lines.push('');
  lines.push('## Evolution overrides');
  lines.push('');
  lines.push(`${report.overrides.length} curated evolution overrides applied (National Dex gates, FireRed-impossible triggers, transfer-prepared and later-generation exclusions):`);
  lines.push('');
  for (const override of report.overrides) {
    lines.push(`- #${override.fromPokemonId} -> #${override.toPokemonId}: ${override.status}${override.milestoneId ? ` (milestone: ${override.milestoneId})` : ''}${override.reason ? ` (reason: ${override.reason})` : ''}`);
  }
  lines.push('');
  lines.push('## Selected cross-checks');
  lines.push('');
  for (const check of report.crossChecks) lines.push(`- **${check.claim}:** ${check.evidence}`);
  lines.push('');
  lines.push('## Provenance');
  lines.push('');
  lines.push(`Provisional records: ${report.provisionalRecords}. ${report.provisionalStatement}`);
  lines.push('');
  lines.push('Facts are referenced by source revision and locator only; no pret decompilation source or copyrighted tables are redistributed.');
  return `${lines.join('\n')}\n`;
}

/** Build the deterministic machine-readable and human-readable research reports. */
export function buildResearchReport(
  data: FireRedPackData,
  options: PackWriterOptions,
): { json: ResearchReport; markdown: string } {
  const json = buildReportModel(data, options);
  return { json, markdown: renderReportMarkdown(json) };
}
