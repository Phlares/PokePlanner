import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import { MILESTONE_ORDER } from '../../domain/availability';
import { parsePlaythrough, type Playthrough, type PlaythroughPackIndex } from '../../domain/playthrough';
import { hasActiveSearchQuery } from '../../domain/search';
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';
import type { LevelMode } from '../../domain/rules/game-rules';
import { evaluateCapability, type CapabilityState } from '../../domain/timeline/capabilities';
import { acquireMember, moveToReserve, placeInParty, releaseMember, restoreMember } from '../../domain/timeline/commands';
import type { TimelineKeyframe, TimelineState } from '../../domain/timeline/model';
import {
  resolveTimelineNode,
  type ResolvedTimelineNode,
  type TimelineResolverPackView,
} from '../../domain/timeline/resolver';
import { validateResolvedNode, type TimelineFinding } from '../../domain/timeline/validation';
import {
  capabilitySources,
  packLearnability,
  progressionContextAtNode,
  searchCapability,
  selectMilestoneBriefing,
} from '../../domain/workbench/search';
import { memberDisplayName } from '../timeline/MemberPool';
import {
  explicitOverrideFrom,
  TeamTimeline,
  type TimelineDisplayNode,
} from '../timeline/TeamTimeline';
import { TimelineMemberEditor } from '../timeline/TimelineMemberEditor';
import { EncounterTable } from './EncounterTable';
import { MilestoneResults } from './MilestoneResults';
import { PokemonInspector, type MemberDraft } from './PokemonInspector';
import { TeamStrip, type TeamStripSlot } from './TeamStrip';
import { WorkbenchShell } from './WorkbenchShell';
import { WorkbenchToolbar } from './WorkbenchToolbar';
import {
  createWorkbenchState,
  reduceWorkbench,
  sameWorkbenchValidity,
  type WorkbenchValidity,
} from './controller';
import { milestoneNodeId, revealsFutureNodes, selectMilestoneResults } from './selectors';

/** Local id-resolution surface so emitted playthrough changes are re-validated before they leave. */
function packIndexOf(pack: FireRedPack): PlaythroughPackIndex & TimelineResolverPackView {
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
    isVersionValidMove: (id, moveId) =>
      (pack.learnsets.find((record) => record.pokemonId === id)?.moves ?? []).some((move) => move.moveId === moveId),
    hasMilestone: (id) => milestones.has(id),
    hasAcquisition: (id) => acquisitions.has(id),
    hasNode: (id) => nodes.has(id) || milestones.has(id),
    starterNodeId: () => FIRE_RED_RULES.initialProgress().currentNodeId,
    evolutionEdgesFrom: (speciesId) => pack.evolutions.filter((edge) => edge.fromPokemonId === speciesId),
  };
}

function resolvedFromFrame(frame: TimelineKeyframe): ResolvedTimelineNode {
  return {
    nodeId: frame.nodeId,
    source: frame.kind === 'override' ? 'explicit-override' : 'explicit-major',
    party: [...frame.party] as TimelineKeyframe['party'],
    reserve: [...frame.reserve],
    released: [...frame.released],
    snapshots: frame.snapshots,
  };
}

/** Bind the shared milestone→node mapping to this shell's ruleset. */
const progressionNodeIdFor = (nodeId: string, progressionIds: ReadonlySet<string>): string =>
  milestoneNodeId(nodeId, FIRE_RED_RULES.milestones, progressionIds);

/** Rewrite a timeline onto progression locations so route interpolation can order every frame. */
function resolvableTimeline(timeline: TimelineState, progressionIds: ReadonlySet<string>): TimelineState {
  return {
    ...timeline,
    members: Object.fromEntries(Object.entries(timeline.members).map(([memberId, member]) => [memberId, {
      ...member,
      acquiredAtNodeId: progressionNodeIdFor(member.acquiredAtNodeId, progressionIds),
    }])),
    keyframes: Object.fromEntries(Object.values(timeline.keyframes).map((frame) => {
      const nodeId = progressionNodeIdFor(frame.nodeId, progressionIds);
      return [nodeId, { ...frame, nodeId }];
    })),
    overrides: Object.fromEntries(Object.values(timeline.overrides).map((frame) => {
      const nodeId = progressionNodeIdFor(frame.nodeId, progressionIds);
      return [nodeId, { ...frame, nodeId }];
    })),
  };
}

