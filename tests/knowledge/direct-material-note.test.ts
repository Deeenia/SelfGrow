import { describe, expect, it } from 'vitest';
import { deriveDirectMaterialTitle, serializeDirectMaterialNote } from '../../src/knowledge';

describe('direct material notes', () => {
  it('uses an explicit title without AI', () => {
    expect(
      deriveDirectMaterialTitle({
        explicitTitle: '我的 Skill 清单',
        fileNames: ['capture.png'],
        note: '正文第一行',
        sourceURL: 'https://example.test/source',
      }),
    ).toBe('我的 Skill 清单');
  });

  it('derives a title locally from the first text line or image name', () => {
    expect(
      deriveDirectMaterialTitle({
        explicitTitle: '',
        fileNames: [],
        note: '1. Using Superpowers\n后续内容',
        sourceURL: 'https://example.test/source',
      }),
    ).toBe('Using Superpowers');
    expect(
      deriveDirectMaterialTitle({
        explicitTitle: '',
        fileNames: ['architecture.png'],
        note: '',
        sourceURL: 'https://example.test/source',
      }),
    ).toBe('architecture');
  });

  it('stores raw text, original image embeds, and the source without AI sections', () => {
    const markdown = serializeDirectMaterialNote({
      attachmentPaths: ['SelfGrow/Attachments/image.png'],
      note: '用户原文',
      sourceURL: 'https://example.test/source',
      title: '原始材料',
    });
    expect(markdown).toContain('# 原始材料\n\n## 内容\n\n用户原文');
    expect(markdown).toContain('![[SelfGrow/Attachments/image.png]]');
    expect(markdown).toContain('[打开原文](<https://example.test/source>)');
    expect(markdown).not.toContain('AI 摘要');
    expect(markdown).not.toContain('核心知识');
  });

  it('supports a direct paste without a source link', () => {
    const markdown = serializeDirectMaterialNote({
      attachmentPaths: [],
      note: '没有链接的短笔记',
      sourceURL: 'selfgrow:text:0123456789abcdef0123456789abcdef',
      title: '短笔记',
    });
    expect(markdown).toContain('## 来源\n\n直接粘贴');
    expect(markdown).not.toContain('selfgrow:text:');
  });

  it('embeds non-image local files as retained evidence', () => {
    const markdown = serializeDirectMaterialNote({
      attachmentPaths: ['Raw/Attachments/report.pdf', 'Raw/Attachments/data.csv'],
      note: '',
      sourceURL: 'selfgrow:text:fixture',
      title: 'Files',
    });
    expect(markdown).toContain('![[Raw/Attachments/report.pdf]]');
    expect(markdown).toContain('![[Raw/Attachments/data.csv]]');
  });
});
