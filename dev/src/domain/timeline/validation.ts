import { evaluateAcquisitionAtNode } from '../availability';
import type {
  AcquisitionRecord,
  EncounterArea,
  EvolutionEdge,
  LearnsetRecord,
  PokemonRecord,
} from '../pack';
import type { RouteProgression } from '../progression';
import type { GameRules, ProgressionContext } from '../rules/game-rules';
import type { MemberOrigin, MemberSnapshot, PersistentMember } from './model';
import type { ResolvedTimelineNode } from './resolver';

export type FindingSeverity = 'review' | 'yellow' | 'red' | 'unverified';
export type FindingField = 'member' | 'origin' | 'level' | 'evolution' | 'ability' | 'move' | 'held-item' | 'resource';

export type FindingResolutionAction =
  | { type: 'set-origin'; origin: MemberOrigin }
  | { type: 'set-level'; level: number }
  | { type: 'remove-move'; moveId: number }
  | { type: 'change-ability' }
  | { type: 'change-species' }
  | { type: 'edit-member' };

export interface FindingResolution {
  id: string;
  label: string;
  action: FindingResolutionAction;
}

export interface TimelineFinding {
  code: string;
  severity: FindingSeverity;
  memberId: string | null;
  field: FindingField;
  summary: string;
  explanation: string;
  evidenceIds: readonly string[];
  resolutions: readonly FindingResolution[];
}

/** Undefined catalogs mean the pack cannot answer; present empty catalogs are canonical evidence. */
export interface TimelineValidationPack {
  pokemon: readonly PokemonRecord[] | undefined;
  learnsets: readonly LearnsetRecord[] | undefined;
  encounters: readonly EncounterArea[] | undefined;
  acquisitions: readonly AcquisitionRecord[] | undefined;
  evolutions: readonly EvolutionEdge[] | undefined;
}

export interface TimelineValidationContext {
  members: Readonly<Record<string, PersistentMember>>;
  progression: RouteProgression;
  progressionContext: ProgressionContext;
  rules: GameRules;
  pack: TimelineValidationPack;
}

export type OriginInferenceStatus = 'ordinary' | 'ordinary-timing-unverified' | 'override' | 'requires-override' | 'unverified';
export type RequestedOriginType = Exclude<MemberOrigin['type'], 'inferred' | 'other'>;

export interface MemberOriginInference {
  status: OriginInferenceStatus;
  origin: MemberOrigin;
  evidenceIds: readonly string[];
  explanation: string;
  requestedOriginTypes: readonly RequestedOriginType[];
  traded: boolean;
  ordinaryNodeId: string | null;
}

interface OriginCandidate {
  nodeId: string;
  evidenceIds: readonly string[];
  acquisitionId: string;
  traded: boolean;
}

