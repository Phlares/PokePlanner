import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PokeApiDataReader } from '../pokeapi-data-reader';
import {
  normalizeLearnsets,
  normalizeAbility,
  normalizeMoveCatalog,
  normalizePokemonCatalog,
  normalizeTypeChart,
} from './normalizer';

const reader = new PokeApiDataReader(resolve('.cache/sources/pokeapi-api-data/0fb5313cb77f46269502e987a53a0bf751ae883d'));

describe('FireRed historical mechanics normalizer', () => {
  it('restores the Generation III mechanics for representative Pokemon and moves', () => {
    const pokemon = normalizePokemonCatalog(reader);
    const moves = normalizeMoveCatalog(reader);
    const typeChart = normalizeTypeChart(reader);
    const clefairy = pokemon.find(({ id }) => id === 35)!;
    const gengar = pokemon.find(({ id }) => id === 94)!;
    const mankey = pokemon.find(({ id }) => id === 56)!;
    const tackle = moves.find(({ id }) => id === 33)!;
    const shadowBall = moves.find(({ id }) => id === 247)!;
    const firePunch = moves.find(({ id }) => id === 7)!;
    const stench = normalizeAbility(reader, {
      ability: { name: 'stench', url: '/api/v2/ability/1/' },
      is_hidden: false,
      slot: 1,
    });
    const bide = moves.find(({ id }) => id === 117)!;
    const curse = moves.find(({ id }) => id === 174)!;

    expect(clefairy.types).toEqual(['normal']);
    expect(clefairy.abilities.map(({ name }) => name)).toEqual(['Cute Charm']);
    expect(gengar.abilities.map(({ name }) => name)).toEqual(['Levitate']);
    expect(mankey.abilities.map(({ name }) => name)).toEqual(['Vital Spirit']);
    expect(tackle).toMatchObject({ power: 35, accuracy: 95, damageClass: 'physical' });
    expect(shadowBall.damageClass).toBe('physical');
    expect(firePunch.damageClass).toBe('special');
    expect(typeChart.steel.resists).toEqual(expect.arrayContaining(['ghost', 'dark']));
    expect(stench.shortEffect).toBe('Has no effect in battle.');
    expect(bide.shortEffect).toBe('Lasts either two or three turns.');
    expect(curse).toMatchObject({ type: 'unknown', damageClass: 'status' });
  }, 120_000);

  it('keeps only FireRed learnset details and preserves its acquisition methods', () => {
    const learnsets = normalizeLearnsets(reader);
    const mankey = learnsets.find(({ pokemonId }) => pokemonId === 56)!;
    const sourceMankey = reader.readPokemon(56) as { moves: Array<{ version_group_details: Array<{ version_group: { url: string } }> }> };
    const fireRedDetailCount = sourceMankey.moves.reduce(
      (count, move) => count + move.version_group_details.filter(({ version_group }) => version_group.url === '/api/v2/version-group/7/').length,
      0,
    );

    expect(mankey.moves).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'level-up' }),
      expect.objectContaining({ method: 'machine' }),
      expect.objectContaining({ method: 'tutor' }),
      expect.objectContaining({ method: 'egg' }),
    ]));
    expect(mankey.moves.every(({ method }) => ['level-up', 'machine', 'tutor', 'egg'].includes(method))).toBe(true);
    expect(mankey.moves).toHaveLength(fireRedDetailCount);
  }, 120_000);

  it('covers the locked Generation III source without later mechanics or dangling references', () => {
    const pokemon = normalizePokemonCatalog(reader);
    const moves = normalizeMoveCatalog(reader);
    const learnsets = normalizeLearnsets(reader);
    const typeChart = normalizeTypeChart(reader);
    const moveIds = new Set(moves.map(({ id }) => id));

    expect(pokemon).toHaveLength(386);
    expect(moves).toHaveLength(354);
    expect(Object.keys(typeChart).filter((key) => key !== 'provenance')).toHaveLength(17);
    expect(pokemon.flatMap(({ abilities }) => abilities).every(({ slot }) => slot === 1 || slot === 2)).toBe(true);
    expect(pokemon.flatMap(({ abilities }) => abilities).map(({ slot }) => slot)).not.toContain(3);
    expect(pokemon.some(({ id }) => id > 386)).toBe(false);
    expect(moves.some(({ id }) => id === 355 || id >= 10001)).toBe(false);
    expect(learnsets).toHaveLength(386);
    expect(learnsets.every(({ pokemonId, moves: learned }) => pokemon.some(({ id }) => id === pokemonId)
      && learned.every(({ moveId }) => moveIds.has(moveId)))).toBe(true);
    expect(Object.hasOwn(typeChart, 'fairy')).toBe(false);
    const { provenance: _provenance, ...relations } = typeChart;
    expect(Object.values(relations).flatMap(({ weakTo, resists, immuneTo }) => [...weakTo, ...resists, ...immuneTo]))
      .not.toContain('fairy');
  }, 120_000);
});
