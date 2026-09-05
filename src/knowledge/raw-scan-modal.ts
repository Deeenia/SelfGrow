import { Modal, Setting, type App } from 'obsidian';
import type { Language } from '../domain';
import type { RawScanReport } from './raw-scan';

export function showRawScanReport(app: App, report: RawScanReport, language: Language): void {
  new RawScanModal(app, report, language).open();
}

class RawScanModal extends Modal {
  readonly #language: Language;
  readonly #report: RawScanReport;

  constructor(app: App, report: RawScanReport, language: Language) {
    super(app);
    this.#report = report;
    this.#language = language;
  }

  override onOpen(): void {
    const chinese = this.#language === 'zh-CN';
    const { beforeCount, categoryCounts, conflictCount, unknownCount } = this.#report;
    this.contentEl.createEl('h2', {
      text: chinese ? 'Raw 目录只读扫描' : 'Raw folder scan',
    });
    this.contentEl.createEl('p', {
      text: chinese
        ? `扫描前文件数：${beforeCount}。仅统计与建议，未移动任何文件。`
        : `Files before scan: ${beforeCount}. Read-only; nothing was moved.`,
    });
    new Setting(this.contentEl)
      .setName('Project')
      .setDesc(
        chinese ? `建议 ${categoryCounts.Project} 条` : `${categoryCounts.Project} suggested`,
      );
    new Setting(this.contentEl)
      .setName('Skill')
      .setDesc(chinese ? `建议 ${categoryCounts.Skill} 条` : `${categoryCounts.Skill} suggested`);
    new Setting(this.contentEl)
      .setName('Experience')
      .setDesc(
        chinese ? `建议 ${categoryCounts.Experience} 条` : `${categoryCounts.Experience} suggested`,
      );
    new Setting(this.contentEl)
      .setName(chinese ? '无法确定' : 'Unknown')
      .setDesc(String(unknownCount));
    new Setting(this.contentEl)
      .setName(chinese ? '信号冲突' : 'Conflicts')
      .setDesc(String(conflictCount));
    new Setting(this.contentEl).addButton((button) =>
      button.setButtonText(chinese ? '关闭' : 'Close').onClick(() => this.close()),
    );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
