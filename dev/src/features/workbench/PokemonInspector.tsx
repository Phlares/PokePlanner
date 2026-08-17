import { useMemo, type Ref } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import type { AvailabilityContext } from '../../domain/availability';
import type { EvolutionEdge, PokemonRecord, Provenance, TypeChart } from '../../domain/pack';
import type { GameRules, NatureRule, StatKey } from '../../domain/rules/game-rules';
import { titleCase } from '../text';
import { MoveAvailability } from './MoveAvailability';
import {
  ACCESS_LABEL,
  STAT_LABEL,
  STAT_ORDER,
  levelLabel,
  nowhereLabel,
} from './labels';
import type { PokemonLocationsResult } from './selectors';

/** One action the owner offers on the displayed candidate; the inspector never invents its own. */
export interface CandidateAction {
  label: string;
  onSelect: () => void;
}

export interface PokemonInspectorProps {
  pokemonId: number;
  pack: FireRedPack;
  /** The version rules, read for the nature spread the reference ranges span (spec §16). */
  rules: GameRules;
  context: AvailabilityContext;
  /** The shared Where & When view model; null when the pack does not carry the species. */
  locations: PokemonLocationsResult | null;
  /** Add/Compare actions the owner can honour right now (spec §13); empty offers no surface. */
  actions?: readonly CandidateAction[];
  /** Why an action the user might expect is missing, in the owner's words. */
  actionNote?: string | null;
  /** The species heading, which the shell focuses when a candidate is selected (spec §20). */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * The hidden per-member values a plan never chooses. Both extremes are shown, so a reference range
 * spans everything a member of the species could turn out to be and never reads as an exact stat.
 */
const WORST_HIDDEN = { individual: 0, effort: 0 };
const BEST_HIDDEN = { individual: 31, effort: 252 };
const REFERENCE_LEVELS = [50, 100] as const;

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
    if (multiplier > 1) weaknesses.push(titleCase(attacker));
  }
  return weaknesses;
}

