export const PROCESSING_STATES = [
  'queued',
  'waiting_network',
  'waiting_ai_configuration',
  'extracting',
  'generating',
  'completed',
  'incomplete_extraction',
  'failed',
] as const;

export type ProcessingState = (typeof PROCESSING_STATES)[number];

const LEGAL_TRANSITIONS = {
  queued: ['waiting_network', 'waiting_ai_configuration', 'extracting', 'failed'],
  waiting_network: ['queued', 'failed'],
  waiting_ai_configuration: ['queued', 'failed'],
  extracting: ['generating', 'waiting_network', 'incomplete_extraction', 'failed'],
  generating: ['completed', 'waiting_network', 'waiting_ai_configuration', 'failed'],
  completed: [],
  incomplete_extraction: ['queued'],
  failed: ['queued'],
} as const satisfies Record<ProcessingState, readonly ProcessingState[]>;

export function legalTransitionsFrom(state: ProcessingState): readonly ProcessingState[] {
  return LEGAL_TRANSITIONS[state];
}

export function canTransition(from: ProcessingState, to: ProcessingState): boolean {
  return (LEGAL_TRANSITIONS[from] as readonly ProcessingState[]).includes(to);
}
