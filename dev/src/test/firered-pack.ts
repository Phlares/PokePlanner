import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFireRedPack, type FireRedPack } from '../data/game-pack';
import { MILESTONE_ORDER } from '../domain/availability';
import { parsePlaythrough, type Playthrough, type PlaythroughPackIndex } from '../domain/playthrough';
import {
  fireRedIndexesSchema,
  parseAcquisitionRecords,
  parseEncounterAreas,
  parseEvolutionEdges,
  parseFireRedPackManifest,
  parseLearnsetRecords,
  parseMoveRecords,
  parsePokemonRecords,
  parseTypeChart,
} from '../domain/pack';
import { validateRouteProgression, type RouteProgression } from '../domain/progression';
import { FIRE_RED_RULES } from '../domain/rules/firered-rules';
import {
  acquireMember,
  copyKeyframe,
  placeInParty,
  replaceSlotEdit,
} from '../domain/timeline/commands';
import { createEmptyTimeline, type MemberSnapshot, type TimelineKeyframe } from '../domain/timeline/model';
import { applyPropagation, previewPropagation, type PropagationPreview } from '../domain/timeline/propagation';
import type { TimelineResolverPackView } from '../domain/timeline/resolver';

/**
 * Scoped test helper (Task 11): assemble a real {@link FireRedPack} from the committed
 * generated assets under `public/data/firered/*.json`. It reads the bytes with `node:fs`,
 * runs the same strict `parse*` validators the runtime loader uses, and calls
 * {@link buildFireRedPack} so UI tests assert against real facts (Route 22 Mankey, the Brock
 * milestone) instead of hand-rolled doubles. No network, no Web Crypto, no hash step — the
 * bytes are already on disk and trusted; this only exists for tests.
 */
const PACK_DIR = resolve(process.cwd(), 'public/data/firered');

function readAsset(path: string): unknown {
  return JSON.parse(readFileSync(resolve(PACK_DIR, path), 'utf8'));
}

function parseProgression(input: unknown): RouteProgression {
  const result = validateRouteProgression(input);
  if (!result.valid) {
    throw new Error(`Fixture progression asset is invalid:\n${result.errors.join('\n')}`);
  }
  return input as RouteProgression;
}

let cached: FireRedPack | null = null;

/** Build (once, memoized) the real FireRed pack for interface tests. */
export function loadFireRedPackFixture(): FireRedPack {
  if (cached !== null) return cached;
  const indexShape = fireRedIndexesSchema.shape;
  cached = buildFireRedPack({
    manifest: parseFireRedPackManifest(readAsset('manifest.json')),
    pokemon: parsePokemonRecords(readAsset('pokemon.json')),
    moves: parseMoveRecords(readAsset('moves.json')),
    learnsets: parseLearnsetRecords(readAsset('learnsets.json')),
    encounters: parseEncounterAreas(readAsset('encounters.json')),
    progression: parseProgression(readAsset('progression.json')),
    acquisitions: parseAcquisitionRecords(readAsset('acquisitions.json')),
    evolutions: parseEvolutionEdges(readAsset('evolutions.json')),
    typeChart: parseTypeChart(readAsset('type-chart.json')),
    indexes: {
      pokemonByMove: indexShape.pokemonByMove.parse(readAsset('indexes/pokemon-by-move.json')),
      pokemonByType: indexShape.pokemonByType.parse(readAsset('indexes/pokemon-by-type.json')),
      pokemonByAbility: indexShape.pokemonByAbility.parse(readAsset('indexes/pokemon-by-ability.json')),
      routesByPokemon: indexShape.routesByPokemon.parse(readAsset('indexes/routes-by-pokemon.json')),
      availabilityByMilestone: indexShape.availabilityByMilestone.parse(
        readAsset('indexes/availability-by-milestone.json'),
      ),
    },
  });
  return cached;
}

/** The complete canonical-reference surface used by timeline acceptance fixtures. */
export function fireRedPackIndex(pack: FireRedPack): PlaythroughPackIndex & TimelineResolverPackView {
  const pokemonById = new Map(pack.pokemon.map((record) => [record.id, record]));
  const milestones = new Set<string>([
    ...MILESTONE_ORDER,
    ...FIRE_RED_RULES.milestones.map((milestone) => milestone.id),
  ]);
  const acquisitions = new Set(pack.acquisitions.map((record) => record.id));
  const nodes = new Set(pack.progression.nodes.map((node) => node.id));
  return {
    hasSpecies: (id) => pokemonById.has(id),
    legalAbilityIds: (id) => pokemonById.get(id)?.abilities.map((ability) => ability.id) ?? [],
    isVersionValidMove: (id, moveId) => (
      pack.learnsets.find((record) => record.pokemonId === id)?.moves.some((move) => move.moveId === moveId) ?? false
    ),
    hasMilestone: (id) => milestones.has(id),
    hasAcquisition: (id) => acquisitions.has(id),
    hasNode: (id) => id === 'starter' || nodes.has(id) || milestones.has(id),
    starterNodeId: () => 'starter',
    evolutionEdgesFrom: (speciesId) => pack.evolutions.filter((edge) => edge.fromPokemonId === speciesId),
  };
}

