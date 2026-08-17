import { useMemo, useState, type Ref } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import type { AvailabilityContext } from '../../domain/availability';
import type {
  EvolutionEdge,
  PokemonRecord,
  Provenance,
  TypeChart,
} from '../../domain/pack';
import type { PlannedMove } from '../../domain/team';
import { MoveAvailability } from './MoveAvailability';

/** A team member the inspector proposes upward; the id is assigned when it is placed on a team. */
export interface MemberDraft {
  speciesId: number;
  level: number;
  abilityId: number;
  moves: PlannedMove[];
}

export interface PokemonInspectorProps {
  pokemonId: number;
  pack: FireRedPack;
  context: AvailabilityContext;
  /** Emitted when a planned-level, ability, or move edit changes the proposed member. */
  onDraftMember?: (draft: MemberDraft) => void;
  /** Commits the currently displayed draft through the owning workbench. */
  onAddMember?: (draft: MemberDraft) => void;
  addMemberLabel?: string;
  /** The species heading, which the shell focuses when a candidate is selected (spec §20). */
  headingRef?: Ref<HTMLHeadingElement>;
}

const STAT_ROWS: ReadonlyArray<readonly [keyof PokemonRecord['baseStats'], string]> = [
  ['hp', 'HP'],
  ['attack', 'Attack'],
  ['defense', 'Defense'],
  ['specialAttack', 'Sp. Atk'],
  ['specialDefense', 'Sp. Def'],
  ['speed', 'Speed'],
];

const TYPE_LABEL: Record<string, string> = {
  normal: 'Normal', fighting: 'Fighting', flying: 'Flying', poison: 'Poison', ground: 'Ground',
  rock: 'Rock', bug: 'Bug', ghost: 'Ghost', steel: 'Steel', fire: 'Fire', water: 'Water',
  grass: 'Grass', electric: 'Electric', psychic: 'Psychic', ice: 'Ice', dragon: 'Dragon', dark: 'Dark',
};

/**
 * The Gen III defensive weaknesses of a defender, derived by multiplying each attacking type's
 * effectiveness across the defender's one or two types. A net multiplier above 1x is a weakness.
 * This keeps dual-type interactions historically accurate rather than listing per-type weaknesses.
 */
function computeWeaknesses(types: readonly string[], chart: TypeChart): string[] {
  const attackingTypes = Object.keys(chart).filter((key) => key !== 'provenance');
  const weaknesses: string[] = [];
  for (const attacker of attackingTypes) {
    let multiplier = 1;
    for (const defenderType of types) {
      const relations = chart[defenderType as keyof TypeChart] as {
        weakTo: string[]; resists: string[]; immuneTo: string[];
      };
      if (relations.immuneTo.includes(attacker)) multiplier *= 0;
      else if (relations.weakTo.includes(attacker)) multiplier *= 2;
      else if (relations.resists.includes(attacker)) multiplier *= 0.5;
    }
    if (multiplier > 1) weaknesses.push(TYPE_LABEL[attacker] ?? attacker);
  }
  return weaknesses;
}

function evYieldText(evYield: PokemonRecord['evYield']): string {
  const parts = STAT_ROWS
    .filter(([key]) => evYield[key] > 0)
    .map(([key, label]) => `${label} ${evYield[key]}`);
  return parts.length > 0 ? parts.join(', ') : 'None';
}

function evolutionGate(edge: EvolutionEdge, itemName: (id: number) => string): string {
  switch (edge.trigger) {
    case 'level':
      return edge.minimumLevel !== null ? `Level ${edge.minimumLevel}` : 'Level up';
    case 'item':
      return edge.itemId !== null ? itemName(edge.itemId) : 'Use item';
    case 'trade':
      return 'Trade';
    case 'friendship':
      return 'High friendship';
    default:
      return edge.reason ?? 'Special';
  }
}

function provenanceText(entry: Provenance): string {
  return entry.locator !== null ? `${entry.sourceId} · ${entry.locator}` : entry.sourceId;
}

