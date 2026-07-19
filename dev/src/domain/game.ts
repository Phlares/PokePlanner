export interface GameContext {
  id: string;
  name: string;
  versionId: number;
  versionGroupId: number;
  generationId: number;
}

export const FIRERED_CONTEXT = {
  id: 'firered',
  name: 'Pokémon FireRed',
  versionId: 10,
  versionGroupId: 7,
  generationId: 3,
} as const satisfies GameContext;
