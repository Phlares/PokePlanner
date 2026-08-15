import type { Playthrough, PlaythroughPackIndex } from '../domain/playthrough';
import { preparePlaythroughImport } from './export-import';
import { preparePlanCodeImport } from './plan-code';

/** Where an importable run came from. The three sources differ only in how the bytes are found. */
export type RunImportSource = 'json' | 'plan-code' | 'share-url';

/**
 * The single confirmation surface behind every import. Building one of these validates the payload
 * completely — format, schema, and every pack reference — but writes nothing, so the run currently
 * open survives an import the user then cancels or that never validated at all.
 */
export interface RunImportPreview {
  playthrough: Playthrough;
  source: RunImportSource;
  name: string;
  game: Playthrough['game'];
  memberCount: number;
  milestoneCount: number;
  warnings: readonly string[];
}

/** `PP1.<base64url>.<crc32>` — the exact shape {@link encodePlanCode} emits. */
const PLAN_CODE = /^PP1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/u;

/**
 * Pull a plan code out of a share link. A share link is local by construction: it carries the plan
 * itself in `?plan=` or `#plan=`, so decoding is pure string work with no network call, no hosted
 * id, and no server. Anything else — a link with no plan, a plan that is not a code, a non-web
 * scheme, or text that is not a URL — is simply not a share link.
 */
export function planCodeFromShareUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const fragment = new URLSearchParams(url.hash.replace(/^#/u, ''));
  const code = url.searchParams.get('plan') ?? fragment.get('plan');
  return code !== null && PLAN_CODE.test(code) ? code : null;
}

function isWebUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function packVersionWarnings(playthrough: Playthrough, currentPackVersion?: string): string[] {
  return currentPackVersion !== undefined && playthrough.packVersion !== currentPackVersion
    ? [`This plan uses pack "${playthrough.packVersion}"; the current pack is "${currentPackVersion}".`]
    : [];
}

/**
 * Turn one piece of user-supplied text into one validated preview, whatever carried it. The source
 * is detected here and nowhere else — a share link yields its plan code, a bare plan code is used
 * as-is, and everything else is read as an exported JSON record — so all three inputs converge on
 * the same preview-then-confirm path instead of growing three near-identical import flows.
 *
 * Pure: it parses, migrates and validates against the injected pack index, and returns without
 * touching a repository. Failures throw with the reason, leaving any existing record untouched.
 */
export function prepareRunImport(
  input: string,
  pack: PlaythroughPackIndex,
  currentPackVersion?: string,
): RunImportPreview {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new Error('Paste a plan code or share link, or choose a JSON file.');
  }

  const shared = planCodeFromShareUrl(trimmed);
  if (shared !== null) {
    return { ...preparePlanCodeImport(shared, pack, currentPackVersion), source: 'share-url' };
  }
  if (PLAN_CODE.test(trimmed)) {
    return { ...preparePlanCodeImport(trimmed, pack, currentPackVersion), source: 'plan-code' };
  }
  if (isWebUrl(trimmed)) {
    throw new Error('That link does not carry a plan code.');
  }

  const playthrough = preparePlaythroughImport(trimmed, pack);
  return {
    playthrough,
    source: 'json',
    name: playthrough.name,
    game: playthrough.game,
    memberCount: Object.keys(playthrough.timeline.members).length,
    milestoneCount: Object.keys(playthrough.timeline.keyframes).length,
    warnings: packVersionWarnings(playthrough, currentPackVersion),
  };
}
