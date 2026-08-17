import { useMemo } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import type { EncounterArea } from '../../domain/pack';
import type { CapabilityState } from '../../domain/timeline/capabilities';
import { CAPABILITY_LABEL } from './labels';

export interface EncounterTableProps {
  /** One wild-encounter area (a route's method/slot table). */
  area: EncounterArea;
  pack: FireRedPack;
  selectedPokemonId: number | null;
  /**
   * Species the active query places here. Omitted while browsing, where every row would carry the
   * mark and it would therefore say nothing.
   */
  matchedPokemonIds?: ReadonlySet<number>;
  /**
   * Species id → capability verdict while a capability search runs. It arrives resolved from the
   * one evaluator every workbench surface reads, so a row here cannot disagree with a result row.
   */
  capabilityStates?: ReadonlyMap<number, CapabilityState>;
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
  /** Total encounter chance for the species in this method: the SUM of its slot chances. */
  totalChance: number;
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
 * The wild-encounter ledger for one route area, deduped to ONE row per (method, species). The
 * pack keeps a species' slots separate; the display aggregates them factually — levels become the
 * min–max range across the slots, and Chance is the SUM of the slot chances (the species' total
 * encounter chance within that method). The area's per-method encounter rate stays its own
 * separate column and is never folded into the species chance. No encounter simulation,
 * expected-time, or catch-odds math is performed: only the recorded facts are displayed.
 *
 * Match and capability evidence arrives resolved from the caller and is stated in words inside the
 * species cell, so neither rests on a background colour (spec §20) and the table stays a table.
 */
export function EncounterTable({
  area,
  pack,
  selectedPokemonId,
  matchedPokemonIds,
  capabilityStates,
  onSelectPokemon,
}: EncounterTableProps) {
  const rows = useMemo<EncounterRow[]>(() => {
    const nameById = new Map(pack.pokemon.map((record) => [record.id, record.name] as const));
    const evById = new Map(pack.pokemon.map((record) => [record.id, record.evYield] as const));
    const built: EncounterRow[] = [];
    area.methods.forEach((method, methodIndex) => {
      const methodRate = area.methodRates[method.method] ?? null;
      // Aggregate the method's slots into one entry per species, preserving first-seen order.
      const byPokemon = new Map<number, EncounterRow>();
      method.slots.forEach((slot) => {
        const existing = byPokemon.get(slot.pokemonId);
        if (existing === undefined) {
          byPokemon.set(slot.pokemonId, {
            key: `${methodIndex}-${slot.pokemonId}`,
            pokemonId: slot.pokemonId,
            pokemonName: nameById.get(slot.pokemonId) ?? `#${slot.pokemonId}`,
            method: method.method,
            methodRate,
            totalChance: slot.chance,
            minLevel: slot.minLevel,
            maxLevel: slot.maxLevel,
            conditions: [...slot.conditions],
            evYield: evYieldText((evById.get(slot.pokemonId) ?? {}) as Record<string, number>),
          });
          return;
        }
        existing.totalChance += slot.chance;
        existing.minLevel = Math.min(existing.minLevel, slot.minLevel);
        existing.maxLevel = Math.max(existing.maxLevel, slot.maxLevel);
        const merged = existing.conditions as string[];
        for (const condition of slot.conditions) {
          if (!merged.includes(condition)) merged.push(condition);
        }
      });
      // Deterministic order within a method: descending total chance, then ascending species id.
      const methodRows = [...byPokemon.values()].sort(
        (a, b) => b.totalChance - a.totalChance || a.pokemonId - b.pokemonId,
      );
      built.push(...methodRows);
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
            <th scope="col">Chance</th>
            <th scope="col">Method rate</th>
            <th scope="col">Conditions</th>
            <th scope="col">EV yield</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = selectedPokemonId === row.pokemonId;
            const matched = matchedPokemonIds?.has(row.pokemonId) ?? false;
            const capability = capabilityStates?.get(row.pokemonId);
            const capabilityLabel = capability === undefined ? undefined : CAPABILITY_LABEL[capability];
            return (
              <tr key={row.key} data-selected={selected || undefined} data-match={matched || undefined}>
                <th scope="row" className="encounter-cell-name">
                  <button
                    type="button"
                    className="encounter-select"
                    aria-pressed={selected}
                    onClick={() => onSelectPokemon(row.pokemonId)}
                  >
                    {row.pokemonName}
                  </button>
                  {matched && <span className="encounter-match">Match</span>}
                  {capabilityLabel !== undefined && (
                    <span className="encounter-capability" data-state={capability}>{capabilityLabel}</span>
                  )}
                </th>
                <td className="encounter-cell-method">{row.method}</td>
                <td className="encounter-num">{levelText(row.minLevel, row.maxLevel)}</td>
                <td className="encounter-num">{row.totalChance}%</td>
                <td className="encounter-num">{row.methodRate === null ? '—' : `${row.methodRate}%`}</td>
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
