import * as vscode from 'vscode';
import { ThreadMeta, ContextLoadLevel } from '../models/thread';
import { BrainWatcher } from '../services/brainWatcher';
import { ArtifactItem } from '../models/artifact';

export type TreeItemType = 'thread' | 'metric' | 'action' | 'artifact';

export class ThreadTreeItem extends vscode.TreeItem {
  constructor(
    public readonly itemType: TreeItemType,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly thread?: ThreadMeta,
    public readonly artifact?: ArtifactItem,
    public readonly actionCommand?: string
  ) {
    super(label, collapsibleState);
  }
}

export class ThreadTreeProvider implements vscode.TreeDataProvider<ThreadTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ThreadTreeItem | undefined | void> = new vscode.EventEmitter<ThreadTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ThreadTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private readonly brainWatcher: BrainWatcher) {
    this.brainWatcher.onDidChangeThreads(() => {
      this.refresh();
    });
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: ThreadTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: ThreadTreeItem): Promise<ThreadTreeItem[]> {
    if (!element) {
      // Root level: List all threads
      const threads = this.brainWatcher.getThreads();
      if (threads.length === 0) {
        const emptyItem = new ThreadTreeItem('action', 'No Antigravity threads found yet', vscode.TreeItemCollapsibleState.None);
        emptyItem.description = 'Sessions will appear here automatically';
        emptyItem.iconPath = new vscode.ThemeIcon('info');
        return [emptyItem];
      }

      return threads.map((t) => this.createThreadTreeItem(t));
    }

    // Children of a thread
    if (element.itemType === 'thread' && element.thread) {
      const t = element.thread;
      const items: ThreadTreeItem[] = [];

      // 0. Action: Open Thread Analytics & Timeline Webview
      const detailItem = new ThreadTreeItem(
        'action',
        '📊 Open Thread Analytics & Timeline',
        vscode.TreeItemCollapsibleState.None,
        t
      );
      detailItem.iconPath = new vscode.ThemeIcon('dashboard');
      detailItem.command = {
        command: 'threadweaver.viewThreadDetails',
        title: 'Open Thread Analytics',
        arguments: [t]
      };
      items.push(detailItem);

      // 1. Context Size & Health Metric item
      const metricItem = new ThreadTreeItem(
        'metric',
        `Context: ~${t.metrics.tokenFormatted} tokens (${t.metrics.percentageOfLimit}% load)`,
        vscode.TreeItemCollapsibleState.None,
        t
      );
      metricItem.description = `${t.metrics.byteSizeFormatted} • ${t.metrics.stepCount} steps`;
      metricItem.iconPath = this.getHealthIcon(t.metrics.loadLevel);
      items.push(metricItem);

      // 2. Action: Resume / Switch
      const resumeItem = new ThreadTreeItem(
        'action',
        'Resume / Switch to Thread',
        vscode.TreeItemCollapsibleState.None,
        t
      );
      resumeItem.iconPath = new vscode.ThemeIcon('link-external');
      resumeItem.command = {
        command: 'threadweaver.resumeThread',
        title: 'Resume Thread',
        arguments: [t]
      };
      items.push(resumeItem);

      // 3. Action: Fork with Distilled Context
      const forkItem = new ThreadTreeItem(
        'action',
        'Weave into Fresh Thread (Briefing)',
        vscode.TreeItemCollapsibleState.None,
        t
      );
      forkItem.iconPath = new vscode.ThemeIcon('git-branch');
      forkItem.command = {
        command: 'threadweaver.forkFreshThread',
        title: 'Fork Thread',
        arguments: [t]
      };
      items.push(forkItem);

      // 4. Action: Export Zip
      const exportItem = new ThreadTreeItem(
        'action',
        'Export Thread as Zip Archive',
        vscode.TreeItemCollapsibleState.None,
        t
      );
      exportItem.iconPath = new vscode.ThemeIcon('archive');
      exportItem.command = {
        command: 'threadweaver.exportZip',
        title: 'Export Zip',
        arguments: [t]
      };
      items.push(exportItem);

      // 5. Artifacts sub-items
      if (t.artifacts && t.artifacts.length > 0) {
        for (const art of t.artifacts) {
          const artItem = new ThreadTreeItem(
            'artifact',
            art.name,
            vscode.TreeItemCollapsibleState.None,
            t,
            art
          );
          artItem.description = `${art.sizeFormatted} ${art.isScratch ? '(scratch)' : ''}`;
          artItem.iconPath = new vscode.ThemeIcon(art.type === 'plan' ? 'checklist' : 'file-text');
          artItem.command = {
            command: 'threadweaver.openArtifact',
            title: 'Open Artifact',
            arguments: [art]
          };
          items.push(artItem);
        }
      }

      return items;
    }

    return [];
  }

  private createThreadTreeItem(thread: ThreadMeta): ThreadTreeItem {
    const item = new ThreadTreeItem(
      'thread',
      thread.title,
      vscode.TreeItemCollapsibleState.Collapsed,
      thread
    );

    // Sidebar description showing context window size and steps
    const pinBadge = thread.pinned ? '📌 ' : '';
    item.description = `${pinBadge}~${thread.metrics.tokenFormatted} tokens • ${thread.metrics.stepCount} steps`;

    // Tooltip with comprehensive thread details
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`### ${thread.title}\n\n`);
    tooltip.appendMarkdown(`- **Thread ID:** \`${thread.id}\`\n`);
    tooltip.appendMarkdown(`- **Context Window:** ~${thread.metrics.tokenFormatted} tokens (${thread.metrics.byteSizeFormatted})\n`);
    tooltip.appendMarkdown(`- **Load Level:** **${thread.metrics.loadLevel.toUpperCase()}** (${thread.metrics.percentageOfLimit}% threshold)\n`);
    tooltip.appendMarkdown(`- **Steps / Messages:** ${thread.metrics.stepCount} steps / ${thread.metrics.messageCount} messages\n`);
    tooltip.appendMarkdown(`- **Artifacts:** ${thread.artifacts.length} file(s)\n`);
    tooltip.appendMarkdown(`- **Status:** \`${thread.status}\`\n`);
    tooltip.appendMarkdown(`- **Last Active:** ${new Date(thread.updatedAt).toLocaleString()}\n`);
    item.tooltip = tooltip;

    // Custom viewItem context value for menu actions
    item.contextValue = 'threadItem';

    // Status icon
    if (thread.status === 'completed') {
      item.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    } else if (thread.status === 'active') {
      item.iconPath = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.blue'));
    } else if (thread.status === 'error') {
      item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    } else {
      item.iconPath = this.getHealthIcon(thread.metrics.loadLevel);
    }

    return item;
  }

  private getHealthIcon(level: ContextLoadLevel): vscode.ThemeIcon {
    switch (level) {
      case 'heavy':
        return new vscode.ThemeIcon('flame', new vscode.ThemeColor('editorOverviewRuler.errorForeground'));
      case 'moderate':
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorOverviewRuler.warningForeground'));
      case 'light':
      default:
        return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
    }
  }
}
