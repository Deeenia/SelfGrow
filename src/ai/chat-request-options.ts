import type { EndpointSettings } from '../settings';

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
  if (/^kimi-k2\.7-code(?:-highspeed)?$/u.test(model)) return;
  if (/^kimi-k2(?:\.|$)/u.test(model)) body.thinking = { type: 'disabled' };
}
