import * as vscode from 'vscode';

export interface StoredThreadOverride {
  customTitle?: string;
  pinned?: boolean;
  archived?: boolean;
  notes?: string;
}

export class StorageService {
  private static readonly STORAGE_KEY = 'threadweaver_overrides';

  constructor(private readonly context: vscode.ExtensionContext) {}

  public getOverrides(): Record<string, StoredThreadOverride> {
    return this.context.globalState.get<Record<string, StoredThreadOverride>>(
      StorageService.STORAGE_KEY,
      {}
    );
  }

  public getThreadOverride(threadId: string): StoredThreadOverride | undefined {
    const overrides = this.getOverrides();
    return overrides[threadId];
  }

  public async setThreadTitle(threadId: string, customTitle: string): Promise<void> {
    const overrides = this.getOverrides();
    overrides[threadId] = {
      ...overrides[threadId],
      customTitle: customTitle.trim()
    };
    await this.context.globalState.update(StorageService.STORAGE_KEY, overrides);
  }

  public async togglePin(threadId: string): Promise<boolean> {
    const overrides = this.getOverrides();
    const current = !!overrides[threadId]?.pinned;
    overrides[threadId] = {
      ...overrides[threadId],
      pinned: !current
    };
    await this.context.globalState.update(StorageService.STORAGE_KEY, overrides);
    return !current;
  }

  public async toggleArchive(threadId: string): Promise<boolean> {
    const overrides = this.getOverrides();
    const current = !!overrides[threadId]?.archived;
    overrides[threadId] = {
      ...overrides[threadId],
      archived: !current
    };
    await this.context.globalState.update(StorageService.STORAGE_KEY, overrides);
    return !current;
  }

  public async deleteOverride(threadId: string): Promise<void> {
    const overrides = this.getOverrides();
    delete overrides[threadId];
    await this.context.globalState.update(StorageService.STORAGE_KEY, overrides);
  }
}
