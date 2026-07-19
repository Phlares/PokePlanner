import { z } from 'zod';
import { FIRERED_CONTEXT } from '../domain/game';

const gameContextSchema = z.object({
  id: z.literal(FIRERED_CONTEXT.id),
  name: z.literal(FIRERED_CONTEXT.name),
  versionId: z.literal(FIRERED_CONTEXT.versionId),
  versionGroupId: z.literal(FIRERED_CONTEXT.versionGroupId),
  generationId: z.literal(FIRERED_CONTEXT.generationId),
});

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  packVersion: z.string().min(1),
  game: gameContextSchema,
  sources: z.array(z.object({ id: z.string().min(1), revision: z.string().min(1) })).min(1),
  files: z.record(z.string(), z.string()),
});

export type GamePackManifest = z.infer<typeof manifestSchema>;

export function parseGamePackManifest(input: unknown): GamePackManifest {
  return manifestSchema.parse(input);
}

export async function loadGamePackManifest(
  fetcher: typeof fetch,
  url: string,
): Promise<GamePackManifest> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Unable to load game pack manifest: ${response.status}`);
  return parseGamePackManifest(await response.json());
}