function evYieldText(evYield: PokemonRecord['evYield']): string {
  const parts = STAT_ORDER
    .filter((key) => evYield[key] > 0)
    .map((key) => `${STAT_LABEL[key]} ${evYield[key]}`);
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

/** The strongest modifier the ruleset gives a nature, as a signed share of one stat (spec §16). */
function natureSpread(natures: readonly NatureRule[]): number {
  return natures.reduce((highest, nature) => Math.max(highest, nature.multiplier), 0);
}

/** One stat of a species at one level, for one set of hidden values and one nature modifier. */
function statAt(
  base: number,
  level: number,
  key: StatKey,
  hidden: { individual: number; effort: number },
  modifier: number,
): number {
  const core = Math.floor(((2 * base + hidden.individual + Math.floor(hidden.effort / 4)) * level) / 100);
  return key === 'hp' ? core + level + 10 : Math.floor((core + 5) * modifier);
}

function referenceRange(base: number, level: number, key: StatKey, modifier: number): string {
  return `${statAt(base, level, key, WORST_HIDDEN, modifier)}–${statAt(base, level, key, BEST_HIDDEN, modifier)}`;
}

/**
 * The Pokémon inspector: a read-only candidate surface (spec §5, §17). It states one species —
 * catch rate, types, derived weaknesses, EV yield, base stats with collapsed reference ranges,
 * legal abilities, the evolution chain in both directions, where the run can obtain it, and the
 * move-availability drawers — and offers only the Add/Compare actions its owner hands it.
 *
 * It holds no draft: nothing here edits a level, an ability or a move, because a browsing surface
 * must not be able to produce a member the timeline never agreed to. Where & When arrives as the
 * same view model the centre pane reads, so the two can never derive different evidence. Missing
 * sprites are simply omitted — the panel is data-forward and never blocks on artwork.
 */
export function PokemonInspector({
  pokemonId,
  pack,
  rules,
  context,
  locations,
  actions = [],
  actionNote = null,
  headingRef,
}: PokemonInspectorProps) {
  const species = useMemo(
    () => pack.pokemon.find((record) => record.id === pokemonId) ?? null,
    [pack, pokemonId],
  );

  const details = useMemo(() => {
    if (species === null) return null;
    const pokemonNameById = new Map(pack.pokemon.map((record) => [record.id, record.name] as const));
    const itemNameById = new Map<number, string>(); // no item catalog in the pack; fall back to the id
    const name = (id: number): string => pokemonNameById.get(id) ?? `#${id}`;
    const gate = (edge: EvolutionEdge): string =>
      evolutionGate(edge, (id) => itemNameById.get(id) ?? `Item #${id}`);

    return {
      weaknesses: computeWeaknesses(species.types, pack.typeChart),
      // Both directions of the chain, so a mid-chain species states what it came from as well as
      // what it becomes (spec §17). A species at either end simply contributes no line.
      chain: [
        ...pack.evolutions
          .filter((edge) => edge.toPokemonId === species.id)
          .map((edge) => `Evolves from ${name(edge.fromPokemonId)}`),
        ...pack.evolutions
          .filter((edge) => edge.fromPokemonId === species.id)
          .map((edge) => `Evolves to ${name(edge.toPokemonId)} · ${gate(edge)}`),
      ],
    };
  }, [species, pack]);

  if (species === null || details === null) {
    return <p className="workbench-placeholder">No inspector data for this species.</p>;
  }

  const spread = natureSpread(rules.natures);
  const natureColumns: ReadonlyArray<readonly [string, number]> = [
    ['Hindering', 1 - spread],
    ['Neutral', 1],
    ['Beneficial', 1 + spread],
  ];

  const whereRows = (locations?.paths ?? []).map((path) => ({
    nodeId: path.nodeId,
    text: [path.name, path.milestoneName, ACCESS_LABEL[path.access], levelLabel(path.minLevel, path.maxLevel)]
      .filter((part): part is string => part !== null)
      .join(' · '),
  }));

  return (
    <div className="inspector">
      <header className="inspector-head">
        <div className="inspector-identity">
          <h4 className="inspector-name" tabIndex={-1} ref={headingRef}>{species.name}</h4>
          <code className="inspector-dex">#{species.id}</code>
        </div>
        <ul className="inspector-type-list" aria-label="Types">
          {species.types.map((type) => (
            <li key={type} className="inspector-type">{titleCase(type)}</li>
          ))}
        </ul>
        {actions.length > 0 && (
          <div className="inspector-actions" role="group" aria-label={`${species.name} actions`}>
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="app-tool-button"
                onClick={action.onSelect}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        {actionNote !== null && <p className="inspector-action-note">{actionNote}</p>}
      </header>

      <div className="inspector-columns">
        <section className="inspector-section" aria-labelledby="inspector-overview-heading">
          <h5 id="inspector-overview-heading" className="inspector-section-heading">Overview</h5>

          <dl className="inspector-summary">
            <div className="inspector-pair">
              <dt>Catch rate</dt>
              <dd>{species.captureRate}</dd>
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

          <h6 className="inspector-block-heading">Base stats</h6>
          <table className="stat-table" aria-label="Base stats">
            <tbody>
              {STAT_ORDER.map((key) => (
                <tr key={key}>
                  <th scope="row">{STAT_LABEL[key]}</th>
                  <td className="stat-value">{species.baseStats[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <details className="inspector-fold">
            <summary className="inspector-block-heading inspector-fold-summary">Reference ranges</summary>
            <p className="inspector-note">
              What any member of the species can reach — not this Pokémon’s stats, because the
              individual and effort values behind them are never planned here.
            </p>
            {REFERENCE_LEVELS.map((level) => (
              <table key={level} className="stat-table" aria-label={`Lv ${level} reference ranges`}>
                <thead>
                  <tr>
                    <th scope="col">Stat</th>
                    {natureColumns.map(([label]) => <th key={label} scope="col">{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {STAT_ORDER.map((key) => (
                    <tr key={key}>
                      <th scope="row">{STAT_LABEL[key]}</th>
                      {natureColumns.map(([label, modifier]) => (
                        <td key={label} className="stat-value">
                          {referenceRange(species.baseStats[key], level, key, modifier)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </details>

          <h6 className="inspector-block-heading">Abilities</h6>
          <dl className="ability-list">
            {species.abilities.map((ability) => (
              <div key={ability.id} className="ability-item">
                <dt>{ability.name}</dt>
                <dd>{ability.shortEffect}</dd>
              </div>
            ))}
          </dl>

          <h6 className="inspector-block-heading">Evolution chain</h6>
          {details.chain.length > 0 ? (
            <ul className="evolution-list" aria-label="Evolution chain">
              {details.chain.map((step) => <li key={step} className="evolution-item">{step}</li>)}
            </ul>
          ) : (
            <p className="inspector-empty">Does not evolve.</p>
          )}
        </section>

        <section className="inspector-section" aria-labelledby="inspector-moves-heading">
          <h5 id="inspector-moves-heading" className="inspector-section-heading">Moves</h5>
          <MoveAvailability pokemonId={species.id} pack={pack} context={context} />
        </section>

        <section className="inspector-section" aria-labelledby="inspector-where-heading">
          <h5 id="inspector-where-heading" className="inspector-section-heading">Where</h5>
          <details className="inspector-fold">
            <summary className="inspector-block-heading inspector-fold-summary">
              Acquisition summary ({whereRows.length})
            </summary>
            {whereRows.length > 0 ? (
              <ul className="source-list" aria-label={`${species.name} acquisition summary`}>
                {whereRows.map((row) => (
                  <li key={row.nodeId} className="source-item">{row.text}</li>
                ))}
              </ul>
            ) : (
              <p className="inspector-empty">{nowhereLabel(species.name)}</p>
            )}
          </details>
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
    </div>
  );
}
