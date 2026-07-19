import { useMemo, useState } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import { MILESTONE_ORDER } from '../../domain/availability';
import { parsePlaythrough, type Playthrough, type PlaythroughPackIndex } from '../../domain/playthrough';
import { searchFireRed } from '../../domain/search';
import type { Slot } from '../../domain/team';
import { EncounterTable } from './EncounterTable';
import { PokemonInspector, type MemberDraft } from './PokemonInspector';
import { ProgressionRail } from './ProgressionRail';

/** Local id-resolution surface so emitted playthrough changes are re-validated before they leave. */
function packIndexOf(pack: FireRedPack): PlaythroughPackIndex {
  const pokemonById = new Map(pack.pokemon.map((record) => [record.id, record]));
  const milestones = new Set<string>(MILESTONE_ORDER);
  const acquisitions = new Set(pack.acquisitions.map((record) => record.id));
  return {
    hasSpecies: (id) => pokemonById.has(id),
    legalAbilityIds: (id) => pokemonById.get(id)?.abilities.map((ability) => ability.id) ?? [],
    isVersionValidMove: (id, moveId) =>
      (pack.learnsets.find((record) => record.pokemonId === id)?.moves ?? []).some((move) => move.moveId === moveId),
    hasMilestone: (id) => milestones.has(id),
    hasAcquisition: (id) => acquisitions.has(id),
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
  const [, setMemberDraft] = useState<MemberDraft | null>(null);
  const [searchText, setSearchText] = useState('');

  const availabilityContext = useMemo(
    () => ({
      currentMilestoneId: playthrough.currentMilestoneId,
      previewMilestoneId: playthrough.previewMilestoneId,
    }),
    [playthrough.currentMilestoneId, playthrough.previewMilestoneId],
  );

  const matchCountsByNode = useMemo(() => {
    const query = searchText.trim();
    if (query === '') return undefined;
    const counts: Record<string, number> = {};
    for (const result of searchFireRed({ name: query }, pack)) {
      for (const nodeId of result.routes) counts[nodeId] = (counts[nodeId] ?? 0) + 1;
    }
    return counts;
  }, [searchText, pack]);

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

  return (
    <div className="workbench">
      <section className="workbench-rail" aria-label="Progression">
        <div className="workbench-search">
          <label htmlFor="workbench-search-input">Search FireRed</label>
          <input
            id="workbench-search-input"
            type="search"
            className="workbench-search-input"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
        <ProgressionRail
          nodes={pack.progression.nodes}
          selectedNodeId={selectedNodeId}
          currentMilestoneId={playthrough.currentMilestoneId}
          previewMilestoneId={playthrough.previewMilestoneId}
          matchCountsByNode={matchCountsByNode}
          onSelectNode={selectRoute}
          onSelectEvent={setSelectedEventId}
          onSetCurrentMilestone={(milestoneId) => emit({ currentMilestoneId: milestoneId })}
          onSetPreviewMilestone={(milestoneId) => emit({ previewMilestoneId: milestoneId })}
        />
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
        <div className="manifest-sections">
          <section aria-label="Primary team">
            <h4>Primary</h4>
            <ManifestSlots slots={playthrough.team.primary} />
          </section>
          <section aria-label="Reserve team">
            <h4>Reserve</h4>
            <ManifestSlots slots={playthrough.team.reserve} />
          </section>
        </div>
      </section>
    </div>
  );
}

function ManifestSlots({ slots }: { slots: readonly Slot[] }) {
  return (
    <ol className="manifest-slots">
      {slots.map((slot, index) => (
        <li key={index} className="manifest-slot" data-filled={slot !== null || undefined}>
          <code className="manifest-slot-index">{index + 1}</code>
          <span className="manifest-slot-body">{slot === null ? 'Empty' : `Species #${slot.speciesId}`}</span>
        </li>
      ))}
    </ol>
  );
}
