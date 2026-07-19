import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import routeProgressionSchema from '../../data/schemas/route-progression.schema.json';

export interface ProgressionEvent {
  id: string;
  order: number;
  type: string;
  name: string;
  flags: {
    keyMilestone: boolean;
    gym: boolean;
    rivalFight: boolean;
    bossFight: boolean;
    storyFight: boolean;
    optional: boolean;
  };
}

export interface ProgressionNode {
  id: string;
  name: string;
  kind: string;
  phase: string;
  goldenPathOrder: number;
  prerequisiteEventIds: string[];
  nextNodeIds: string[];
  events: ProgressionEvent[];
}

export interface RouteProgression {
  schemaVersion: number;
  game: { id: string; versionId: number; versionGroupId: number; generationId: number };
  nodes: ProgressionNode[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(routeProgressionSchema);

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };

export function validateRouteProgression(input: unknown): ValidationResult {
  if (validate(input)) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.keyword}: ${error.message ?? 'invalid'}`),
  };
}