function progressionNodeId(display: TimelineDisplayNode, pack: FireRedPack): string {
  if (display.progressionNodeId) return display.progressionNodeId;
  if (pack.progression.nodes.some((node) => node.id === display.id)) return display.id;
  return display.resolved.nodeId;
}

/**
 * Derive which ephemeral selections the durable run still admits; the sole input to sanitization.
 * `scoped` is the milestone horizon the results surface is currently cut to, read from the one
 * predicate that decides it, so a route can never be listed and then dropped for being out of scope.
 */
function workbenchValidity(
  playthrough: Playthrough,
  pack: FireRedPack,
  index: PlaythroughPackIndex & TimelineResolverPackView,
  scoped: boolean,
): WorkbenchValidity {
  const progressionIds = new Set(pack.progression.nodes.map((node) => node.id));
  const targetId = playthrough.previewMilestoneId ?? playthrough.currentMilestoneId;
  const targetNodeId = targetId === null ? null : progressionNodeIdFor(targetId, progressionIds);
  const targetOrder = pack.progression.nodes.find((node) => node.id === targetNodeId)?.goldenPathOrder;
  const nodeIds = new Set(pack.progression.nodes
    .filter((node) => !scoped || targetOrder === undefined || node.goldenPathOrder <= targetOrder)
    .map((node) => node.id));
  const resolvedTarget = targetNodeId === null
    ? null
    : resolveTimelineNode({
      timeline: resolvableTimeline(playthrough.timeline, progressionIds),
      nodeId: targetNodeId,
      progression: pack.progression,
      rules: FIRE_RED_RULES,
      pack: index,
    });
  return {
    currentProgressId: playthrough.currentMilestoneId,
    planningTargetId: playthrough.previewMilestoneId,
    nodeIds,
    pokemonIds: new Set(pack.pokemon.map((record) => record.id)),
    memberIds: new Set(resolvedTarget?.party.filter((memberId) => memberId !== null) ?? []),
    milestoneIds: new Set(FIRE_RED_RULES.milestones.map((milestone) => milestone.id)),
  };
}

function timelineWithExplicitNode(timeline: TimelineState, display: TimelineDisplayNode): TimelineState {
  if (timeline.keyframes[display.id] || timeline.overrides[display.id]) return timeline;
  return { ...timeline, overrides: { ...timeline.overrides, [display.id]: explicitOverrideFrom(display.resolved) } };
}

interface EditorSelection {
  nodeId: string;
  returnFocusTo: HTMLElement | null;
}

/** How the run generates levels forward, worded for the team rung. */
const LEVEL_POLICY_LABEL: Record<LevelMode, string> = {
  manual: 'Manual levels',
  under: 'Auto Lv −5',
  match: 'Auto match target',
  over: 'Auto Lv +5',
};

export interface WorkbenchProps {
  pack: FireRedPack;
  playthrough: Playthrough;
  onPlaythroughChange: (next: Playthrough) => void;
  /** Injected clock; defaults to `Date.now` so the emitted `updatedAt` stays caller-controlled. */
  now?: () => number;
  /** Injected identity source shared with setup so every acquired member is durable and distinct. */
  createId?: () => string;
  /** Header run-data controls, owned by the application boundary that holds the repository. */
  runMenu?: ReactNode;
  /** Persistent recovery notices from the same boundary; the shell places them under the header. */
  notices?: ReactNode;
}

/**
 * The FireRed timeline workbench shell: the search rung, the milestone result groups, a route-detail
 * region, the inspector, and the full-width milestone team timeline. Every ephemeral navigation
 * choice — mode, query, folds, last route, candidate, selected member, detail and sheet — lives in
 * the controller reducer, so no second copy is kept here; the member editor's node and return-focus
 * target are the one exception, and are released whenever the controller drops the selected member.
 * The durable run belongs to App: changes are re-validated before they are emitted upward and only
 * take effect when they come back as a prop, which is also what reconciles ephemeral selections
 * against it.
 */
