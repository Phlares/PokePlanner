import { useMemo } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import type { EncounterArea } from '../../domain/pack';

export interface EncounterTableProps {
  /** One wild-encounter area (a route's method/slot table). */
  area: EncounterArea;
  pack: FireRedPack;
  selectedPokemonId: number | null;
  /** Selecting a row keeps the user on the workbench; the caller opens the inspector in place. */
  onSelectPokemon: (pokemonId: number) => void;
}

/** Abbreviated stat labels for the compact EV-yield cell. */
const STAT_ABBREV: ReadonlyArray<readonly [string, string]> = [
  ['hp', 'HP'],
  ['attack', 'Atk'],
  ['defense', 'Def'],
  ['specialAttack', 'SpA'],
  ['specialDefense', 'SpD'],
  ['speed', 'Spe'],
];

interface EncounterRow {
  key: string;
  pokemonId: number;
  pokemonName: string;
  method: string;
  methodRate: number | null;
  slotChance: number;
  maxChance: number;
  minLevel: number;
  maxLevel: number;
  conditions: readonly string[];
  evYield: string;
}

function levelText(min: number, max: number): string {
  return min === max ? String(min) : `${min}–${max}`;
}

function evYieldText(evYield: Record<string, number>): string {
  const parts = STAT_ABBREV
    .filter(([key]) => (evYield[key] ?? 0) > 0)
    .map(([key, label]) => `${label} ${evYield[key]}`);
  return parts.length > 0 ? parts.join(' ') : '—';
}

/**
 * The wild-encounter ledger for one route area: every method/slot as a factual row. The three
 * probability quantities — the area's per-method encounter rate, the slot's weight within that
 * method, and the slot's cumulative max chance — are shown as SEPARATE columns and never
 * combined. No encounter simulation, expected-time, or catch-odds math is performed: only the
 * recorded facts are displayed.
 */
export function EncounterTable({ area, pack, selectedPokemonId, onSelectPokemon }: EncounterTableProps) {
  const rows = useMemo<EncounterRow[]>(() => {
    const nameById = new Map(pack.pokemon.map((record) => [record.id, record.name] as const));
    const evById = new Map(pack.pokemon.map((record) => [record.id, record.evYield] as const));
    const built: EncounterRow[] = [];
    area.methods.forEach((method, methodIndex) => {
      const methodRate = area.methodRates[method.method] ?? null;
      method.slots.forEach((slot, slotIndex) => {
        built.push({
          key: `${methodIndex}-${slotIndex}`,
          pokemonId: slot.pokemonId,
          pokemonName: nameById.get(slot.pokemonId) ?? `#${slot.pokemonId}`,
          method: method.method,
          methodRate,
          slotChance: slot.chance,
          maxChance: slot.maxChance,
          minLevel: slot.minLevel,
          maxLevel: slot.maxLevel,
          conditions: slot.conditions,
          evYield: evYieldText((evById.get(slot.pokemonId) ?? {}) as Record<string, number>),
        });
      });
    });
    return built;
  }, [area, pack]);

  return (
    <div className="encounter-scroll">
      <table className="encounter-table">
        <caption className="encounter-caption">{area.name}</caption>
        <thead>
          <tr>
            <th scope="col">Pokémon</th>
            <th scope="col">Method</th>
            <th scope="col">Levels</th>
            <th scope="col">Slot chance</th>
            <th scope="col">Method rate</th>
            <th scope="col">Max chance</th>
            <th scope="col">Conditions</th>
            <th scope="col">EV yield</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = selectedPokemonId === row.pokemonId;
            return (
              <tr key={row.key} data-selected={selected || undefined}>
                <th scope="row" className="encounter-cell-name">
                  <button
                    type="button"
                    className="encounter-select"
                    aria-pressed={selected}
                    onClick={() => onSelectPokemon(row.pokemonId)}
                  >
                    {row.pokemonName}
                  </button>
                </th>
                <td className="encounter-cell-method">{row.method}</td>
                <td className="encounter-num">{levelText(row.minLevel, row.maxLevel)}</td>
                <td className="encounter-num">{row.slotChance}%</td>
                <td className="encounter-num">{row.methodRate === null ? '—' : `${row.methodRate}%`}</td>
                <td className="encounter-num">{row.maxChance}%</td>
                <td className="encounter-cell-conditions">
                  {row.conditions.length > 0 ? row.conditions.join(', ') : '—'}
                </td>
                <td className="encounter-cell-ev">{row.evYield}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
