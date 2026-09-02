function nonEmptyText(value: string): string | undefined {
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Normalizes the response shapes used by OpenAI-compatible providers.
 * Some providers return a string, some return content blocks without a `type`,
 * and strict structured-output endpoints may return an already parsed object.
 */
export function assistantContentText(content: unknown): string | undefined {
  if (typeof content === 'string') return nonEmptyText(content);
  if (Array.isArray(content)) {
    const text = content
      .map((part) => assistantContentText(part) ?? '')
      .filter((part) => part.length > 0)
      .join('\n')
      .trim();
    return text.length > 0 ? text : undefined;
  }
  if (content === null || typeof content !== 'object') return undefined;

  const record = content as Record<string, unknown>;
  for (const key of ['text', 'content', 'value', 'output_text'] as const) {
    if (!(key in record)) continue;
    const nested = assistantContentText(record[key]);
    if (nested !== undefined) return nested;
  }

  try {
    return JSON.stringify(record);
  } catch {
    return undefined;
  }
}
