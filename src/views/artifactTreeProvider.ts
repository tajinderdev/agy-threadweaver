import * as vscode from 'vscode';
import { BrainWatcher } from '../services/brainWatcher';
import { ArtifactItem } from '../models/artifact';

export class ArtifactTreeItem extends vscode.TreeItem {
  constructor(
    public readonly artifact: ArtifactItem,
    public readonly threadTitle?: string
  ) {
    super(artifact.name, vscode.TreeItemCollapsibleState.None);

    this.description = `${artifact.sizeFormatted} • ${threadTitle || artifact.conversationId.slice(0, 8)}`;
    this.tooltip = `${artifact.absolutePath}\nSize: ${artifact.sizeFormatted}\nCreated: ${new Date(artifact.createdAt).toLocaleString()}`;
    
    this.iconPath = new vscode.ThemeIcon(
      artifact.type === 'plan'
        ? 'checklist'
        : artifact.type === 'diagram'
        ? 'graph'
        : artifact.type === 'code'
        ? 'code'
        : 'file-text'
    );

    this.command = {
      command: 'threadweaver.openArtifact',
      title: 'Open Artifact',
      arguments: [artifact]
    };
  }
}

export class ArtifactTreeProvider implements vscode.TreeDataProvider<ArtifactTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ArtifactTreeItem | undefined | void> = new vscode.EventEmitter<ArtifactTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ArtifactTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private readonly brainWatcher: BrainWatcher) {
    this.brainWatcher.onDidChangeThreads(() => {
      this._onDidChangeTreeData.fire();
    });
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: ArtifactTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(): Promise<ArtifactTreeItem[]> {
    const threads = this.brainWatcher.getThreads();
    const items: ArtifactTreeItem[] = [];

    for (const thread of threads) {
      for (const art of thread.artifacts) {
        items.push(new ArtifactTreeItem(art, thread.title));
      }
    }

    return items;
  }
}
