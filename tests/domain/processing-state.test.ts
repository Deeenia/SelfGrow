import { describe, expect, it } from 'vitest';
import { canTransition, legalTransitionsFrom, PROCESSING_STATES } from '../../src/domain';

describe('processing state', () => {
  it('uses the short extraction and generation pipeline', () => {
    expect(PROCESSING_STATES).toEqual([
      'queued',
      'waiting_network',
      'waiting_ai_configuration',
      'extracting',
      'generating',
      'completed',
      'incomplete_extraction',
      'failed',
    ]);
    expect(legalTransitionsFrom('generating')).toContain('completed');
    expect(canTransition('generating', 'completed')).toBe(true);
  });
});
