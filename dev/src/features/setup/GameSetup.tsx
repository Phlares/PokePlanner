import { useMemo, useState } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import { MILESTONE_ORDER } from '../../domain/availability';
import {
  createStandardPlaythrough,
  type Playthrough,
  type PlaythroughPackIndex,
} from '../../domain/playthrough';

/**
 * Build the id-resolution surface a new playthrough validates against, from the loaded pack.
 * Local to setup: it embeds no canonical data, only lookups keyed by id.
 */
function packIndexOf(pack: FireRedPack): PlaythroughPackIndex {
  const pokemonById = new Map(pack.pokemon.map((record) => [record.id, record]));
  const milestones = new Set<string>(MILESTONE_ORDER);
  const acquisitions = new Set(pack.acquisitions.map((record) => record.id));
  const nodes = new Set(pack.progression.nodes.map((node) => node.id));
  return {
    hasSpecies: (id) => pokemonById.has(id),
    legalAbilityIds: (id) => pokemonById.get(id)?.abilities.map((ability) => ability.id) ?? [],
    isVersionValidMove: (id, moveId) =>
      (pack.learnsets.find((record) => record.pokemonId === id)?.moves ?? []).some((move) => move.moveId === moveId),
    hasMilestone: (id) => milestones.has(id),
    hasAcquisition: (id) => acquisitions.has(id),
    hasNode: (id) => nodes.has(id),
    starterNodeId: () => 'starter-selection',
  };
}

/** A disabled future generation/game/type option: shown so the roadmap is legible, never active. */
interface DisabledOption {
  label: string;
}

const FUTURE_GENERATIONS: DisabledOption[] = [
  { label: 'Generation I' },
  { label: 'Generation II' },
  { label: 'Generation IV' },
];

const FUTURE_GAMES: DisabledOption[] = [
  { label: 'LeafGreen' },
  { label: 'Ruby' },
  { label: 'Sapphire' },
  { label: 'Emerald' },
];

const FUTURE_TYPES: DisabledOption[] = [
  { label: 'Nuzlocke' },
  { label: 'Professor Oak' },
];

export interface GameSetupProps {
  pack: FireRedPack;
  onCreate: (playthrough: Playthrough) => void;
  /** Injected id source; defaults to a random id so the emission is deterministic under test. */
  createId?: () => string;
  /** Injected clock; defaults to `Date.now` so timestamps stay caller-controlled. */
  now?: () => number;
}

/**
 * Generation and game selection for the FireRed vertical slice. Generation III and FireRed are
 * the only enabled tiles; every other generation, game, and playthrough type is rendered but
 * disabled so the supported path is unambiguous. Creating a run emits a validated, empty
 * Standard {@link Playthrough}; App wires persistence.
 */
export function GameSetup({ pack, onCreate, createId = () => crypto.randomUUID(), now = Date.now }: GameSetupProps) {
  const starters = useMemo(() => {
    const list: { id: number; name: string }[] = [];
    for (const record of pack.acquisitions) {
      if (record.subject.kind === 'starter') {
        list.push({ id: record.subject.pokemonId, name: record.name });
      }
    }
    return list;
  }, [pack]);
  const index = useMemo(() => packIndexOf(pack), [pack]);

  const [name, setName] = useState('FireRed Run');
  const [starterSpeciesId, setStarterSpeciesId] = useState(() => starters[0]?.id ?? 1);

  const { versionId, versionGroupId, generationId } = pack.manifest.game;

  const create = (): void => {
    const timestamp = now();
    const playthrough = createStandardPlaythrough(
      {
        id: createId(),
        name: name.trim() === '' ? 'FireRed Run' : name.trim(),
        starterSpeciesId,
        createdAt: timestamp,
        updatedAt: timestamp,
        packVersion: pack.manifest.packVersion,
      },
      index,
    );
    onCreate(playthrough);
  };

  return (
    <section className="setup" aria-labelledby="setup-heading">
      <h2 id="setup-heading">Set up a run</h2>

      <fieldset className="setup-group">
        <legend>Generation</legend>
        <div className="setup-options">
          <button type="button" className="setup-option" aria-pressed="true">
            Generation III
          </button>
          {FUTURE_GENERATIONS.map((option) => (
            <button key={option.label} type="button" className="setup-option" disabled>
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="setup-group">
        <legend>Game</legend>
        <div className="setup-options">
          <button type="button" className="setup-option" aria-pressed="true">
            FireRed
          </button>
          {FUTURE_GAMES.map((option) => (
            <button key={option.label} type="button" className="setup-option" disabled>
              {option.label}
            </button>
          ))}
        </div>
        <ul className="setup-identity" aria-label="FireRed version identity">
          <li>
            <span className="setup-identity-term">Version</span>
            <code className="setup-identity-value">{versionId}</code>
          </li>
          <li>
            <span className="setup-identity-term">Version group</span>
            <code className="setup-identity-value">{versionGroupId}</code>
          </li>
          <li>
            <span className="setup-identity-term">Generation</span>
            <code className="setup-identity-value">{generationId}</code>
          </li>
        </ul>
      </fieldset>

      <fieldset className="setup-group">
        <legend>Playthrough type</legend>
        <div className="setup-options">
          <button type="button" className="setup-option" aria-pressed="true">
            Standard
          </button>
          {FUTURE_TYPES.map((option) => (
            <button key={option.label} type="button" className="setup-option" disabled>
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="setup-group">
        <legend>Starter</legend>
        <div className="setup-options">
          {starters.map((starter) => (
            <button
              key={starter.id}
              type="button"
              className="setup-option"
              aria-pressed={starter.id === starterSpeciesId}
              onClick={() => setStarterSpeciesId(starter.id)}
            >
              {starter.name}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="setup-group">
        <label className="setup-name" htmlFor="setup-name">Run name</label>
        <input
          id="setup-name"
          className="setup-name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <button type="button" className="setup-create" onClick={create}>
        Create playthrough
      </button>
    </section>
  );
}
