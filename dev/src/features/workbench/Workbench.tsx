import { useMemo, useState } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import { MILESTONE_ORDER } from '../../domain/availability';
import { parsePlaythrough, type Playthrough, type PlaythroughPackIndex } from '../../domain/playthrough';
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';
import type { TimelineKeyframe, TimelineState } from '../../domain/timeline/model';
import {
  resolveTimelineNode,
  type ResolvedTimelineNode,
  type TimelineResolverPackView,
} from '../../domain/timeline/resolver';
import { FireRedSearch } from '../search/FireRedSearch';
import { TeamTimeline, type TimelineDisplayNode } from '../timeline/TeamTimeline';
import { EncounterTable } from './EncounterTable';
import { PokemonInspector, type MemberDraft } from './PokemonInspector';
import { ProgressionRail } from './ProgressionRail';

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

/** Map persisted milestone ids onto their progression locations for route interpolation only. */
function resolvableTimeline(timeline: TimelineState, pack: FireRedPack): TimelineState {
  const progressionIds = new Set(pack.progression.nodes.map((node) => node.id));
  const progressionNodeId = (nodeId: string): string => {
    const configured = FIRE_RED_RULES.milestones.find((milestone) => milestone.id === nodeId)?.nodeId;
    if (configured && progressionIds.has(configured)) return configured;
    if (nodeId === 'starter' && progressionIds.has('pallet-town')) return 'pallet-town';
    return nodeId;
  };
  return {
    ...timeline,
    members: Object.fromEntries(Object.entries(timeline.members).map(([memberId, member]) => [memberId, {
      ...member,
      acquiredAtNodeId: progressionNodeId(member.acquiredAtNodeId),
    }])),
    keyframes: Object.fromEntries(Object.values(timeline.keyframes).map((frame) => {
      const nodeId = progressionNodeId(frame.nodeId);
      return [nodeId, { ...frame, nodeId }];
    })),
    overrides: Object.fromEntries(Object.values(timeline.overrides).map((frame) => {
      const nodeId = progressionNodeId(frame.nodeId);
      return [nodeId, { ...frame, nodeId }];
    })),
  };
}

export interface WorkbenchProps {
  pack: FireRedPack;
  playthrough: Playthrough;
  onPlaythroughChange: (next: Playthrough) => void;
  /** Injected clock; defaults to `Date.now` so the emitted `updatedAt` stays caller-controlled. */
  now?: () => number;
}

/**
 * The FireRed timeline workbench shell: the chronological progression rail, a route-detail
 * region, a contextual inspector region, and the full-width milestone team timeline. Selected route,
 * event, and search text are ephemeral view state owned here; only milestone changes are
 * validated and emitted upward for App to persist. Selecting a wild Pokémon in the encounter
 * table opens the inspector in place; inspector drafts remain local until the later timeline editor
 * connects candidate inspection to member edits.
 */
