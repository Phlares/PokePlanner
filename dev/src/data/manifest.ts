import { z } from 'zod';
import { FIRERED_CONTEXT } from '../domain/game';
import { fireRedPackManifestSchema, type FireRedPackManifest } from '../domain/pack';

const gameContextSchema = z.object({
  id: z.literal(FIRERED_CONTEXT.id),
  name: z.literal(FIRERED_CONTEXT.name),
  versionId: z.literal(FIRERED_CONTEXT.versionId),
  versionGroupId: z.literal(FIRERED_CONTEXT.versionGroupId),
  generationId: z.literal(FIRERED_CONTEXT.generationId),
});

const legacyManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packVersion: z.string().min(1),
  game: gameContextSchema,
  sources: z.array(z.object({ id: z.string().min(1), revision: z.string().min(1) })).min(1),
  files: z.record(z.string(), z.string()),
});

/**
 * The lightweight manifest boundary accepts both the legacy bootstrap manifest
 * (schema version 1) and the verified, content-addressed FireRed pack manifest
 * (schema version 2). It validates and displays manifest metadata only; individual
 * hashed assets are fetched later (Task 8).
 */
const manifestSchema = z.discriminatedUnion('schemaVersion', [legacyManifestSchema, fireRedPackManifestSchema]);

export type GamePackManifest = z.infer<typeof manifestSchema>;
export type { FireRedPackManifest };

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
