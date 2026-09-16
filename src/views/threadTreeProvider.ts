import * as vscode from 'vscode';
import { ThreadMeta, ContextLoadLevel } from '../models/thread';
import { BrainWatcher } from '../services/brainWatcher';
import { ArtifactItem } from '../models/artifact';
import { TitleResolver } from '../services/titleResolver';

export type TreeItemType = 'thread' | 'metric' | 'action' | 'artifact' | 'group';

export class ThreadTreeItem extends vscode.TreeItem {
  constructor(
    public readonly itemType: TreeItemType,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly thread?: ThreadMeta,
    public readonly artifact?: ArtifactItem,
    public readonly actionCommand?: string,
    public readonly groupThreads?: ThreadMeta[]
  ) {
    super(label, collapsibleState);
  }
}

function formatRelativeTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) {
      return 'Just now';
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    if (diffHours < 24 && d.getDate() === now.getDate()) {
      return `${diffHours}h ago`;
    }
    if (diffDays === 1 || (diffHours < 48 && d.getDate() === now.getDate() - 1)) {
      return 'Yesterday';
    }
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export class ThreadTreeProvider implements vscode.TreeDataProvider<ThreadTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ThreadTreeItem | undefined | void> = new vscode.EventEmitter<ThreadTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ThreadTreeItem | undefined | void> = this._onDidChangeTreeData.event;
  private searchQuery: string = '';

  constructor(private readonly brainWatcher: BrainWatcher) {
    this.brainWatcher.onDidChangeThreads(() => {
      this.refresh();
    });
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public setSearchFilter(query: string): void {
    this.searchQuery = (query || '').trim();
    this.refresh();
  }

  public clearSearchFilter(): void {
    this.searchQuery = '';
    this.refresh();
  }

  public getSearchFilter(): string {
    return this.searchQuery;
  }

  public getTreeItem(element: ThreadTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: ThreadTreeItem): Promise<ThreadTreeItem[]> {
    if (!element) {
      // Root level: List all threads
      let threads = this.brainWatcher.getThreads();
      if (threads.length === 0) {
        const emptyItem = new ThreadTreeItem('action', 'No Antigravity threads found yet', vscode.TreeItemCollapsibleState.None);
        emptyItem.description = 'Sessions will appear here automatically';
        emptyItem.iconPath = new vscode.ThemeIcon('info');
        return [emptyItem];
      }

      const items: ThreadTreeItem[] = [];

      // If search filter is active
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        const matchedThreads = threads.filter((t) => {
          const titleMatch = (t.title || '').toLowerCase().includes(q);
          const idMatch = (t.id || '').toLowerCase().includes(q);
          const descMatch = TitleResolver.cleanDescription(t.firstPrompt).toLowerCase().includes(q);
          const lastDescMatch = TitleResolver.cleanDescription(t.lastPrompt).toLowerCase().includes(q);
          const artifactMatch = (t.artifacts || []).some((a) => a.name.toLowerCase().includes(q));
          return titleMatch || idMatch || descMatch || lastDescMatch || artifactMatch;
        });

        const filterHeader = new ThreadTreeItem(
          'action',
          `🔍 Filter: "${this.searchQuery}" (${matchedThreads.length} found)`,
          vscode.TreeItemCollapsibleState.None
        );
        filterHeader.description = 'Click to clear filter';
        filterHeader.iconPath = new vscode.ThemeIcon('filter-remove');
        filterHeader.command = {
          command: 'threadweaver.clearFilter',
          title: 'Clear Filter'
        };
        items.push(filterHeader);

        if (matchedThreads.length === 0) {
          const noMatchItem = new ThreadTreeItem(
            'action',
            'No matching threads or descriptions found',
            vscode.TreeItemCollapsibleState.None
          );
          noMatchItem.description = 'Click to clear filter';
          noMatchItem.iconPath = new vscode.ThemeIcon('search-stop');
          noMatchItem.command = {
            command: 'threadweaver.clearFilter',
            title: 'Clear Filter'
          };
          items.push(noMatchItem);
          return items;
        }

        items.push(...matchedThreads.map((t) => this.createThreadTreeItem(t)));
        return items;
      }

      // Timeframe grouping for long-term scalability (500 - 1000+ threads)
      const groupByTimeframe = vscode.workspace.getConfiguration('threadweaver').get<boolean>('groupByTimeframe', true);
      if (groupByTimeframe && threads.length >= 6) {
        return this.createTimeframeGroups(threads);
      }

      return threads.map((t) => this.createThreadTreeItem(t));
    }

    // Children of a Group (Section)
    if (element.itemType === 'group' && element.groupThreads) {
      return element.groupThreads.map((t) => this.createThreadTreeItem(t));
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

      // 0b. Workspace Info Item
      if (t.workspace) {
        const ws = t.workspace;
        const wsItem = new ThreadTreeItem(
          'action',
          `Workspace: ${ws.name || 'Workspace'}`,
          vscode.TreeItemCollapsibleState.None,
          t
        );
        wsItem.description = ws.isCurrent ? '🟢 Active Workspace' : (ws.path ? ws.path : 'External');
        wsItem.iconPath = new vscode.ThemeIcon(
          ws.isCurrent ? 'folder-active' : 'folder',
          new vscode.ThemeColor(ws.themeColor || 'charts.blue')
        );
        wsItem.tooltip = new vscode.MarkdownString(
          `**Workspace:** \`${ws.name}\`\n\n` +
          `- **Path:** \`${ws.path || 'N/A'}\`\n` +
          `- **Status:** ${ws.isCurrent ? '🟢 Active / Current Workspace' : '🌐 External Workspace'}\n` +
          (ws.corpus ? `- **Repository/Corpus:** \`${ws.corpus}\`\n` : '') +
          `\n*Click to open workspace in new window*`
        );
        if (ws.path) {
          wsItem.command = {
            command: 'threadweaver.openWorkspaceFolder',
            title: 'Open Workspace in New Window',
            arguments: [ws.path]
          };
        }
        items.push(wsItem);
      }

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

  private createTimeframeGroups(threads: ThreadMeta[]): ThreadTreeItem[] {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOfPast7Days = startOfToday - 7 * 24 * 60 * 60 * 1000;
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const pinned: ThreadMeta[] = [];
    const today: ThreadMeta[] = [];
    const yesterday: ThreadMeta[] = [];
    const past7Days: ThreadMeta[] = [];
    const earlierMonth: ThreadMeta[] = [];
    const older: ThreadMeta[] = [];

    for (const t of threads) {
      if (t.pinned) {
        pinned.push(t);
        continue;
      }

      const tTime = new Date(t.updatedAt).getTime();
      if (tTime >= startOfToday) {
        today.push(t);
      } else if (tTime >= startOfYesterday) {
        yesterday.push(t);
      } else if (tTime >= startOfPast7Days) {
        past7Days.push(t);
      } else if (tTime >= startOfThisMonth) {
        earlierMonth.push(t);
      } else {
        older.push(t);
      }
    }

    const groupItems: ThreadTreeItem[] = [];

    const addGroup = (
      name: string,
      items: ThreadMeta[],
      icon: string,
      expanded: boolean
    ) => {
      if (items.length === 0) {
        return;
      }
      const groupItem = new ThreadTreeItem(
        'group',
        name,
        expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        undefined,
        undefined,
        items
      );
      groupItem.description = `${items.length} thread${items.length === 1 ? '' : 's'}`;
      groupItem.iconPath = new vscode.ThemeIcon(icon);
      groupItem.contextValue = 'threadGroup';
      groupItems.push(groupItem);
    };

    addGroup('📌 Pinned', pinned, 'pinned', true);
    addGroup('⚡ Today', today, 'history', true);
    addGroup('🗓️ Yesterday', yesterday, 'calendar', false);
    addGroup('📅 Past 7 Days', past7Days, 'calendar', false);
    addGroup('🗓️ Earlier This Month', earlierMonth, 'calendar', false);
    addGroup('📦 Older Sessions', older, 'archive', false);

    return groupItems;
  }

  private createThreadTreeItem(thread: ThreadMeta): ThreadTreeItem {
    const item = new ThreadTreeItem(
      'thread',
      thread.title,
      vscode.TreeItemCollapsibleState.Collapsed,
      thread
    );

    // Sidebar description showing workspace tag, relative timestamp, context size and steps
    const pinBadge = thread.pinned ? '📌 ' : '';
    const ws = thread.workspace;
    let wsTag = '';
    if (ws && ws.name) {
      wsTag = ws.isCurrent ? `[${ws.name}] ` : `[${ws.name}] `;
    }

    const relTime = formatRelativeTime(thread.updatedAt);
    const timeStr = relTime ? `${relTime} • ` : '';

    item.description = `${pinBadge}${wsTag}${timeStr}~${thread.metrics.tokenFormatted} tokens • ${thread.metrics.stepCount} steps`;

    // Tooltip with comprehensive thread details
    const cleanDesc = TitleResolver.cleanDescription(thread.firstPrompt);
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`### ${thread.title}\n\n`);
    if (cleanDesc) {
      tooltip.appendMarkdown(`> **Initial Request / Description:**\n> ${cleanDesc}\n\n`);
    }
    if (ws) {
      tooltip.appendMarkdown(`- **🏢 Workspace:** \`${ws.name}\` (${ws.isCurrent ? '🟢 Current Workspace' : '🌐 External Workspace'})\n`);
      if (ws.path) {
        tooltip.appendMarkdown(`- **📍 Workspace Path:** \`${ws.path}\`\n`);
      }
      if (ws.corpus) {
        tooltip.appendMarkdown(`- **🧬 Corpus/Repo:** \`${ws.corpus}\`\n`);
      }
    }
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

    // Status / Workspace Color Icon
    const iconColor = ws?.themeColor ? new vscode.ThemeColor(ws.themeColor) : undefined;

    if (thread.status === 'completed') {
      item.iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    } else if (thread.status === 'active') {
      item.iconPath = new vscode.ThemeIcon('play-circle', iconColor || new vscode.ThemeColor('charts.blue'));
    } else if (thread.status === 'error') {
      item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    } else {
      item.iconPath = ws?.themeColor
        ? new vscode.ThemeIcon(ws.isCurrent ? 'circle-filled' : 'circle-outline', iconColor)
        : this.getHealthIcon(thread.metrics.loadLevel);
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
