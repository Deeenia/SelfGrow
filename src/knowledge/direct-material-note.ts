export interface DirectMaterialTitleInput {
  explicitTitle: string;
  fileNames: readonly string[];
  note: string;
  sourceURL: string;
}

export interface DirectMaterialNoteInput {
  attachmentPaths: readonly string[];
  note: string;
  sourceURL: string;
  title: string;
}

export function deriveDirectMaterialTitle(input: DirectMaterialTitleInput): string {
  const explicit = firstLine(input.explicitTitle);
  if (explicit.length > 0) return explicit;
  const note = firstLine(input.note)
    .replace(/^(?:#{1,6}|[-*+]\s+|\d+[.)]\s*)\s*/, '')
    .trim();
  if (note.length > 0) return note;
  const file = input.fileNames.find((name) => name.trim().length > 0);
  if (file !== undefined) return file.replace(/\.[^.]+$/, '').trim() || '文件记录';
  try {
    return new URL(input.sourceURL).hostname || '链接记录';
  } catch {
    return '链接记录';
  }
}

export function serializeDirectMaterialNote(input: DirectMaterialNoteInput): string {
  const material = [
    input.note.trim(),
    input.attachmentPaths.map((path) => `![[${path}]]`).join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    `# ${input.title}`,
    '',
    '## 内容',
    '',
    material,
    '',
    '## 来源',
    '',
    input.sourceURL.startsWith('selfgrow:text:') ? '直接粘贴' : `[打开原文](<${input.sourceURL}>)`,
    '',
  ].join('\n');
}

function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  );
}
