import {
  migratePlaythrough,
  type Playthrough,
  type PlaythroughPackIndex,
} from '../domain/playthrough';

/**
 * Serialize a value to deterministic JSON: object keys are emitted in sorted order at every depth
 * (arrays keep their order), so two records with the same content always produce byte-identical
 * text regardless of key insertion order. This keeps exports stable and diffable.
 */
function stableStringify(value: unknown, indent: number, level: number): string {
  const pad = ' '.repeat(indent * level);
  const childPad = ' '.repeat(indent * (level + 1));
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => childPad + stableStringify(item, indent, level + 1));
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return '{}';
  const rendered = entries.map(
    ([key, v]) => `${childPad}${JSON.stringify(key)}: ${stableStringify(v, indent, level + 1)}`,
  );
  return `{\n${rendered.join(',\n')}\n${pad}}`;
}

/**
 * Emit a playthrough as stable, pretty-printed JSON. The record already carries `schemaVersion` and
 * `packVersion`, so the exported text is self-describing. A trailing newline keeps it POSIX-clean
 * and diff-friendly.
 */
export function serializePlaythroughExport(playthrough: Playthrough): string {
  return `${stableStringify(playthrough, 2, 0)}\n`;
}

function normalizedFilenameStem(name: string): string {
  const stem = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
    .replace(/-+$/gu, '');
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(stem) ? `${stem}-plan` : stem;
}

/** Create a portable, deterministic JSON file without triggering browser navigation or writes. */
export function createPlaythroughDownload(playthrough: Playthrough): { filename: string; blob: Blob } {
  const filenameStem = normalizedFilenameStem(playthrough.name) || 'pokeplanner-plan';
  return {
    filename: `${filenameStem}.json`,
    blob: new Blob([serializePlaythroughExport(playthrough)], { type: 'application/json;charset=utf-8' }),
  };
}

/**
 * Parse → migrate → validate imported text WITHOUT writing anything. On success it returns a
 * validated current-schema record; the CALLER is responsible for writing it once (and for
 * preserving any existing record on failure). Rejects — by throwing — malformed JSON, unknown
 * referenced ids, invalid team slots, and unsupported future schema versions; migrates a supported
 * older schema. Because it never touches a repository, a failed import can never corrupt stored
 * state.
 */
export function preparePlaythroughImport(text: string, pack: PlaythroughPackIndex): Playthrough {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Import is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = migratePlaythrough(parsed, pack);
  if (!result.ok) throw new Error(`Import failed validation: ${result.error}`);
  return result.playthrough;
}