export function Workbench({ pack, playthrough, onPlaythroughChange, now = Date.now }: WorkbenchProps) {
  const index = useMemo(() => packIndexOf(pack), [pack]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [, setSelectedEventId] = useState<string | null>(null);
  const [selectedPokemonId, setSelectedPokemonId] = useState<number | null>(null);
  const [, setMemberDraft] = useState<MemberDraft | null>(null);
  const [searchActive, setSearchActive] = useState(false);

  const availabilityContext = useMemo(
    () => ({
      currentMilestoneId: playthrough.currentMilestoneId,
      previewMilestoneId: playthrough.previewMilestoneId,
    }),
    [playthrough.currentMilestoneId, playthrough.previewMilestoneId],
  );

  const selectedNode = selectedNodeId === null
    ? null
    : pack.progression.nodes.find((node) => node.id === selectedNodeId) ?? null;

  const selectedAreas = selectedNodeId === null
    ? []
    : pack.encounters.filter((area) => area.nodeId === selectedNodeId);

  const { majorNodes, detailedNodes } = useMemo(() => {
    const timelineForRoutes = resolvableTimeline(playthrough.timeline, pack);
    const progressionIds = new Set(pack.progression.nodes.map((node) => node.id));
    const progressionNodeId = (milestoneId: string): string => {
      const configured = FIRE_RED_RULES.milestones.find((milestone) => milestone.id === milestoneId)?.nodeId;
      if (configured && progressionIds.has(configured)) return configured;
      if (milestoneId === 'starter' && progressionIds.has('pallet-town')) return 'pallet-town';
      return configured ?? milestoneId;
    };
    const resolveRoute = (nodeId: string): ResolvedTimelineNode => resolveTimelineNode({
      timeline: timelineForRoutes,
      nodeId,
      progression: pack.progression,
      rules: FIRE_RED_RULES,
      pack: index,
    });
    const majors: TimelineDisplayNode[] = FIRE_RED_RULES.milestones.map((milestone) => {
      const explicit = playthrough.timeline.overrides[milestone.id] ?? playthrough.timeline.keyframes[milestone.id];
      const resolved = explicit
        ? resolvedFromFrame(explicit)
        : { ...resolveRoute(progressionNodeId(milestone.id)), nodeId: milestone.id };
      return {
        id: milestone.id,
        progressionNodeId: progressionNodeId(milestone.id),
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
  }, [index, pack, playthrough.timeline]);

  const speciesNames = useMemo(() => new Map(pack.pokemon.map((record) => [record.id, record.name])), [pack]);

  const selectRoute = (nodeId: string): void => {
    setSelectedNodeId(nodeId);
    setSelectedPokemonId(null);
  };

  const emit = (patch: Partial<Playthrough>): void => {
    const next = parsePlaythrough({ ...playthrough, ...patch, updatedAt: now() }, index);
    onPlaythroughChange(next);
  };

  const selectSearchResult = (pokemonId: number): void => {
    setSelectedPokemonId(pokemonId);
  };

  return (
    <div className="workbench">
      <section className="workbench-timeline" aria-label="Team timeline">
        <TeamTimeline
          timeline={playthrough.timeline}
          majorNodes={majorNodes}
          detailedNodes={detailedNodes}
          findingsByNode={{}}
          pack={index}
          speciesName={(speciesId) => speciesNames.get(speciesId) ?? `Species #${speciesId}`}
          onChange={(timeline) => emit({ timeline })}
          initialNodeId={playthrough.previewMilestoneId ?? playthrough.currentMilestoneId ?? 'starter'}
        />
      </section>

      <section className="workbench-rail" aria-label="Progression">
        <FireRedSearch
          pack={pack}
          onSelectPokemon={selectSearchResult}
          onActiveChange={setSearchActive}
          selectedPokemonId={selectedPokemonId}
        />
        {/* An active query focuses the left column on its matches; the rail returns when it is cleared. */}
        {!searchActive && (
          <ProgressionRail
            nodes={pack.progression.nodes}
            selectedNodeId={selectedNodeId}
            currentMilestoneId={playthrough.currentMilestoneId}
            previewMilestoneId={playthrough.previewMilestoneId}
            onSelectNode={selectRoute}
            onSelectEvent={setSelectedEventId}
            onSetCurrentMilestone={(milestoneId) => emit({ currentMilestoneId: milestoneId })}
            onSetPreviewMilestone={(milestoneId) => emit({ previewMilestoneId: milestoneId })}
          />
        )}
      </section>

      <section className="workbench-table" aria-label="Route detail">
        {selectedNode === null && (
          <p className="workbench-placeholder">Choose a node from the progression spine.</p>
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
            onSelectPokemon={setSelectedPokemonId}
          />
        ))}
      </section>

      <section className="workbench-inspector" aria-label="Inspector">
        <h3 className="workbench-region-heading">Inspector</h3>
        {selectedPokemonId === null ? (
          <p className="workbench-placeholder">Select a Pokémon from the encounter table.</p>
        ) : (
          <PokemonInspector
            pokemonId={selectedPokemonId}
            pack={pack}
            context={availabilityContext}
            onDraftMember={setMemberDraft}
          />
        )}
      </section>

    </div>
  );
}
