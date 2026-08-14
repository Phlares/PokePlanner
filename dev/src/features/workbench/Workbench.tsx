import { useMemo, useState } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import { MILESTONE_ORDER } from '../../domain/availability';
import { parsePlaythrough, type Playthrough, type PlaythroughPackIndex } from '../../domain/playthrough';
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';
import type { TeamState } from '../../domain/team';
import { FireRedSearch } from '../search/FireRedSearch';
import { TeamManifest } from '../team/TeamManifest';
import { EncounterTable } from './EncounterTable';
import { PokemonInspector, type MemberDraft } from './PokemonInspector';
import { ProgressionRail } from './ProgressionRail';

/** Local id-resolution surface so emitted playthrough changes are re-validated before they leave. */
function packIndexOf(pack: FireRedPack): PlaythroughPackIndex {
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
 * region, a contextual inspector region, and the full-width team manifest. Selected route,
 * event, and search text are ephemeral view state owned here; only milestone changes are
 * validated and emitted upward for App to persist. Selecting a wild Pokémon in the encounter
 * table opens the inspector in place; inspector edits emit member drafts that stay local until
 * the team-manifest work in Task 13 wires them into saved state.
 */
export function Workbench({ pack, playthrough, onPlaythroughChange, now = Date.now }: WorkbenchProps) {
  const index = useMemo(() => packIndexOf(pack), [pack]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [, setSelectedEventId] = useState<string | null>(null);
  const [selectedPokemonId, setSelectedPokemonId] = useState<number | null>(null);
  const [memberDraft, setMemberDraft] = useState<MemberDraft | null>(null);
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

  const changeTeam = (team: TeamState): void => {
    emit({ team });
  };

  return (
    <div className="workbench">
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

      <section className="workbench-manifest" aria-label="Team manifest">
        <h3 className="workbench-region-heading">Team manifest</h3>
        <TeamManifest
          team={playthrough.team}
          pack={pack}
          draft={memberDraft}
          onTeamChange={changeTeam}
        />
      </section>
    </div>
  );
}