export interface TimelineAcceptanceFixture {
  playthrough: Playthrough;
  starterMemberId: string;
  mankeyMemberIds: readonly [string, string];
  replacementPreview: PropagationPreview;
}

function placedSnapshot(
  snapshot: MemberSnapshot,
  placement: MemberSnapshot['placement'],
  partySlot: MemberSnapshot['partySlot'],
): MemberSnapshot {
  return {
    ...snapshot,
    moves: snapshot.moves.map((move) => ({ ...move })),
    placement,
    partySlot,
    review: { ...snapshot.review },
  };
}

/**
 * Assemble the cross-module acceptance seed using the same public commands as production callers.
 * Route 22 is deliberately only acquisition metadata: its UI state must remain derived until edited.
 */
export function createTimelineAcceptanceFixture(pack: FireRedPack = loadFireRedPackFixture()): TimelineAcceptanceFixture {
  const index = fireRedPackIndex(pack);
  const starterMemberId = 'acceptance-starter';
  const mankeyMemberIds = ['acceptance-mankey-a', 'acceptance-mankey-b'] as const;
  let timeline = createEmptyTimeline();
  timeline = acquireMember(timeline, {
    memberId: starterMemberId,
    speciesId: 4,
    nodeId: 'starter',
    abilityId: 66,
    level: 5,
    moves: [],
    heldItemId: null,
    origin: { type: 'inferred', acquisitionId: null, note: null },
    nickname: null,
    natureId: null,
    notes: '',
  }, index);
  timeline = placeInParty(timeline, 'starter', starterMemberId, 0, index);
  for (const memberId of mankeyMemberIds) {
    timeline = acquireMember(timeline, {
      memberId,
      speciesId: 56,
      nodeId: 'kanto-route-22',
      abilityId: 72,
      level: 5,
      moves: [],
      heldItemId: null,
      origin: { type: 'inferred', acquisitionId: null, note: null },
      nickname: null,
      natureId: null,
      notes: '',
    }, index);
  }

  const starterSnapshot = timeline.keyframes.starter.snapshots[starterMemberId];
  const route22 = timeline.keyframes['kanto-route-22'];
  const mankeyOneSnapshot = route22.snapshots[mankeyMemberIds[0]];
  const mankeyTwoSnapshot = route22.snapshots[mankeyMemberIds[1]];
  const brock: TimelineKeyframe = {
    nodeId: 'brock-gym',
    kind: 'major',
    party: [starterMemberId, mankeyMemberIds[0], null, null, null, null],
    reserve: [mankeyMemberIds[1]],
    released: [],
    snapshots: {
      [starterMemberId]: placedSnapshot(starterSnapshot, 'party', 0),
      [mankeyMemberIds[0]]: placedSnapshot(mankeyOneSnapshot, 'party', 1),
      [mankeyMemberIds[1]]: placedSnapshot(mankeyTwoSnapshot, 'reserve', null),
    },
  };
  timeline = {
    ...timeline,
    keyframes: { starter: timeline.keyframes.starter, 'brock-gym': brock },
    preferences: { levelMode: 'match', autoEvolveLevel: false },
  };
  timeline = copyKeyframe(timeline, 'brock-gym', 'misty-gym', {
    levelMode: 'match',
    targetLevel: 21,
    autoEvolveLevel: false,
    pack: index,
  });
  timeline = {
    ...timeline,
    overrides: {
      'mt-moon': {
        ...brock,
        nodeId: 'mt-moon',
        kind: 'override',
        party: [...brock.party],
        reserve: [...brock.reserve],
        snapshots: Object.fromEntries(Object.entries(brock.snapshots).map(([memberId, snapshot]) => [
          memberId,
          placedSnapshot(snapshot, snapshot.placement, snapshot.partySlot),
        ])),
      },
    },
  };

  const milestoneOrder = ['starter', 'kanto-route-22', 'brock-gym', 'mt-moon', 'misty-gym'];
  const replacement = replaceSlotEdit('brock-gym', 0, mankeyMemberIds[0]);
  const replacementPreview = previewPropagation(timeline, replacement, 'forward', milestoneOrder);
  timeline = applyPropagation(timeline, replacement, 'forward', milestoneOrder, replacementPreview);

  return {
    starterMemberId,
    mankeyMemberIds,
    replacementPreview,
    playthrough: parsePlaythrough({
      schemaVersion: 2,
      packVersion: pack.manifest.packVersion,
      id: 'timeline-acceptance-run',
      name: 'Timeline acceptance',
      game: 'firered',
      type: 'standard',
      createdAt: 1000,
      updatedAt: 1000,
      starterSpeciesId: 4,
      branchChoices: {},
      currentMilestoneId: 'starter',
      previewMilestoneId: 'brock-gym',
      timeline,
      notes: '',
      acquisitionOverrides: [],
      checkoffs: { routesCompleted: {}, encountered: {}, captured: {} },
    }, index),
  };
}
