import type { EndpointSettings } from '../settings';

export type StructuredOutputKind = 'raw_card' | 'recommendation' | 'visual_card';

/**
 * Requests the fastest non-thinking mode exposed by each supported provider.
 * Kimi K3 and K2.7 Code cannot disable reasoning, so they use the provider's
 * lowest available behavior instead of sending an unsupported switch.
 */
export function applySupportedNonThinkingMode(
  body: Record<string, unknown>,
  configuration: Pick<EndpointSettings, 'model' | 'preset'>,
): void {
  const model = configuration.model.trim().toLocaleLowerCase();
  if (configuration.preset === 'deepseek') {
    body.thinking = { type: 'disabled' };
    return;
  }
  if (configuration.preset === 'qwen') {
    body.enable_thinking = false;
    return;
  }
  if (configuration.preset !== 'kimi') return;

  if (model === 'kimi-k3') {
    body.reasoning_effort = 'low';
    return;
  }
  if (isForcedThinkingKimiModel(configuration)) return;
  if (/^kimi-k2(?:\.|$)/u.test(model)) body.thinking = { type: 'disabled' };
}

export function isForcedThinkingKimiModel(
  configuration: Pick<EndpointSettings, 'model' | 'preset'>,
): boolean {
  return (
    configuration.preset === 'kimi' &&
    /^kimi-k2\.7-code(?:-highspeed)?$/u.test(configuration.model.trim().toLocaleLowerCase())
  );
}

export function structuredResponseFormat(
  configuration: Pick<EndpointSettings, 'model' | 'preset'>,
  kind: StructuredOutputKind,
): Record<string, unknown> {
  const model = configuration.model.trim().toLocaleLowerCase();
  const supported =
    isForcedThinkingKimiModel(configuration) ||
    (configuration.preset === 'qwen' &&
      /^qwen3\.(?:7-(?:plus|max)|8-(?:flash|plus|max))(?:-|$)/u.test(model));
  if (!supported) {
    return { type: 'json_object' };
  }
  return {
    json_schema: {
      name: `selfgrow_${kind}`,
      schema: structuredOutputSchema(kind),
      strict: true,
    },
    type: 'json_schema',
  };
}

export function usesStrictStructuredOutput(
  configuration: Pick<EndpointSettings, 'model' | 'preset'>,
): boolean {
  return structuredResponseFormat(configuration, 'raw_card').type === 'json_schema';
}

function structuredOutputSchema(kind: StructuredOutputKind): Record<string, unknown> {
  if (kind === 'recommendation') {
    return {
      additionalProperties: false,
      properties: {
        matchedPreferenceSignals: { items: { type: 'string' }, type: 'array' },
        recommendationReason: { maxLength: 300, minLength: 8, type: 'string' },
        recommendationScore: { maximum: 100, minimum: 0, type: 'integer' },
      },
      required: ['recommendationScore', 'recommendationReason', 'matchedPreferenceSignals'],
      type: 'object',
    };
  }
  const properties: Record<string, unknown> = {
    category: { enum: ['Project', 'Skill', 'Experience'], type: 'string' },
    matchedPreferenceSignals: { items: { type: 'string' }, type: 'array' },
    preview: {
      maxLength: kind === 'raw_card' ? 140 : 200,
      minLength: kind === 'raw_card' ? 20 : 1,
      type: 'string',
    },
    recommendationReason: { maxLength: 300, minLength: 8, type: 'string' },
    recommendationScore: { maximum: 100, minimum: 0, type: 'integer' },
    title: { maxLength: kind === 'raw_card' ? 48 : 80, minLength: 2, type: 'string' },
  };
  const required = ['category', 'title', 'preview'];
  if (kind === 'raw_card') {
    properties.githubQueries = { items: { type: 'string' }, type: 'array' };
    required.push('githubQueries');
  }
  return {
    additionalProperties: false,
    properties,
    required,
    type: 'object',
  };
}