interface UnknownTimingOriginCandidate {
  evidenceIds: readonly string[];
  acquisitionId: string;
  traded: boolean;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function finding(
  code: string,
  severity: FindingSeverity,
  memberId: string,
  field: FindingField,
  summary: string,
  explanation: string,
  evidenceIds: readonly string[],
  resolutions: readonly FindingResolution[] = [],
): TimelineFinding {
  return {
    code,
    severity,
    memberId,
    field,
    summary,
    explanation,
    evidenceIds: sortedUnique(evidenceIds),
    resolutions: [...resolutions].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function editMemberResolution(): FindingResolution {
  return { id: 'member.edit', label: 'Edit member', action: { type: 'edit-member' } };
}

function originResolution(type: RequestedOriginType): FindingResolution {
  return {
    id: `origin.${type}`,
    label: type === 'external-trade' ? 'Mark as externally traded' : `Mark as ${type}`,
    action: { type: 'set-origin', origin: { type, acquisitionId: null, note: null } },
  };
}

function nodeOrder(nodeId: string, progression: RouteProgression): number | null {
  return progression.nodes.find((node) => node.id === nodeId)?.goldenPathOrder ?? null;
}

function encounterCandidates(
  speciesId: number,
  targetOrder: number,
  encounters: readonly EncounterArea[],
  progression: RouteProgression,
): OriginCandidate[] {
  const candidates: OriginCandidate[] = [];
  for (const area of encounters) {
    if (area.nodeId === null) continue;
    const order = nodeOrder(area.nodeId, progression);
    if (order === null || order > targetOrder) continue;
    const ordinaryMethod = area.methods.find((method) => (
      method.method !== 'event'
      && method.method !== 'gift-egg'
      && method.slots.some((slot) => slot.pokemonId === speciesId)
    ));
    if (!ordinaryMethod) continue;
    candidates.push({
      nodeId: area.nodeId,
      evidenceIds: [area.slug, area.nodeId],
      acquisitionId: area.slug,
      traded: false,
    });
  }
  return candidates;
}

function isPokemonAcquisition(
  record: AcquisitionRecord,
): record is AcquisitionRecord & { subject: Extract<AcquisitionRecord['subject'], { pokemonId: number }> } {
  return 'pokemonId' in record.subject;
}

function ordinaryAcquisition(record: AcquisitionRecord): boolean {
  if (!isPokemonAcquisition(record)) return false;
  if (
    record.status === 'event-only'
    || record.status === 'transfer-only'
    || record.status === 'version-exclusive'
    || record.status === 'unavailable'
  ) return false;
  return record.subject.kind !== 'event' && record.subject.kind !== 'transfer' && record.subject.kind !== 'gift-egg';
}

function acquisitionCandidates(
  speciesId: number,
  nodeId: string,
  acquisitions: readonly AcquisitionRecord[],
  context: TimelineValidationContext,
): { available: OriginCandidate[]; timingUnknown: UnknownTimingOriginCandidate[] } {
  const available: OriginCandidate[] = [];
  const timingUnknown: UnknownTimingOriginCandidate[] = [];
  for (const record of acquisitions) {
    if (!isPokemonAcquisition(record) || record.subject.pokemonId !== speciesId || !ordinaryAcquisition(record)) continue;
    const timing = evaluateAcquisitionAtNode(record, nodeId, context.progression, context.rules);
    if (timing.available === true && timing.nodeId !== null) {
      available.push({
        nodeId: timing.nodeId,
        evidenceIds: timing.evidenceIds,
        acquisitionId: record.id,
        traded: record.subject.kind === 'trade',
      });
    } else if (timing.available === null) {
      timingUnknown.push({
        evidenceIds: timing.evidenceIds,
        acquisitionId: record.id,
        traded: record.subject.kind === 'trade',
      });
    }
  }
  return { available, timingUnknown };
}

function requiredOriginTypes(
  speciesId: number,
  acquisitions: readonly AcquisitionRecord[],
): RequestedOriginType[] {
  const requested = new Set<RequestedOriginType>();
  for (const record of acquisitions) {
    if (!isPokemonAcquisition(record) || record.subject.pokemonId !== speciesId) continue;
    if (record.subject.kind === 'event' || record.status === 'event-only') requested.add('event');
    if (record.subject.kind === 'transfer' || record.status === 'transfer-only') requested.add('transfer');
    if (record.subject.kind === 'gift-egg') requested.add('hatched');
  }
  if (requested.size === 0) requested.add('external-trade');
  return [...requested].sort((left, right) => left.localeCompare(right));
}

/** Infer the earliest ordinary path valid at a node, leaving exceptional provenance explicit. */
export function inferMemberOrigin(
  member: PersistentMember,
  nodeId: string,
  context: TimelineValidationContext,
): MemberOriginInference {
  if (member.origin.type !== 'inferred') {
    return {
      status: 'override',
      origin: member.origin,
      evidenceIds: member.origin.acquisitionId === null ? [] : [member.origin.acquisitionId],
      explanation: `The saved ${member.origin.type} origin overrides ordinary acquisition inference.`,
      requestedOriginTypes: [],
      traded: member.origin.type === 'external-trade' || member.origin.type === 'transfer',
      ordinaryNodeId: null,
    };
  }

  const { encounters, acquisitions } = context.pack;
  if (encounters === undefined || acquisitions === undefined) {
    return {
      status: 'unverified',
      origin: member.origin,
      evidenceIds: [],
      explanation: 'The current pack does not include enough acquisition evidence to infer an origin.',
      requestedOriginTypes: [],
      traded: false,
      ordinaryNodeId: null,
    };
  }

  const targetOrder = nodeOrder(nodeId, context.progression);
  if (targetOrder === null) {
    throw new Error(`Corrupt canonical progression: resolved node "${nodeId}" is not present`);
  }
  const acquisitionEvidence = acquisitionCandidates(member.originalSpeciesId, nodeId, acquisitions, context);
  const candidates = [
    ...encounterCandidates(member.originalSpeciesId, targetOrder, encounters, context.progression),
    ...acquisitionEvidence.available,
  ].sort((left, right) => (
    (nodeOrder(left.nodeId, context.progression) ?? Number.POSITIVE_INFINITY)
      - (nodeOrder(right.nodeId, context.progression) ?? Number.POSITIVE_INFINITY)
    || left.acquisitionId.localeCompare(right.acquisitionId)
  ));
  const earliest = candidates[0];
  if (earliest) {
    return {
      status: 'ordinary',
      origin: { type: 'inferred', acquisitionId: earliest.acquisitionId, note: null },
      evidenceIds: sortedUnique(earliest.evidenceIds),
      explanation: `The earliest ordinary acquisition path is available at ${earliest.nodeId}.`,
      requestedOriginTypes: [],
      traded: earliest.traded,
      ordinaryNodeId: earliest.nodeId,
    };
  }

  const timingUnknown = [...acquisitionEvidence.timingUnknown]
    .sort((left, right) => left.acquisitionId.localeCompare(right.acquisitionId))[0];
  if (timingUnknown) {
    return {
      status: 'ordinary-timing-unverified',
      origin: { type: 'inferred', acquisitionId: timingUnknown.acquisitionId, note: null },
      evidenceIds: sortedUnique(timingUnknown.evidenceIds),
      explanation: 'An ordinary acquisition exists, but the pack and rules cannot place it on the progression.',
      requestedOriginTypes: [],
      traded: timingUnknown.traded,
      ordinaryNodeId: null,
    };
  }

  const requested = requiredOriginTypes(member.originalSpeciesId, acquisitions);
  const specialEvidence = acquisitions
    .filter((record) => isPokemonAcquisition(record) && record.subject.pokemonId === member.originalSpeciesId)
    .map((record) => record.id)
    .sort();
  return {
    status: 'requires-override',
    origin: member.origin,
    evidenceIds: specialEvidence,
    explanation: 'No ordinary acquisition path in the current pack is available at this node.',
    requestedOriginTypes: requested,
    traded: false,
    ordinaryNodeId: null,
  };
}

function validateCanonicalLearnsetReferences(pack: TimelineValidationPack): void {
  if (pack.learnsets === undefined || pack.acquisitions === undefined) return;
  const acquisitionIds = new Set(pack.acquisitions.map((record) => record.id));
  for (const learnset of pack.learnsets) {
    for (const method of learnset.moves) {
      if (method.method !== 'machine' && method.method !== 'tutor') continue;
      for (const acquisitionId of method.acquisitionIds) {
        if (!acquisitionIds.has(acquisitionId)) {
          throw new Error(`Corrupt canonical pack: learnset ${learnset.pokemonId} references missing acquisition "${acquisitionId}"`);
        }
      }
    }
  }
}

interface ResolvedIntegrity {
  memberIds: string[];
  findings: TimelineFinding[];
}

function validateResolvedIntegrity(node: ResolvedTimelineNode, context: TimelineValidationContext): ResolvedIntegrity {
  if (nodeOrder(node.nodeId, context.progression) === null) {
    throw new Error(`Corrupt canonical progression: resolved node "${node.nodeId}" is not present`);
  }
  const placements = [...node.party.filter((id): id is string => id !== null), ...node.reserve, ...node.released];
  const findings: TimelineFinding[] = [];
  const counts = new Map<string, number>();
  placements.forEach((memberId) => counts.set(memberId, (counts.get(memberId) ?? 0) + 1));
  for (const [memberId, count] of counts) {
    if (count > 1) {
      findings.push(finding(
        'node.placement-duplicate', 'red', memberId, 'member', 'Member has multiple placements',
        `Member "${memberId}" appears ${count} times at the same resolved node.`,
        [node.nodeId, memberId, `placements:${count}`],
      ));
    }
  }

  const memberIds: string[] = [];
  for (const memberId of counts.keys()) {
    if (!context.members[memberId]) {
      findings.push(finding(
        'node.member-unknown', 'red', memberId, 'member', 'Resolved placement references an unknown member',
        `Member "${memberId}" is placed at this node but is absent from timeline members.`, [node.nodeId, memberId],
      ));
    } else if (!node.snapshots[memberId]) {
      findings.push(finding(
        'node.snapshot-missing', 'red', memberId, 'member', 'Placed member has no snapshot',
        `Member "${memberId}" is placed at this node without a resolved configuration snapshot.`, [node.nodeId, memberId],
      ));
    } else {
      memberIds.push(memberId);
    }
  }
  for (const memberId of Object.keys(node.snapshots)) {
    if (!counts.has(memberId)) {
      findings.push(finding(
        'node.snapshot-unplaced', 'red', memberId, 'member', 'Snapshot has no placement',
        `Member "${memberId}" has a resolved snapshot but is absent from party, reserve, and released placements.`,
        [node.nodeId, memberId],
      ));
    }
  }
  return { memberIds, findings };
}

function originFindings(
  member: PersistentMember,
  snapshot: MemberSnapshot,
  node: ResolvedTimelineNode,
  context: TimelineValidationContext,
  inference: MemberOriginInference,
): TimelineFinding[] {
  const findings: TimelineFinding[] = [];
  if (member.origin.acquisitionId !== null) {
    if (context.pack.acquisitions === undefined) {
      findings.push(finding(
        'origin.acquisition-unverified', 'unverified', member.id, 'origin', 'Origin acquisition is unverified',
        'The current pack does not include acquisition records for this saved origin.',
        [member.origin.acquisitionId], [editMemberResolution()],
      ));
    } else {
      const record = context.pack.acquisitions.find((candidate) => candidate.id === member.origin.acquisitionId);
      if (!record) {
        findings.push(finding(
          'origin.acquisition-unknown', 'red', member.id, 'origin', 'Origin acquisition is unknown',
          `The saved acquisition "${member.origin.acquisitionId}" is not present in the canonical pack.`,
          [member.origin.acquisitionId], [editMemberResolution()],
        ));
      } else if (!isPokemonAcquisition(record) || record.subject.pokemonId !== member.originalSpeciesId) {
        findings.push(finding(
          'origin.acquisition-mismatch', 'red', member.id, 'origin', 'Origin acquisition does not match this member',
          'The saved acquisition belongs to another subject or species.',
          [record.id, `pokemon:${member.originalSpeciesId}`], [editMemberResolution()],
        ));
      }
    }
  }
  if (inference.status === 'unverified') {
    findings.push(finding(
      'origin.evidence-missing', 'unverified', member.id, 'origin', 'Origin is unverified',
      inference.explanation, inference.evidenceIds, [editMemberResolution()],
    ));
  } else if (inference.status === 'ordinary-timing-unverified') {
    findings.push(finding(
      'origin.timing-unverified', 'unverified', member.id, 'origin', 'Ordinary origin timing is unverified',
      inference.explanation, inference.evidenceIds, [editMemberResolution()],
    ));
  } else if (inference.status === 'requires-override') {
    findings.push(finding(
      'origin.no-ordinary-path', 'red', member.id, 'origin', 'No ordinary origin is available yet',
      inference.explanation, inference.evidenceIds, inference.requestedOriginTypes.map(originResolution),
    ));
  }

  const acquiredOrder = nodeOrder(member.acquiredAtNodeId, context.progression);
  const selectedOrder = nodeOrder(node.nodeId, context.progression);
  if (acquiredOrder === null) {
    findings.push(finding(
      'origin.acquisition-node-unverified', 'unverified', member.id, 'origin', 'Acquisition node is unverified',
      `The configured acquisition node "${member.acquiredAtNodeId}" is not present in the supplied progression evidence.`,
      [member.acquiredAtNodeId], [editMemberResolution()],
    ));
  } else if (selectedOrder !== null && acquiredOrder > selectedOrder) {
    findings.push(finding(
      'origin.before-acquisition', 'red', member.id, 'origin', 'Member appears before acquisition',
      `This member is configured to join at ${member.acquiredAtNodeId}, after the selected node.`,
      [member.acquiredAtNodeId, node.nodeId], [editMemberResolution()],
    ));
  } else if (inference.ordinaryNodeId !== null) {
    const ordinaryOrder = nodeOrder(inference.ordinaryNodeId, context.progression);
    if (ordinaryOrder !== null && acquiredOrder < ordinaryOrder) {
      findings.push(finding(
        'origin.acquisition-conflict', 'red', member.id, 'origin', 'Configured acquisition precedes the inferred path',
        `This member is configured to join at ${member.acquiredAtNodeId}, before the earliest ordinary path at ${inference.ordinaryNodeId}.`,
        [member.acquiredAtNodeId, ...inference.evidenceIds], [editMemberResolution()],
      ));
    }
  }

  if (member.origin.type === 'external-trade') {
    findings.push(finding(
      'origin.external-trade', 'yellow', member.id, 'origin', 'Externally traded Pokémon',
      'This member is possible through an external trade and remains subject to trade unlock and obedience rules.',
      inference.evidenceIds, [editMemberResolution()],
    ));
  } else if (member.origin.type === 'transfer') {
    findings.push(finding(
      'origin.transfer', 'yellow', member.id, 'origin', 'Transferred Pokémon',
      'This member uses a conditional transfer origin rather than an ordinary FireRed acquisition.',
      inference.evidenceIds, [editMemberResolution()],
    ));
  } else if (member.origin.type === 'event') {
    findings.push(finding(
      'origin.event', 'yellow', member.id, 'origin', 'Event Pokémon',
      'This member depends on event distribution evidence.', inference.evidenceIds, [editMemberResolution()],
    ));
  } else if (member.origin.type === 'hatched') {
    findings.push(finding(
      'origin.hatched', 'yellow', member.id, 'origin', 'Hatched Pokémon',
      'This member depends on breeding and hatching rather than an ordinary encounter.', inference.evidenceIds, [editMemberResolution()],
    ));
  } else if (member.origin.type === 'other') {
    findings.push(finding(
      'origin.other-unverified', 'unverified', member.id, 'origin', 'Custom origin is unverified',
      member.origin.note?.trim() || 'The custom origin is outside the current version rules.',
      inference.evidenceIds, [editMemberResolution()],
    ));
  }

  if (inference.traded && !context.rules.canTrade(context.progressionContext)) {
    findings.push(finding(
      'origin.trade-locked', 'red', member.id, 'origin', 'Trading is not unlocked',
      'This traded origin is configured before the version rules allow trading.',
      ['rule:trade-unlock', ...inference.evidenceIds], [editMemberResolution()],
    ));
  }
  const obedienceLimit = inference.traded ? context.rules.tradedObedienceLimit(context.progressionContext) : null;
  if (obedienceLimit !== null && snapshot.level > obedienceLimit) {
    findings.push(finding(
      'level.traded-obedience', 'red', member.id, 'level', 'Traded Pokémon may not obey',
      `A traded member above level ${obedienceLimit} may not obey with the current badges.`,
      ['rule:traded-obedience', ...context.progressionContext.badgeIds],
      [{ id: 'level.obedient-limit', label: `Set level to ${obedienceLimit}`, action: { type: 'set-level', level: obedienceLimit } }],
    ));
  }
  return findings;
}

function abilityFindings(memberId: string, snapshot: MemberSnapshot, pack: TimelineValidationPack): TimelineFinding[] {
  if (pack.pokemon === undefined) {
    return [finding(
      'ability.evidence-missing', 'unverified', memberId, 'ability', 'Ability is unverified',
      'The current pack does not include Pokémon ability evidence.', [`pokemon:${snapshot.speciesId}`],
      [{ id: 'ability.change', label: 'Choose another ability', action: { type: 'change-ability' } }],
    )];
  }
  const species = pack.pokemon.find((record) => record.id === snapshot.speciesId);
  if (!species) {
    return [finding(
      'species.unknown', 'red', memberId, 'evolution', 'Species is not in the pack',
      `Species ${snapshot.speciesId} is not present in the canonical Pokémon catalog.`, [`pokemon:${snapshot.speciesId}`],
      [{ id: 'species.change', label: 'Choose another species', action: { type: 'change-species' } }],
    )];
  }
  if (species.abilities.some((ability) => ability.id === snapshot.abilityId)) return [];
  return [finding(
    'ability.invalid', 'red', memberId, 'ability', 'Ability is not available for this species',
    `Ability ${snapshot.abilityId} is not a canonical ability for ${species.name}.`,
    [`pokemon:${snapshot.speciesId}`, `ability:${snapshot.abilityId}`],
    [{ id: 'ability.change', label: 'Choose another ability', action: { type: 'change-ability' } }],
  )];
}

function evolutionFindings(
  member: PersistentMember,
  snapshot: MemberSnapshot,
  context: TimelineValidationContext,
): TimelineFinding[] {
  if (snapshot.speciesId === member.originalSpeciesId) return [];
  const { pack } = context;
  if (pack.evolutions === undefined) {
    return [finding(
      'evolution.evidence-missing', 'unverified', member.id, 'evolution', 'Evolution is unverified',
      'The current pack does not include evolution evidence.',
      [`pokemon:${member.originalSpeciesId}`, `pokemon:${snapshot.speciesId}`],
      [{ id: 'species.change', label: 'Choose another species', action: { type: 'change-species' } }],
    )];
  }
  const pending: Array<{ speciesId: number; path: EvolutionEdge[] }> = [{ speciesId: member.originalSpeciesId, path: [] }];
  const visited = new Set<number>();
  let path: EvolutionEdge[] | null = null;
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined || visited.has(current.speciesId)) continue;
    if (current.speciesId === snapshot.speciesId) {
      path = current.path;
      break;
    }
    visited.add(current.speciesId);
    pack.evolutions
      .filter((edge) => edge.fromPokemonId === current.speciesId)
      .forEach((edge) => pending.push({ speciesId: edge.toPokemonId, path: [...current.path, edge] }));
  }
  if (path === null) {
    return [finding(
      'evolution.invalid', 'red', member.id, 'evolution', 'Species is outside this member’s evolution line',
      `Species ${snapshot.speciesId} is not reachable from original species ${member.originalSpeciesId}.`,
      [`pokemon:${member.originalSpeciesId}`, `pokemon:${snapshot.speciesId}`],
      [{ id: 'species.change', label: 'Choose another species', action: { type: 'change-species' } }],
    )];
  }

  const findings: TimelineFinding[] = [];
  for (const edge of path) {
    const evidenceIds = [`pokemon:${edge.fromPokemonId}`, `pokemon:${edge.toPokemonId}`, `evolution:${edge.trigger}`];
    if (edge.status === 'unavailable') {
      findings.push(finding(
        'evolution.unavailable', 'red', member.id, 'evolution', 'Evolution is unavailable in this version',
        edge.reason ?? 'This canonical evolution edge is unavailable in the selected game.', evidenceIds,
        [{ id: 'species.change', label: 'Choose another species', action: { type: 'change-species' } }],
      ));
      continue;
    }
    if (edge.minimumLevel !== null && snapshot.level < edge.minimumLevel) {
      findings.push(finding(
        'evolution.level-locked', 'red', member.id, 'evolution', 'Evolution requires a higher level',
        `This evolution requires level ${edge.minimumLevel}, above the configured level ${snapshot.level}.`,
        [...evidenceIds, `level:${edge.minimumLevel}`],
        [{ id: 'level.evolution', label: `Set level to ${edge.minimumLevel}`, action: { type: 'set-level', level: edge.minimumLevel } }],
      ));
    }
    if (edge.milestoneId !== null && !context.progressionContext.completedMilestoneIds.has(edge.milestoneId)) {
      findings.push(finding(
        'evolution.milestone-locked', 'red', member.id, 'evolution', 'Evolution milestone is not complete',
        `This evolution requires ${edge.milestoneId} before the selected state.`, [...evidenceIds, edge.milestoneId],
        [{ id: 'species.change', label: 'Choose another species', action: { type: 'change-species' } }],
      ));
    }
    if (edge.trigger === 'trade') {
      findings.push(finding(
        context.rules.canTrade(context.progressionContext) ? 'evolution.trade-required' : 'evolution.trade-locked',
        context.rules.canTrade(context.progressionContext) ? 'yellow' : 'red',
        member.id,
        'evolution',
        context.rules.canTrade(context.progressionContext) ? 'Evolution requires a trade' : 'Trade evolution is not unlocked',
        context.rules.canTrade(context.progressionContext)
          ? 'This evolution is officially possible but requires a trade.'
          : 'This evolution requires trading before the version rules unlock it.',
        evidenceIds,
        [{ id: 'species.change', label: 'Choose another species', action: { type: 'change-species' } }],
      ));
    } else if (edge.trigger !== 'level' || edge.itemId !== null || edge.locationId !== null || edge.reason !== null) {
      findings.push(finding(
        'evolution.conditional', 'yellow', member.id, 'evolution', 'Evolution has a conditional requirement',
        edge.reason ?? 'This evolution requires an explicit item, friendship, location, or choice.', evidenceIds,
        [{ id: 'species.change', label: 'Choose another species', action: { type: 'change-species' } }],
      ));
    }
  }
  return findings;
}

function moveFindings(
  member: PersistentMember,
  snapshot: MemberSnapshot,
  node: ResolvedTimelineNode,
  context: TimelineValidationContext,
): TimelineFinding[] {
  if (snapshot.moves.length === 0) return [];
  if (context.pack.learnsets === undefined) {
    return snapshot.moves.map((move) => finding(
      'move.evidence-missing', 'unverified', member.id, 'move', 'Move is unverified',
      'The current pack does not include learnset evidence for this move.',
      [`pokemon:${snapshot.speciesId}`, `move:${move.moveId}`],
      [{ id: `move.remove.${move.moveId}`, label: 'Remove move', action: { type: 'remove-move', moveId: move.moveId } }],
    ));
  }
  const learnset = context.pack.learnsets.find((record) => record.pokemonId === snapshot.speciesId);
  if (!learnset) {
    return snapshot.moves.map((move) => finding(
      'move.evidence-missing', 'unverified', member.id, 'move', 'Move is unverified',
      `No learnset evidence is present for species ${snapshot.speciesId}.`,
      [`pokemon:${snapshot.speciesId}`, `move:${move.moveId}`],
      [{ id: `move.remove.${move.moveId}`, label: 'Remove move', action: { type: 'remove-move', moveId: move.moveId } }],
    ));
  }

  const acquisitionById = context.pack.acquisitions === undefined
    ? null
    : new Map(context.pack.acquisitions.map((record) => [record.id, record]));
  const results: TimelineFinding[] = [];
  for (const move of snapshot.moves) {
    const methods = learnset.moves.filter((method) => method.moveId === move.moveId);
    if (methods.length === 0) {
      results.push(finding(
        'move.unavailable', 'red', member.id, 'move', 'Move is not in this species learnset',
        `Move ${move.moveId} has no canonical learn method for species ${snapshot.speciesId}.`,
        [`pokemon:${snapshot.speciesId}`, `move:${move.moveId}`],
        [{ id: `move.remove.${move.moveId}`, label: 'Remove move', action: { type: 'remove-move', moveId: move.moveId } }],
      ));
      continue;
    }

    let ordinaryNow = false;
    let egg = false;
    let transfer = false;
    let event = false;
    let unavailable = false;
    let unverified = false;
    let futureLevel: number | null = null;
    const futureAcquisitions: string[] = [];
    for (const method of methods) {
      if (method.method === 'level-up') {
        if (method.level <= snapshot.level) ordinaryNow = true;
        else futureLevel = futureLevel === null ? method.level : Math.min(futureLevel, method.level);
      } else if (method.method === 'egg') {
        egg = true;
      } else if (method.method === 'transfer') {
        transfer = true;
      } else if (acquisitionById === null) {
        unverified = true;
      } else {
        for (const acquisitionId of method.acquisitionIds) {
          const record = acquisitionById.get(acquisitionId);
          if (!record) {
            throw new Error(`Corrupt canonical pack: learnset ${learnset.pokemonId} references missing acquisition "${acquisitionId}"`);
          }
          if (record.status === 'unavailable') {
            unavailable = true;
            futureAcquisitions.push(acquisitionId);
            continue;
          }
          if (record.status === 'transfer-only' || record.status === 'version-exclusive') {
            transfer = true;
            continue;
          }
          if (record.status === 'event-only') {
            event = true;
            continue;
          }
          const timing = evaluateAcquisitionAtNode(record, node.nodeId, context.progression, context.rules);
          if (timing.available === true) ordinaryNow = true;
          else if (timing.available === false) futureAcquisitions.push(acquisitionId);
          else unverified = true;
        }
      }
    }
    if (ordinaryNow) continue;

    const evidenceIds = [`pokemon:${snapshot.speciesId}`, `move:${move.moveId}`];
    if (egg) {
      const resolutions = member.origin.type === 'hatched' ? [] : [originResolution('hatched')];
      results.push(finding(
        'move.egg-origin', 'yellow', member.id, 'move', 'Move requires an egg origin',
        'This configured move is available here only as an egg move.',
        [...evidenceIds, 'learnset:egg'], resolutions,
      ));
    } else if (transfer) {
      const resolutions = member.origin.type === 'transfer' ? [] : [originResolution('transfer')];
      results.push(finding(
        'move.transfer-origin', 'yellow', member.id, 'move', 'Move requires transfer provenance',
        'This configured move is available only through transfer evidence.',
        [...evidenceIds, 'learnset:transfer'], resolutions,
      ));
    } else if (event) {
      const resolutions = member.origin.type === 'event' ? [] : [originResolution('event')];
      results.push(finding(
        'move.event-origin', 'yellow', member.id, 'move', 'Move requires event provenance',
        'This configured move is available only through event evidence.',
        [...evidenceIds, 'learnset:event'], resolutions,
      ));
    } else if (unavailable) {
      results.push(finding(
        'move.unavailable', 'red', member.id, 'move', 'Move is unavailable in this version',
        'Every canonical source for this move is marked unavailable in the selected game.',
        [...evidenceIds, ...futureAcquisitions.sort()],
        [{ id: `move.remove.${move.moveId}`, label: 'Remove move', action: { type: 'remove-move', moveId: move.moveId } }],
      ));
    } else if (unverified) {
      results.push(finding(
        'move.evidence-missing', 'unverified', member.id, 'move', 'Move timing is unverified',
        'The pack or rule adapter cannot place this move acquisition on the progression.',
        evidenceIds, [{ id: `move.remove.${move.moveId}`, label: 'Remove move', action: { type: 'remove-move', moveId: move.moveId } }],
      ));
    } else if (futureLevel !== null) {
      results.push(finding(
        'move.level-locked', 'red', member.id, 'move', 'Move requires a higher level',
        `This move is learned at level ${futureLevel}, above the configured level ${snapshot.level}.`,
        [...evidenceIds, `level:${futureLevel}`],
        [{ id: `level.move.${move.moveId}`, label: `Set level to ${futureLevel}`, action: { type: 'set-level', level: futureLevel } }],
      ));
    } else {
      results.push(finding(
        'move.acquisition-locked', 'red', member.id, 'move', 'Move acquisition is not available yet',
        'Every canonical machine or tutor source for this move occurs after the selected node.',
        [...evidenceIds, ...futureAcquisitions.sort()],
        [{ id: `move.remove.${move.moveId}`, label: 'Remove move', action: { type: 'remove-move', moveId: move.moveId } }],
      ));
    }
  }
  return results;
}

/** Validate one derived node as a pure advisory overlay; user-authored conflicts never throw. */
export function validateResolvedNode(
  node: ResolvedTimelineNode,
  context: TimelineValidationContext,
): TimelineFinding[] {
  validateCanonicalLearnsetReferences(context.pack);
  const integrity = validateResolvedIntegrity(node, context);
  const findings: TimelineFinding[] = [...integrity.findings];
  for (const memberId of integrity.memberIds) {
    const member = context.members[memberId];
    const snapshot = node.snapshots[memberId];
    const inference = inferMemberOrigin(member, node.nodeId, context);
    findings.push(...originFindings(member, snapshot, node, context, inference));
    if (member.lifecycle.some((event) => event.type === 'restored')) {
      findings.push(finding(
        'member.restored', 'yellow', member.id, 'member', 'Restored Pokémon',
        'This member was restored after release. The audit finding is permanent.',
        member.lifecycle.filter((event) => event.type === 'restored').map((event) => event.nodeId),
        [editMemberResolution()],
      ));
    }
    findings.push(...abilityFindings(member.id, snapshot, context.pack));
    findings.push(...evolutionFindings(member, snapshot, context));
    findings.push(...moveFindings(member, snapshot, node, context));
  }
  return findings;
}
