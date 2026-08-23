import { describe, expect, it } from 'vitest';
import { selfGrowID } from '../../src/domain';
import {
  LinkSupplementExtractor,
  type CaptureVisionPort,
  type ContentExtractor,
  type ExtractionRequest,
} from '../../src/extraction';
import type { NormalizedURL } from '../../src/url';

const URL_VALUE = 'https://example.test/source';

function request(patch: Partial<ExtractionRequest> = {}): ExtractionRequest {
  const url: NormalizedURL = {
    normalized: URL_VALUE,
    platform: 'generic_web',
    received: URL_VALUE,
  };
  return {
    id: selfGrowID('capture'),
    imagePaths: ['SelfGrow/Inbox/Attachments/image.png'],
    language: 'zh-CN',
    url,
    ...patch,
  };
}

const vision: CaptureVisionPort = {
  preview: () =>
    Promise.resolve({
      category: 'Project',
      preview: '图片展示了一个清晰的系统架构。',
      recommendation: null,
      title: '系统架构图',
    }),
  recognize: () => Promise.resolve('截图识别出的技术说明文字'),
};

describe('LinkSupplementExtractor', () => {
  it('prefers complete link extraction and does not attach source material', async () => {
    let baseCalls = 0;
    const base: ContentExtractor = {
      canHandle: () => true,
      extract: (input) => {
        baseCalls += 1;
        expect(input.capturedText).toBeUndefined();
        expect(input.imagePaths).toBeUndefined();
        return Promise.resolve({
          content: {
            body: '链接解析得到的完整正文'.repeat(20),
            bodyKind: 'article',
            finalURL: URL_VALUE,
            platform: 'generic_web',
            route: 'local_article',
          },
          kind: 'complete',
        });
      },
      id: 'fixture',
    };
    const result = await new LinkSupplementExtractor(base, vision).extract(
      request({ capturedText: '用户手写备注' }),
    );
    expect(result.kind).toBe('complete');
    if (result.kind !== 'complete') throw new Error('Expected complete extraction.');
    expect(baseCalls).toBe(1);
    expect(result.content.body).toBe('链接解析得到的完整正文'.repeat(20));
    expect(result.content).toMatchObject({
      finalURL: URL_VALUE,
      route: 'local_article',
    });
    expect(result.content).not.toHaveProperty('userMaterialMarkdown');
  });

  it('uses temporary supplied material only as fallback when link extraction fails', async () => {
    const base: ContentExtractor = {
      canHandle: () => true,
      extract: () => Promise.reject(new Error('Link extraction must not run.')),
      id: 'fixture',
    };
    const result = await new LinkSupplementExtractor(base, vision).extract(
      request({ capturedText: '补充说明文字' }),
    );
    expect(result).toMatchObject({
      content: {
        body: '补充说明文字\n\n截图识别出的技术说明文字',
        route: 'captured_text',
      },
      kind: 'complete',
    });
    if (result.kind !== 'complete') throw new Error('Expected complete extraction.');
    expect(result.content).not.toHaveProperty('userMaterialMarkdown');
  });

  it('uses temporary supplied material when link extraction is incomplete', async () => {
    const base: ContentExtractor = {
      canHandle: () => true,
      extract: () =>
        Promise.resolve({
          code: 'main_text_missing',
          kind: 'incomplete',
          message: 'No body.',
        }),
      id: 'fixture',
    };
    await expect(
      new LinkSupplementExtractor(base, vision).extract(request({ capturedText: '补充说明文字' })),
    ).resolves.toMatchObject({
      content: {
        body: '补充说明文字\n\n截图识别出的技术说明文字',
        route: 'captured_text',
      },
      kind: 'complete',
    });
  });

  it('parses the link only when no note or image was supplied', async () => {
    let baseCalls = 0;
    const base: ContentExtractor = {
      canHandle: () => true,
      extract: () => {
        baseCalls += 1;
        return Promise.resolve({
          content: {
            body: '链接正文'.repeat(20),
            bodyKind: 'article',
            finalURL: URL_VALUE,
            platform: 'generic_web',
            route: 'local_article',
          },
          kind: 'complete',
        });
      },
      id: 'fixture',
    };

    await expect(
      new LinkSupplementExtractor(base, vision).extract(
        request({ capturedText: undefined, imagePaths: undefined }),
      ),
    ).resolves.toMatchObject({ content: { route: 'local_article' }, kind: 'complete' });
    expect(baseCalls).toBe(1);
  });

  it('uses multimodal understanding rather than OCR for an image-only capture', async () => {
    const base: ContentExtractor = {
      canHandle: () => true,
      extract: () => Promise.reject(new Error('Image-only input must not use link extraction.')),
      id: 'fixture',
    };

    await expect(
      new LinkSupplementExtractor(base, vision).extract(
        request({
          capturedText: undefined,
          url: {
            normalized: 'selfgrow:text:image-capture',
            platform: 'unknown',
            received: 'selfgrow:text:image-capture',
          },
        }),
      ),
    ).resolves.toMatchObject({
      content: {
        body: '图片展示了一个清晰的系统架构。',
        route: 'visual_preview',
        title: '系统架构图',
        visualRecognition: {
          category: 'Project',
          recommendation: null,
          source: 'ai',
        },
      },
      kind: 'complete',
    });
  });

  it('still creates an honest image Raw when the configured model has no vision support', async () => {
    const noVision: CaptureVisionPort = {
      preview: () => Promise.reject(new Error('Model does not support images.')),
      recognize: () => Promise.resolve(''),
    };
    const base: ContentExtractor = {
      canHandle: () => true,
      extract: () => Promise.reject(new Error('Image-only input must not use link extraction.')),
      id: 'fixture',
    };

    await expect(
      new LinkSupplementExtractor(base, noVision).extract(
        request({
          suggestedTitle: '架构截图',
          url: {
            normalized: 'selfgrow:text:image-capture',
            platform: 'unknown',
            received: 'selfgrow:text:image-capture',
          },
        }),
      ),
    ).resolves.toMatchObject({
      content: {
        body: '原图已保留；当前模型无法生成视觉描述，选择沉淀后可由智能体直接理解图片。',
        route: 'visual_preview',
        title: '架构截图',
        visualRecognition: {
          category: 'Experience',
          recommendation: null,
          source: 'local',
        },
      },
      kind: 'complete',
    });
  });
});
