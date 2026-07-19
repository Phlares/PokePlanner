import { z } from 'zod';

const SOURCE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const REVISION_PATTERN = /^[0-9a-f]{40}$/;

const sourceLockEntrySchema = z.object({
  id: z.string().regex(SOURCE_ID_PATTERN),
  repository: z.string().superRefine((value, context) => {
    if (value.trim() !== value) {
      context.addIssue({
        code: 'custom',
        message: 'Repository URL must not have leading or trailing whitespace',
      });
      return;
    }

    let repository: URL;
    try {
      repository = new URL(value);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Repository must be a valid URL',
      });
      return;
    }

    if (repository.protocol !== 'https:' || repository.username || repository.password || !repository.hostname) {
      context.addIssue({
        code: 'custom',
        message: 'Repository must be a credential-free HTTPS URL',
      });
    }
  }),
  revision: z.string().regex(REVISION_PATTERN),
  license: z.string().min(1).nullable(),
}).strict();

export type SourceLockEntry = z.infer<typeof sourceLockEntrySchema>;

export const REQUIRED_POKEAPI_SOURCE = Object.freeze({
  id: 'pokeapi-api-data',
  repository: 'https://github.com/PokeAPI/api-data.git',
  revision: '0fb5313cb77f46269502e987a53a0bf751ae883d',
  license: 'BSD-3-Clause',
} satisfies SourceLockEntry);

function isRequiredPokeApiSource(source: SourceLockEntry | undefined): boolean {
  return source?.id === REQUIRED_POKEAPI_SOURCE.id
    && source.repository === REQUIRED_POKEAPI_SOURCE.repository
    && source.revision === REQUIRED_POKEAPI_SOURCE.revision
    && source.license === REQUIRED_POKEAPI_SOURCE.license;
}

const sourceLockSchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(sourceLockEntrySchema).min(1),
}).strict().superRefine((lock, context) => {
  const seenIds = new Set<string>();
  for (const [index, source] of lock.sources.entries()) {
    if (seenIds.has(source.id)) {
      context.addIssue({
        code: 'custom',
        path: ['sources', index, 'id'],
        message: `Duplicate source ID: ${source.id}`,
      });
    }
    seenIds.add(source.id);
  }

  const requiredSource = lock.sources.find(({ id }) => id === REQUIRED_POKEAPI_SOURCE.id);
  if (!isRequiredPokeApiSource(requiredSource)) {
    context.addIssue({
      code: 'custom',
      path: ['sources'],
      message: 'Foundation lock must contain the matching required PokeAPI source',
    });
  }
});

export type SourceLockFile = z.infer<typeof sourceLockSchema>;

export function parseSourceLockEntry(input: unknown): SourceLockEntry {
  const result = sourceLockEntrySchema.safeParse(input);
  if (result.success) return result.data;

  const field = result.error.issues[0]?.path[0];
  if (field === 'id') throw new Error(`Invalid source ID: ${String((input as { id?: unknown })?.id)}`);
  if (field === 'repository') {
    throw new Error(`Invalid source repository: ${String((input as { repository?: unknown })?.repository)}`);
  }
  if (field === 'revision') {
    throw new Error(`Invalid source revision: ${String((input as { revision?: unknown })?.revision)}`);
  }
  throw new Error(`Invalid source lock entry: ${z.prettifyError(result.error)}`);
}

export function parseSourceLock(input: unknown): SourceLockFile {
  return sourceLockSchema.parse(input);
}