export function Workbench({
  pack,
  playthrough,
  onPlaythroughChange,
  now = Date.now,
  createId = () => crypto.randomUUID(),
  runMenu,
  notices,
}: WorkbenchProps) {
  const index = useMemo(() => packIndexOf(pack), [pack]);
  const timelineRegion = useRef<HTMLElement>(null);
  const [controller, dispatch] = useReducer(reduceWorkbench, {
    currentProgressId: playthrough.currentMilestoneId,
    planningTargetId: playthrough.previewMilestoneId,
  }, createWorkbenchState);
  const [editorSelection, setEditorSelection] = useState<EditorSelection | null>(null);
  const [releaseFocusMemberId, setReleaseFocusMemberId] = useState<string | null>(null);
  const [reserveFocusMemberId, setReserveFocusMemberId] = useState<string | null>(null);

  // The durable run arrives as a prop from any source — a milestone control here, an imported run in
  // App — so ephemeral selections are reconciled against what the run currently admits rather than
  // by whichever caller changed it.
  const scoped = !revealsFutureNodes(controller);
  const validity = useMemo(
    () => workbenchValidity(playthrough, pack, index, scoped),
    [index, pack, playthrough, scoped],
  );
  const [sanitizedAgainst, setSanitizedAgainst] = useState(validity);
  if (!sameWorkbenchValidity(sanitizedAgainst, validity)) {
    setSanitizedAgainst(validity);
    dispatch({ type: 'sanitize', validity });
  }

  // Sanitization can drop the selected member while its editor is open. The editor restores focus
  // only from its own close controls, so the trigger is released here on that involuntary close.
  useEffect(() => {
    if (controller.selectedMemberId !== null || editorSelection === null) return;
    const trigger = editorSelection.returnFocusTo;
    setEditorSelection(null);
    queueMicrotask(() => trigger?.focus());
  }, [controller.selectedMemberId, editorSelection]);

  const availabilityContext = useMemo(
    () => ({
      currentMilestoneId: playthrough.currentMilestoneId,
      previewMilestoneId: playthrough.previewMilestoneId,
    }),
    [playthrough.currentMilestoneId, playthrough.previewMilestoneId],
  );

  const selectedNodeId = controller.detail.kind === 'route' ? controller.detail.nodeId : null;
  const selectedPokemonId = controller.candidatePokemonId;

  const selectedNode = selectedNodeId === null
    ? null
    : pack.progression.nodes.find((node) => node.id === selectedNodeId) ?? null;

  const selectedAreas = selectedNodeId === null
    ? []
    : pack.encounters.filter((area) => area.nodeId === selectedNodeId);

  const progressionIds = useMemo(() => new Set(pack.progression.nodes.map((node) => node.id)), [pack]);
  const timelineForRoutes = useMemo(
    () => resolvableTimeline(playthrough.timeline, progressionIds),
    [playthrough.timeline, progressionIds],
  );

  const { majorNodes, detailedNodes } = useMemo(() => {
    const resolveRoute = (nodeId: string): ResolvedTimelineNode => resolveTimelineNode({
      timeline: timelineForRoutes,
      nodeId,
      progression: pack.progression,
      rules: FIRE_RED_RULES,
      pack: index,
    });
    const majors: TimelineDisplayNode[] = FIRE_RED_RULES.milestones.map((milestone) => {
      const explicit = playthrough.timeline.overrides[milestone.id] ?? playthrough.timeline.keyframes[milestone.id];
      const milestoneNodeId = progressionNodeIdFor(milestone.id, progressionIds);
      const resolved = explicit
        ? resolvedFromFrame(explicit)
        : { ...resolveRoute(milestoneNodeId), nodeId: milestone.id };
      return {
        id: milestone.id,
        progressionNodeId: milestoneNodeId,
        name: milestone.name,
        targetLevel: milestone.targetLevel,
        resolved,
      };
    });
    const detailed: TimelineDisplayNode[] = [...pack.progression.nodes]
      .sort((left, right) => left.goldenPathOrder - right.goldenPathOrder || left.id.localeCompare(right.id))
      .map((node) => {
        const resolved = resolveRoute(node.id);
        return {
          id: node.id,
          name: node.name,
          targetLevel: FIRE_RED_RULES.targetLevelAtNode(node.id, pack.progression),
          resolved,
        };
      });
    return { majorNodes: majors, detailedNodes: detailed };
  }, [index, pack, playthrough.timeline, progressionIds, timelineForRoutes]);

  const findingsByNode = useMemo(() => {
    const findings: Record<string, readonly TimelineFinding[]> = {};
    for (const display of [...majorNodes, ...detailedNodes]) {
      const nodeId = progressionNodeId(display, pack);
      findings[display.id] = validateResolvedNode(
        { ...display.resolved, nodeId },
        {
          members: timelineForRoutes.members,
          progression: pack.progression,
          progressionContext: progressionContextAtNode(nodeId, pack, FIRE_RED_RULES),
          rules: FIRE_RED_RULES,
          pack: {
            pokemon: pack.pokemon,
            learnsets: pack.learnsets,
            encounters: pack.encounters,
            acquisitions: pack.acquisitions,
            evolutions: pack.evolutions,
          },
        },
      );
    }
    return findings;
  }, [detailedNodes, majorNodes, pack, timelineForRoutes.members]);

  const speciesNames = useMemo(() => new Map(pack.pokemon.map((record) => [record.id, record.name])), [pack]);

  // The team rung reads the party the run resolves to at its planning target — the same milestone
  // every other surface plans against — so the rung and the workspace can never disagree.
  const targetMilestone = FIRE_RED_RULES.milestones
    .find((milestone) => milestone.id === (playthrough.previewMilestoneId ?? playthrough.currentMilestoneId))
    ?? FIRE_RED_RULES.milestones[0];
  const targetDisplay = majorNodes.find((node) => node.id === targetMilestone.id) ?? majorNodes[0];
  const speciesCounts = useMemo(() => {
    const counts = new Map<number, number>();
    Object.values(playthrough.timeline.members).forEach((member) => {
      counts.set(member.originalSpeciesId, (counts.get(member.originalSpeciesId) ?? 0) + 1);
    });
    return counts;
  }, [playthrough.timeline.members]);
  const teamSlots: readonly TeamStripSlot[] = (targetDisplay?.resolved.party ?? []).map((memberId) => {
    const member = memberId === null ? undefined : playthrough.timeline.members[memberId];
    const snapshot = memberId === null ? undefined : targetDisplay!.resolved.snapshots[memberId];
    if (memberId === null || member === undefined || snapshot === undefined) return { memberId: null };
    return {
      memberId,
      name: memberDisplayName(member, snapshot, (id) => speciesNames.get(id) ?? `Species #${id}`, speciesCounts),
      level: snapshot.level,
    };
  });

  // One grouping drives the whole primary surface: the sections, their folds, the route rows and
  // the totals the toolbar announces all come out of this single derivation of the controller state.
  const results = useMemo(() => selectMilestoneResults({
    pack,
    rules: FIRE_RED_RULES,
    state: controller,
    currentMilestoneId: playthrough.currentMilestoneId,
    targetMilestoneId: playthrough.previewMilestoneId ?? playthrough.currentMilestoneId,
  }), [controller, pack, playthrough.currentMilestoneId, playthrough.previewMilestoneId]);

  const briefing = useMemo(
    () => selectMilestoneBriefing(targetMilestone.id, { pack, rules: FIRE_RED_RULES }),
    [pack, targetMilestone.id],
  );

  // A capability search states one verdict per species wherever that species appears. The party and
  // the reserve answer from their own snapshots and every other species answers as a bare candidate;
  // the three sets are disjoint by species, so this is a plain union with nothing to arbitrate.
  const capabilityId = controller.query.capability?.trim() ?? '';
  const capabilityStates = useMemo(() => {
    const states = new Map<number, CapabilityState>();
    if (capabilityId === '' || targetDisplay === undefined) return states;
    const search = searchCapability(
      capabilityId,
      { ...targetDisplay.resolved, nodeId: progressionNodeId(targetDisplay, pack) },
      pack,
      FIRE_RED_RULES,
    );
    const highlights = [
      ...Object.values(search.party),
      ...Object.values(search.reserve),
      ...Object.values(search.candidates),
    ];
    for (const highlight of highlights) states.set(highlight.speciesId, highlight.state);
    return states;
  }, [capabilityId, pack, targetDisplay]);

  const editorNode = editorSelection === null
    ? null
    : [...majorNodes, ...detailedNodes].find((node) => node.id === editorSelection.nodeId) ?? null;
  const editorMember = controller.selectedMemberId === null ? null : playthrough.timeline.members[controller.selectedMemberId] ?? null;
  const editorSnapshot = editorNode === null || controller.selectedMemberId === null
    ? null
    : editorNode.resolved.snapshots[controller.selectedMemberId] ?? null;
  const editorTimeline = editorNode === null ? playthrough.timeline : timelineWithExplicitNode(playthrough.timeline, editorNode);
  const timelineOrder = useMemo(() => {
    const routeOrder = new Map(detailedNodes.map((node, index) => [node.id, index * 2]));
    const entries = [
      ...detailedNodes.map((node, index) => ({ id: node.id, order: index * 2 })),
      ...majorNodes.map((node, index) => ({
        id: node.id,
        order: (routeOrder.get(node.progressionNodeId ?? '') ?? index * 2) + 1,
      })),
    ];
    return entries.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)).map((entry) => entry.id);
  }, [detailedNodes, majorNodes]);

  const editorSpecies = editorSnapshot === null
    ? []
    : [...new Set([
      editorSnapshot.speciesId,
      ...pack.evolutions.filter((edge) => edge.fromPokemonId === editorSnapshot.speciesId).map((edge) => edge.toPokemonId),
      ...pack.evolutions.filter((edge) => edge.toPokemonId === editorSnapshot.speciesId).map((edge) => edge.fromPokemonId),
    ])].map((id) => pack.pokemon.find((record) => record.id === id)).filter((record) => record !== undefined);
  const editorAbilities = pack.pokemon.find((record) => record.id === editorSnapshot?.speciesId)?.abilities ?? [];
  const editorMoveIds = new Set(pack.learnsets
    .find((record) => record.pokemonId === editorSnapshot?.speciesId)?.moves.map((move) => move.moveId) ?? []);
  // The editor panel reads the same capability rules the workbench search does — where the run
  // stands, which canonical sources are in hand, and what a species can learn including through the
  // evolutions it has not reached yet — so one member can never read `none` here and `conditional`
  // in the results.
  const editorCapabilityEvidence = editorNode === null || editorSnapshot === null
    ? []
    : (() => {
      const nodeId = progressionNodeId(editorNode, pack);
      const progressionContext = progressionContextAtNode(nodeId, pack, FIRE_RED_RULES);
      const canLearnMove = packLearnability(pack);
      return [...FIRE_RED_RULES.capabilities.values()].map((capability) => ({
        id: capability.id,
        ...evaluateCapability(editorSnapshot, {
          capability,
          progressionContext,
          canLearnMove,
          sources: capabilitySources(capability, nodeId, pack, FIRE_RED_RULES),
        }),
      }));
    })();

  const selectRoute = (nodeId: string): void => {
    dispatch({ type: 'route-selected', nodeId });
  };

  const emit = (patch: Partial<Playthrough>): void => {
    const next = parsePlaythrough({ ...playthrough, ...patch, updatedAt: now() }, index);
    onPlaythroughChange(next);
  };

  const addDraftToPreviewParty = (draft: MemberDraft): void => {
    const targetNodeId = playthrough.previewMilestoneId ?? playthrough.currentMilestoneId;
    if (targetNodeId === null) return;
    const target = playthrough.timeline.keyframes[targetNodeId] ?? playthrough.timeline.overrides[targetNodeId];
    const slot = target?.party.findIndex((memberId) => memberId === null) ?? -1;
    if (!target || slot < 0 || slot > 5) return;
    const routeOrder = new Map(pack.progression.nodes.map((node) => [node.id, node.goldenPathOrder]));
    const acquisitionNodeId = [...(pack.indexes.routesByPokemon[String(draft.speciesId)] ?? [])]
      .sort((left, right) => (routeOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (routeOrder.get(right) ?? Number.MAX_SAFE_INTEGER))[0]
      ?? targetNodeId;
    const memberId = createId();
    const acquired = acquireMember(playthrough.timeline, {
      memberId,
      speciesId: draft.speciesId,
      nodeId: acquisitionNodeId,
      abilityId: draft.abilityId,
      level: draft.level,
      moves: draft.moves,
      heldItemId: null,
      origin: { type: 'inferred', acquisitionId: null, note: null },
      nickname: null,
      natureId: null,
      notes: '',
    }, index);
    emit({ timeline: placeInParty(acquired, targetNodeId, memberId, slot as 0 | 1 | 2 | 3 | 4 | 5, index) });
  };

  const selectCandidate = (pokemonId: number): void => {
    dispatch({ type: 'candidate-selected', pokemonId });
  };

  const workspace = (
    <div className="workbench">
      <section className="workbench-timeline" aria-label="Team timeline" ref={timelineRegion} tabIndex={-1}>
        <TeamTimeline
          timeline={playthrough.timeline}
          majorNodes={majorNodes}
          detailedNodes={detailedNodes}
          findingsByNode={findingsByNode}
          pack={index}
          speciesName={(speciesId) => speciesNames.get(speciesId) ?? `Species #${speciesId}`}
          onChange={(timeline) => emit({ timeline })}
          initialNodeId={playthrough.previewMilestoneId ?? playthrough.currentMilestoneId ?? 'starter'}
          onEditMember={(nodeId, memberId) => {
            dispatch({ type: 'member-selected', memberId });
            setEditorSelection({
              nodeId,
              returnFocusTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
            });
          }}
          onRequestRestore={(nodeId, memberId) => {
            const display = [...majorNodes, ...detailedNodes].find((node) => node.id === nodeId);
            if (!display) return;
            emit({ timeline: restoreMember(timelineWithExplicitNode(playthrough.timeline, display), nodeId, memberId, index) });
          }}
          releaseFocusMemberId={releaseFocusMemberId}
          onReleaseFocusHandled={() => setReleaseFocusMemberId(null)}
          reserveFocusMemberId={reserveFocusMemberId}
          onReserveFocusHandled={() => setReserveFocusMemberId(null)}
        />
      </section>

      {editorSelection && editorNode && editorMember && editorSnapshot && (
        <TimelineMemberEditor
          timeline={editorTimeline}
          nodeId={editorNode.id}
          nodeName={editorNode.name}
          member={editorMember}
          snapshot={editorSnapshot}
          memberName={editorMember.nickname ?? `${speciesNames.get(editorSnapshot.speciesId) ?? `Species #${editorSnapshot.speciesId}`}${
            Object.values(playthrough.timeline.members).filter((candidate) => candidate.originalSpeciesId === editorMember.originalSpeciesId).length > 1
              ? ` #${editorMember.speciesSequence}` : ''
          }`}
          milestoneOrder={timelineOrder}
          speciesOptions={editorSpecies.map((record) => ({ id: record.id, name: record.name }))}
          abilityOptions={editorAbilities.map((ability) => ({ id: ability.id, name: ability.name }))}
          moveOptions={pack.moves.filter((move) => editorMoveIds.has(move.id)).map((move) => ({ id: move.id, name: move.name }))}
          natureOptions={FIRE_RED_RULES.natures.map((nature) => ({
            id: nature.id,
            name: `${nature.id.charAt(0).toUpperCase()}${nature.id.slice(1)}`,
          }))}
          speciesCompatibility={editorSpecies.map((record) => {
            const legalMoveIds = pack.learnsets.find((learnset) => learnset.pokemonId === record.id)?.moves.map((move) => move.moveId) ?? [];
            const defaultAbility = record.abilities.find((ability) => ability.slot === 1) ?? record.abilities[0];
            return {
              speciesId: record.id,
              legalAbilityIds: record.abilities.map((ability) => ability.id),
              defaultAbilityId: defaultAbility.id,
              legalMoveIds: [...new Set(legalMoveIds)],
            };
          })}
          findings={(findingsByNode[editorNode.id] ?? []).filter((finding) => finding.memberId === null || finding.memberId === editorMember.id)}
          capabilityEvidence={editorCapabilityEvidence}
          returnFocusTo={editorSelection.returnFocusTo}
          onApply={(application) => emit({ timeline: application.timeline })}
          onClose={() => {
            dispatch({ type: 'member-selected', memberId: null });
            setEditorSelection(null);
          }}
          onRequestRelease={(nodeId, memberId) => {
            emit({ timeline: releaseMember(editorTimeline, nodeId, memberId, null, index) });
            setReleaseFocusMemberId(memberId);
            dispatch({ type: 'member-selected', memberId: null });
            setEditorSelection(null);
          }}
          onRequestMoveToReserve={(nodeId, memberId) => {
            setReserveFocusMemberId(memberId);
            emit({ timeline: moveToReserve(editorTimeline, nodeId, memberId, index) });
            dispatch({ type: 'member-selected', memberId: null });
            setEditorSelection(null);
          }}
        />
      )}

      <div className="workbench-results">
        <MilestoneResults
          results={results}
          targetName={targetMilestone.name}
          currentMilestoneId={playthrough.currentMilestoneId}
          previewMilestoneId={playthrough.previewMilestoneId}
          selectedNodeId={selectedNodeId}
          selectedPokemonId={selectedPokemonId}
          searchActive={hasActiveSearchQuery(controller.query)}
          capabilityStates={capabilityStates}
          onToggleSection={(sectionId) => dispatch({ type: 'section-toggled', sectionId })}
          onSelectRoute={selectRoute}
          onSelectPokemon={selectCandidate}
          onSetCurrentMilestone={(milestoneId) => emit({ currentMilestoneId: milestoneId })}
          onSetPreviewMilestone={(milestoneId) => emit({ previewMilestoneId: milestoneId })}
        />
      </div>

      <section className="workbench-table" aria-label="Route detail">
        {selectedNode === null && (
          <p className="workbench-placeholder">Choose a route from a milestone group.</p>
        )}
        {selectedNode !== null && selectedAreas.length === 0 && (
          <>
            <h3 className="workbench-region-heading">{selectedNode.name}</h3>
            <p className="workbench-placeholder">No wild encounters recorded for this location.</p>
          </>
        )}
        {selectedAreas.map((area) => (
          <EncounterTable
            key={area.slug}
            area={area}
            pack={pack}
            selectedPokemonId={selectedPokemonId}
            onSelectPokemon={(pokemonId) => {
              dispatch({ type: 'candidate-selected', pokemonId });
              dispatch({
                type: 'candidate-location-selected',
                nodeId: area.nodeId ?? selectedNodeId!,
              });
            }}
          />
        ))}
      </section>

    </div>
  );

  const inspector = selectedPokemonId === null ? (
    <p className="workbench-placeholder">Select a Pokémon from the encounter table.</p>
  ) : (
    <PokemonInspector
      pokemonId={selectedPokemonId}
      pack={pack}
      context={availabilityContext}
      onAddMember={addDraftToPreviewParty}
      addMemberLabel={(() => {
        const species = pack.pokemon.find((record) => record.id === selectedPokemonId);
        const target = FIRE_RED_RULES.milestones.find((milestone) => milestone.id === playthrough.previewMilestoneId);
        return species && target ? `Add ${species.name} to ${target.name} party` : undefined;
      })()}
    />
  );

  return (
    <WorkbenchShell
      runName={playthrough.name}
      runMenu={runMenu}
      notices={notices}
      teamLabel={`Team at ${targetMilestone.name}`}
      team={(
        <TeamStrip
          targetName={targetMilestone.name}
          targetLevel={targetMilestone.targetLevel}
          slots={teamSlots}
          reserveCount={targetDisplay?.resolved.reserve.length ?? 0}
          findingCount={targetDisplay === undefined ? 0 : (findingsByNode[targetDisplay.id]?.length ?? 0)}
          levelPolicyLabel={LEVEL_POLICY_LABEL[playthrough.timeline.preferences.levelMode]}
          selectedMemberId={controller.selectedMemberId}
          onSelectMember={(memberId) => dispatch({ type: 'member-selected', memberId })}
          onOpenTimeline={() => {
            timelineRegion.current?.focus();
            timelineRegion.current?.scrollIntoView?.({ block: 'start' });
          }}
        />
      )}
      search={(
        <WorkbenchToolbar
          pack={pack}
          query={controller.query}
          mode={controller.mode}
          milestoneFilter={controller.milestoneFilter}
          targetName={targetMilestone.name}
          briefing={briefing}
          totalPokemon={results.totalPokemon}
          totalRoutes={results.totalRoutes}
          onAction={dispatch}
        />
      )}
      results={workspace}
      inspector={inspector}
    />
  );
}
