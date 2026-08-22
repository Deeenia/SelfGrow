import type { ContentExtractor, ExtractionOutcome, ExtractionRequest } from './types';
import type { CaptureVisionPort } from './vision-ocr-service';

export class LinkSupplementExtractor implements ContentExtractor {
  readonly id = 'link-supplement-v2';
  readonly #base: ContentExtractor;
  readonly #vision: CaptureVisionPort;

  constructor(base: ContentExtractor, vision: CaptureVisionPort) {
    this.#base = base;
    this.#vision = vision;
  }

  canHandle(url: URL): boolean {
    return this.#base.canHandle(url);
  }

  async extract(request: ExtractionRequest): Promise<ExtractionOutcome> {
    const note = request.capturedText?.trim() ?? '';
    const imagePaths = request.imagePaths ?? [];
    const hasUserMaterial = note.length > 0 || imagePaths.length > 0;
    if (!hasUserMaterial) {
      return this.#base.extract({
        ...request,
        capturedText: undefined,
        imagePaths: undefined,
      });
    }

    if (
      note.length === 0 &&
      imagePaths.length > 0 &&
      request.url.normalized.startsWith('selfgrow:text:')
    ) {
      let preview;
      try {
        preview = await this.#vision.preview(imagePaths, request.language);
      } catch {
        preview = {
          preview:
            request.language === 'zh-CN'
              ? '原图已保留；当前模型无法生成视觉描述，选择沉淀后可由智能体直接理解图片。'
              : 'The original image is retained; the current model cannot describe it, so an agent can inspect it after selection.',
          title:
            request.suggestedTitle?.trim() ||
            (request.language === 'zh-CN' ? '图片记录' : 'Image capture'),
        };
      }
      return {
        content: {
          body: preview.preview,
          bodyKind: 'article',
          finalURL: request.url.normalized,
          platform: 'unknown',
          route: 'visual_preview',
          sourceLanguage: request.language,
          title: preview.title,
        },
        kind: 'complete',
      };
    }

    let linkOutcome: ExtractionOutcome | null = null;
    try {
      linkOutcome = await this.#base.extract({
        ...request,
        capturedText: undefined,
        imagePaths: undefined,
      });
      if (linkOutcome.kind === 'complete') return linkOutcome;
    } catch {
      // Supplied text/OCR remains available as a temporary fallback.
    }

    const recognized = imagePaths.length > 0 ? await this.#vision.recognize(imagePaths) : '';
    const userMaterial = [note, recognized]
      .filter((value) => value.length > 0)
      .join('\n\n')
      .trim();
    if (userMaterial.length === 0) {
      return (
        linkOutcome ?? {
          code: 'capture_material_unavailable',
          kind: 'incomplete',
          message: 'The supplied material did not contain usable text.',
        }
      );
    }
    return fallback(request, userMaterial);
  }
}

function fallback(request: ExtractionRequest, material: string): ExtractionOutcome {
  return {
    content: {
      body: material,
      bodyKind: 'article',
      finalURL: request.url.normalized,
      platform: request.url.platform,
      route: 'captured_text',
    },
    kind: 'complete',
  };
}