/**
 * The in-place Pokémon inspector: catch rate, base stats, EV yield, Gen III types and derived
 * weaknesses, legal abilities with visible descriptions, evolutions with their gates, acquisition
 * sources, and the move-availability drawers. Planned-level and ability edits emit a member DRAFT
 * upward; nothing here simulates battles, opponents, exposure, or catch odds. Missing sprites are
 * simply omitted — the panel is data-forward and never blocks on artwork.
 */
export function PokemonInspector({
  pokemonId,
  pack,
  context,
  onDraftMember,
  onAddMember,
  addMemberLabel,
  headingRef,
}: PokemonInspectorProps) {
  const species = useMemo(
    () => pack.pokemon.find((record) => record.id === pokemonId) ?? null,
    [pack, pokemonId],
  );

  const [plannedLevel, setPlannedLevel] = useState(5);
  const [abilityId, setAbilityId] = useState<number>(() => species?.abilities[0]?.id ?? 0);
  const [plannedMoves, setPlannedMoves] = useState<PlannedMove[]>([]);

  const details = useMemo(() => {
    if (species === null) return null;
    const nodeNameById = new Map(pack.progression.nodes.map((node) => [node.id, node.name] as const));
    const pokemonNameById = new Map(pack.pokemon.map((record) => [record.id, record.name] as const));
    const itemNameById = new Map<number, string>(); // no item catalog in the pack; fall back to the id

    const weaknesses = computeWeaknesses(species.types, pack.typeChart);
    const evolutions = pack.evolutions
      .filter((edge) => edge.fromPokemonId === species.id)
      .map((edge) => ({
        to: pokemonNameById.get(edge.toPokemonId) ?? `#${edge.toPokemonId}`,
        gate: evolutionGate(edge, (id) => itemNameById.get(id) ?? `Item #${id}`),
      }));

    const wildSources = (pack.indexes.routesByPokemon[String(species.id)] ?? [])
      .map((nodeId) => ({ kind: 'Wild', where: nodeNameById.get(nodeId) ?? nodeId }));
    const specialSources = pack.acquisitions
      .filter((record) => 'pokemonId' in record.subject && record.subject.pokemonId === species.id)
      .map((record) => ({ kind: record.subject.kind, where: record.name }));

    return {
      weaknesses,
      evolutions,
      sources: [...wildSources, ...specialSources],
    };
  }, [species, pack]);

  if (species === null || details === null) {
    return <p className="workbench-placeholder">No inspector data for this species.</p>;
  }

  const emitDraft = (patch: Partial<MemberDraft>): void => {
    onDraftMember?.({
      speciesId: species.id,
      level: plannedLevel,
      abilityId,
      moves: plannedMoves,
      ...patch,
    });
  };

  const currentDraft = (): MemberDraft => ({
    speciesId: species.id,
    level: plannedLevel,
    abilityId,
    moves: plannedMoves,
  });

  const onLevelChange = (value: string): void => {
    const level = Number.parseInt(value, 10);
    if (Number.isNaN(level)) return;
    setPlannedLevel(level);
    emitDraft({ level });
  };

  const onAbilityChange = (value: string): void => {
    const nextAbility = Number.parseInt(value, 10);
    setAbilityId(nextAbility);
    emitDraft({ abilityId: nextAbility });
  };

  const onPlanMove = (move: PlannedMove): void => {
    const nextMoves = [...plannedMoves.filter((existing) => existing.moveId !== move.moveId), move];
    setPlannedMoves(nextMoves);
    emitDraft({ moves: nextMoves });
  };

  return (
    <div className="inspector">
      <header className="inspector-head">
        <h4 className="inspector-name" tabIndex={-1} ref={headingRef}>{species.name}</h4>
        <code className="inspector-dex">#{species.id}</code>
      </header>

      <dl className="inspector-summary">
        <div className="inspector-pair">
          <dt>Catch rate</dt>
          <dd>{species.captureRate}</dd>
        </div>
        <div className="inspector-pair">
          <dt>Types</dt>
          <dd>{species.types.map((type) => TYPE_LABEL[type] ?? type).join(' / ')}</dd>
        </div>
        <div className="inspector-pair">
          <dt>Weaknesses</dt>
          <dd>{details.weaknesses.length > 0 ? details.weaknesses.join(', ') : 'None'}</dd>
        </div>
        <div className="inspector-pair">
          <dt>EV yield</dt>
          <dd>{evYieldText(species.evYield)}</dd>
        </div>
      </dl>

      <section className="inspector-section" aria-labelledby="inspector-stats-heading">
        <h5 id="inspector-stats-heading" className="inspector-section-heading">Base stats</h5>
        <table className="stat-table" aria-label="Base stats">
          <tbody>
            {STAT_ROWS.map(([key, label]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td className="stat-value">{species.baseStats[key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="inspector-section" aria-labelledby="inspector-abilities-heading">
        <h5 id="inspector-abilities-heading" className="inspector-section-heading">Abilities</h5>
        <dl className="ability-list">
          {species.abilities.map((ability) => (
            <div key={ability.id} className="ability-item">
              <dt>{ability.name}</dt>
              <dd>{ability.shortEffect}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="inspector-section" aria-labelledby="inspector-evolutions-heading">
        <h5 id="inspector-evolutions-heading" className="inspector-section-heading">Evolutions</h5>
        {details.evolutions.length > 0 ? (
          <ul className="evolution-list" aria-label="Evolutions">
            {details.evolutions.map((evolution) => (
              <li key={evolution.to} className="evolution-item">
                <span className="evolution-target">{evolution.to}</span>
                <span className="evolution-gate">{evolution.gate}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="inspector-empty">Does not evolve.</p>
        )}
      </section>

      <section className="inspector-section">
        <details className="inspector-fold">
          <summary className="inspector-section-heading inspector-fold-summary">
            Acquisition sources ({details.sources.length})
          </summary>
          {details.sources.length > 0 ? (
            <ul className="source-list" aria-label="Acquisition sources">
              {details.sources.map((source, index) => (
                <li key={`${source.kind}-${source.where}-${index}`} className="source-item">
                  <span className="source-kind">{source.kind}</span>
                  <span className="source-where">{source.where}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="inspector-empty">No in-game acquisition recorded.</p>
          )}
        </details>
      </section>

      <section className="inspector-section" aria-labelledby="inspector-plan-heading">
        <h5 id="inspector-plan-heading" className="inspector-section-heading">Plan</h5>
        <div className="plan-controls">
          <label className="plan-field">
            <span>Planned level</span>
            <input
              type="number"
              min={1}
              max={100}
              value={plannedLevel}
              onChange={(event) => onLevelChange(event.target.value)}
            />
          </label>
          {species.abilities.length > 1 && (
            <label className="plan-field">
              <span>Ability</span>
              <select value={abilityId} onChange={(event) => onAbilityChange(event.target.value)}>
                {species.abilities.map((ability) => (
                  <option key={ability.id} value={ability.id}>{ability.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {onAddMember && addMemberLabel && (
          <button type="button" className="app-tool-button" onClick={() => onAddMember(currentDraft())}>
            {addMemberLabel}
          </button>
        )}
      </section>

      <section className="inspector-section" aria-labelledby="inspector-moves-heading">
        <h5 id="inspector-moves-heading" className="inspector-section-heading">Moves</h5>
        <MoveAvailability pokemonId={species.id} pack={pack} context={context} onPlanMove={onPlanMove} />
      </section>

      <section className="inspector-section" aria-labelledby="inspector-provenance-heading">
        <h5 id="inspector-provenance-heading" className="inspector-section-heading">Provenance</h5>
        <ul className="provenance-list">
          {species.provenance.map((entry, index) => (
            <li key={`${entry.sourceId}-${index}`} className="provenance-item">{provenanceText(entry)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
