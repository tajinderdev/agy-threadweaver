import * as vscode from 'vscode';
import { StorageService } from './services/storageService';
import { BrainWatcher } from './services/brainWatcher';
import { ZipService } from './services/zipService';
import { ContextDistiller } from './services/distiller';
import { TitleResolver } from './services/titleResolver';
import { ThreadTreeProvider, ThreadTreeItem } from './views/threadTreeProvider';
import { ThreadDetailPanel } from './views/webviews/threadDetailPanel';
import { ThreadMeta } from './models/thread';
import { ArtifactItem } from './models/artifact';
import { ApiServer } from './api/server';

let statusBarItem: vscode.StatusBarItem;
let apiServer: ApiServer | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log('[ThreadWeaver] Activating Antigravity Thread History Extension...');

  const storageService = new StorageService(context);
  const brainWatcher = new BrainWatcher(context, storageService);
  
  apiServer = new ApiServer(context, brainWatcher);
  apiServer.start().catch(err => {
    console.error('[ThreadWeaver API] Failed to start API Server:', err);
  });

  const threadTreeProvider = new ThreadTreeProvider(brainWatcher);

  // Register Tree Views in Sidebar (Dedicated Container & Explorer) with live badges and counts
  const mainTreeView = vscode.window.createTreeView('threadweaver-threads', {
    treeDataProvider: threadTreeProvider,
    showCollapseAll: true
  });
  const explorerTreeView = vscode.window.createTreeView('threadweaver-threads-explorer', {
    treeDataProvider: threadTreeProvider,
    showCollapseAll: true
  });

  const updateTreeBadges = () => {
    const allThreads = brainWatcher.getThreads();
    const count = allThreads.length;
    const filter = threadTreeProvider.getSearchFilter();

    if (filter) {
      mainTreeView.description = `Filter: "${filter}" (${count} total)`;
    } else {
      mainTreeView.description = `${count} threads`;
    }

    mainTreeView.badge = {
      value: count,
      tooltip: `${count} Antigravity conversation thread(s) indexed`
    };
  };

  brainWatcher.onDidChangeThreads(() => updateTreeBadges());
  threadTreeProvider.onDidChangeTreeData(() => updateTreeBadges());
  context.subscriptions.push(mainTreeView, explorerTreeView);

  // Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'threadweaver.refresh';
  statusBarItem.text = '$(history) ThreadWeaver';
  statusBarItem.tooltip = 'Click to refresh Antigravity thread history';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Real-time Auto-Sync Listener
  brainWatcher.onDidAutoSync(async ({ thread, reason }) => {
    statusBarItem.text = `$(check) Synced: ${thread.title.slice(0, 20)}`;
    statusBarItem.tooltip = `Auto-synced: ${reason} (${thread.metrics.tokenFormatted} tokens)`;
    
    // Auto reset status bar after 4 seconds
    setTimeout(() => {
      statusBarItem.text = '$(history) ThreadWeaver';
      statusBarItem.tooltip = 'Click to refresh Antigravity thread history';
    }, 4000);
  });

  // Initial scan
  await brainWatcher.refresh();

  // Helper to extract thread from command invocation
  const resolveTargetThread = async (item?: ThreadTreeItem | ThreadMeta): Promise<ThreadMeta | undefined> => {
    if (item && 'id' in item && typeof (item as ThreadMeta).id === 'string' && 'metrics' in item) {
      return item as ThreadMeta;
    }
    if (item && 'thread' in item && item.thread) {
      return item.thread;
    }

    const threads = brainWatcher.getThreads();
    if (threads.length === 0) {
      vscode.window.showWarningMessage('No Antigravity threads found.');
      return undefined;
    }

    const pick = await vscode.window.showQuickPick(
      threads.map((t) => ({
        label: `${t.pinned ? '📌 ' : ''}${t.title}`,
        description: `~${t.metrics.tokenFormatted} tokens • ${t.metrics.stepCount} steps`,
        detail: `ID: ${t.id} | Last active: ${new Date(t.updatedAt).toLocaleString()}`,
        thread: t
      })),
      { placeHolder: 'Select an Antigravity Thread' }
    );

    return pick ? pick.thread : undefined;
  };

  // 0. Command: Focus Sidebar View
  const focusCmd = vscode.commands.registerCommand('threadweaver.focus', async () => {
    try {
      await vscode.commands.executeCommand('threadweaver-threads.focus');
    } catch {
      try {
        await vscode.commands.executeCommand('workbench.view.extension.threadweaver-container');
      } catch (err) {
        vscode.window.showErrorMessage('Could not focus ThreadWeaver view');
      }
    }
  });

  // 0b. Command: View Thread Details & Analytics Webview
  const viewThreadDetailsCmd = vscode.commands.registerCommand(
    'threadweaver.viewThreadDetails',
    async (item?: ThreadTreeItem | ThreadMeta) => {
      const thread = await resolveTargetThread(item);
      if (!thread) {
        return;
      }
      await ThreadDetailPanel.render(context.extensionUri, thread, brainWatcher, storageService);
    }
  );

  // 1. Command: Refresh
  const refreshCmd = vscode.commands.registerCommand('threadweaver.refresh', async () => {
    statusBarItem.text = '$(sync~spin) Scanning Threads...';
    const threads = await brainWatcher.refresh();
    statusBarItem.text = '$(history) ThreadWeaver';
    vscode.window.showInformationMessage(`ThreadWeaver: Indexed ${threads.length} conversation thread(s).`);
  });

  // 2. Command: Export Thread as Zip
  const exportZipCmd = vscode.commands.registerCommand(
    'threadweaver.exportZip',
    async (item?: ThreadTreeItem | ThreadMeta) => {
      const thread = await resolveTargetThread(item);
      if (!thread) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Exporting Thread "${thread.title}" as Zip bundle...`,
          cancellable: false
        },
        async () => {
          try {
            const transcript = await brainWatcher.loadTranscript(thread.id);
            const savedPath = await ZipService.exportThread(
              thread,
              brainWatcher.getPrimaryBrainDirectory(),
              transcript
            );

            if (savedPath) {
              const openFolder = 'Show in File Manager';
              const selection = await vscode.window.showInformationMessage(
                `Thread exported successfully! (${thread.artifacts.length} artifacts included)`,
                openFolder
              );
              if (selection === openFolder) {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(savedPath));
              }
            }
          } catch (err: any) {
            vscode.window.showErrorMessage(`Export failed: ${err?.message || err}`);
          }
        }
      );
    }
  );

  // 3. Command: Import Thread from Zip
  const importZipCmd = vscode.commands.registerCommand('threadweaver.importZip', async () => {
    try {
      const brainDir = brainWatcher.getPrimaryBrainDirectory();
      const importedThreadId = await ZipService.importThread(brainDir);

      if (importedThreadId) {
        await brainWatcher.refresh();
        const thread = brainWatcher.getThread(importedThreadId);
        const viewBtn = 'View in Sidebar';
        const choice = await vscode.window.showInformationMessage(
          `Thread "${thread?.title || importedThreadId}" successfully imported!`,
          viewBtn
        );

        if (choice === viewBtn) {
          vscode.commands.executeCommand('threadweaver-threads.focus');
        }
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Import failed: ${err?.message || err}`);
    }
  });

  // 4. Command: Resume / Switch to Thread
  const resumeThreadCmd = vscode.commands.registerCommand(
    'threadweaver.resumeThread',
    async (item?: ThreadTreeItem | ThreadMeta) => {
      const thread = await resolveTargetThread(item);
      if (!thread) {
        return;
      }

      // Since native resuming isn't supported by the AI extension without a public API,
      // fallback to executing the fork command to prepare context for a new thread.
      vscode.commands.executeCommand('threadweaver.forkFreshThread', item);
    }
  );

  // 5. Command: Fork Context into Fresh Thread
  const forkFreshThreadCmd = vscode.commands.registerCommand(
    'threadweaver.forkFreshThread',
    async (item?: ThreadTreeItem | ThreadMeta) => {
      const thread = await resolveTargetThread(item);
      if (!thread) {
        return;
      }

      try {
        const transcript = await brainWatcher.loadTranscript(thread.id);
        const briefing = ContextDistiller.generateBriefing(thread, transcript);

        // 1. Save the briefing to a physical markdown file in the workspace
        let saveUri: vscode.Uri;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          saveUri = vscode.Uri.joinPath(workspaceFolders[0].uri, `context_${thread.id.substring(0, 8)}.md`);
        } else {
          // Fallback to a global temp directory if no workspace is open
          const os = require('os');
          const path = require('path');
          saveUri = vscode.Uri.file(path.join(os.tmpdir(), `context_${thread.id.substring(0, 8)}.md`));
        }

        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(saveUri, encoder.encode(briefing));

        // 2. Open the newly saved file so the user can see it
        const doc = await vscode.workspace.openTextDocument(saveUri);
        await vscode.window.showTextDocument(doc, { preview: true });

        // 3. Prepare the prompt and copy it to the clipboard
        const prompt = `Please review @${saveUri.path.split('/').pop()} and gather knowledge of the previous task and its artifacts. Then let's start fresh and continue where the previous thread left off.`;
        await vscode.env.clipboard.writeText(prompt);

        vscode.window.showInformationMessage(
          `Context saved to ${saveUri.path.split('/').pop()}! A starter prompt has been copied to your clipboard. Start a new chat and paste it!`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to distill thread context: ${err?.message || err}`);
      }
    }
  );

  // 5b. Command: Open Workspace Folder
  const openWorkspaceCmd = vscode.commands.registerCommand(
    'threadweaver.openWorkspaceFolder',
    async (workspacePath?: string) => {
      if (!workspacePath) {
        return;
      }
      try {
        const uri = vscode.Uri.file(workspacePath);
        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Could not open workspace folder: ${err?.message || err}`);
      }
    }
  );

  // 6. Command: Open Artifact
  const openArtifactCmd = vscode.commands.registerCommand(
    'threadweaver.openArtifact',
    async (artifact?: ArtifactItem) => {
      if (!artifact || !artifact.absolutePath) {
        return;
      }

      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(artifact.absolutePath));
        await vscode.window.showTextDocument(doc);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Could not open artifact: ${err?.message || err}`);
      }
    }
  );

  // 7. Command: Rename Thread Title
  const renameThreadCmd = vscode.commands.registerCommand(
    'threadweaver.renameThread',
    async (item?: ThreadTreeItem) => {
      const thread = item?.thread;
      if (!thread) {
        return;
      }

      const newTitle = await vscode.window.showInputBox({
        prompt: 'Enter a custom title for this conversation thread',
        value: thread.title
      });

      if (newTitle && newTitle.trim()) {
        await storageService.setThreadTitle(thread.id, newTitle.trim());
        await brainWatcher.refresh();
        vscode.window.showInformationMessage(`Thread title updated to: "${newTitle.trim()}"`);
      }
    }
  );

  // 8. Command: Delete / Remove Thread backup
  const deleteThreadCmd = vscode.commands.registerCommand(
    'threadweaver.deleteThread',
    async (item?: ThreadTreeItem) => {
      const thread = item?.thread;
      if (!thread) {
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to remove ThreadWeaver metadata and saved overrides for "${thread.title}"?`,
        { modal: true },
        'Delete'
      );

      if (confirm === 'Delete') {
        await storageService.deleteOverride(thread.id);
        await brainWatcher.refresh();
        vscode.window.showInformationMessage(`Removed thread entry from ThreadWeaver.`);
      }
    }
  );

  // 9. Command: Search & Filter Threads (by Title, Description Line, Prompts, IDs, Artifacts)
  const searchThreadsCmd = vscode.commands.registerCommand(
    'threadweaver.searchThreads',
    async () => {
      const threads = brainWatcher.getThreads();
      if (threads.length === 0) {
        vscode.window.showInformationMessage('No Antigravity threads found to search.');
        return;
      }

      interface ThreadQuickPickItem extends vscode.QuickPickItem {
        thread?: ThreadMeta;
        isAction?: boolean;
        action?: () => Promise<void>;
      }

      const quickPick = vscode.window.createQuickPick<ThreadQuickPickItem>();
      quickPick.placeholder = 'Search threads by Title, Description line, Prompt, ID, or Artifact...';
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;

      const populateItems = (filterQuery: string) => {
        const q = filterQuery.toLowerCase().trim();
        const items: ThreadQuickPickItem[] = [];

        if (q) {
          // Option to apply filter directly to the sidebar tree view
          items.push({
            label: `$(filter) Filter sidebar tree by: "${filterQuery}"`,
            description: 'Apply this filter persistently in the sidebar view',
            alwaysShow: true,
            isAction: true,
            action: async () => {
              threadTreeProvider.setSearchFilter(filterQuery);
              vscode.window.showInformationMessage(`Sidebar filtered by "${filterQuery}".`);
            }
          });
        }

        const filtered = threads.filter((t) => {
          if (!q) {
            return true;
          }
          const titleMatch = (t.title || '').toLowerCase().includes(q);
          const idMatch = (t.id || '').toLowerCase().includes(q);
          const descMatch = TitleResolver.cleanDescription(t.firstPrompt).toLowerCase().includes(q);
          const lastDescMatch = TitleResolver.cleanDescription(t.lastPrompt).toLowerCase().includes(q);
          const artifactMatch = (t.artifacts || []).some((a) => a.name.toLowerCase().includes(q));
          return titleMatch || idMatch || descMatch || lastDescMatch || artifactMatch;
        });

        for (const t of filtered) {
          const pinBadge = t.pinned ? '$(pin) ' : '';
          const descLine = TitleResolver.cleanDescription(t.firstPrompt);
          const detailText = descLine ? `📝 ${descLine}` : `ID: ${t.id} • ${t.artifacts.length} artifact(s)`;

          items.push({
            label: `${pinBadge}${t.title}`,
            description: `~${t.metrics.tokenFormatted} tokens • ${t.metrics.stepCount} steps • ${new Date(t.updatedAt).toLocaleDateString()}`,
            detail: detailText,
            thread: t
          });
        }

        quickPick.items = items;
      };

      populateItems('');

      quickPick.onDidChangeValue((val) => {
        populateItems(val);
      });

      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        quickPick.hide();
        if (!selected) {
          return;
        }

        if (selected.isAction && selected.action) {
          await selected.action();
          return;
        }

        if (selected.thread) {
          const t = selected.thread;
          const action = await vscode.window.showQuickPick(
            [
              {
                label: '$(dashboard) View Analytics & Timeline',
                description: 'Open full thread dashboard & message breakdown',
                action: 'details'
              },
              {
                label: '$(git-branch) Fork into Fresh Thread',
                description: 'Distill context and copy continuation prompt',
                action: 'fork'
              },
              {
                label: '$(archive) Export as Zip Archive',
                description: 'Save thread transcript and all artifacts',
                action: 'export'
              },
              {
                label: '$(filter) Filter Sidebar for this Thread',
                description: `Show only "${t.title}" in sidebar`,
                action: 'filter'
              }
            ],
            {
              placeHolder: `Action for "${t.title}"`
            }
          );

          if (action?.action === 'details') {
            await ThreadDetailPanel.render(context.extensionUri, t, brainWatcher, storageService);
          } else if (action?.action === 'fork') {
            await vscode.commands.executeCommand('threadweaver.forkFreshThread', t);
          } else if (action?.action === 'export') {
            await vscode.commands.executeCommand('threadweaver.exportZip', t);
          } else if (action?.action === 'filter') {
            threadTreeProvider.setSearchFilter(t.title);
          }
        }
      });

      quickPick.show();
    }
  );

  // 10. Command: Clear Filter
  const clearFilterCmd = vscode.commands.registerCommand(
    'threadweaver.clearFilter',
    async () => {
      threadTreeProvider.clearSearchFilter();
      vscode.window.showInformationMessage('ThreadWeaver: Filter cleared.');
    }
  );

  // 11. Command: Show API Server Info
  const showApiInfoCmd = vscode.commands.registerCommand(
    'threadweaver.showApiInfo',
    async () => {
      if (!apiServer) {
        vscode.window.showErrorMessage('API Server is not running.');
        return;
      }
      
      const port = apiServer.getPort();
      const token = apiServer.getToken();
      
      const copyTokenBtn = 'Copy Token';
      const openBrowserBtn = 'Open in Browser';
      
      const res = await vscode.window.showInformationMessage(
        `ThreadWeaver API running on http://127.0.0.1:${port}`,
        copyTokenBtn,
        openBrowserBtn
      );
      
      if (res === copyTokenBtn) {
        await vscode.env.clipboard.writeText(token);
        vscode.window.showInformationMessage('API Bearer token copied to clipboard.');
      } else if (res === openBrowserBtn) {
        vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}/api/v1/workspaces`));
      }
    }
  );

  context.subscriptions.push(
    focusCmd,
    viewThreadDetailsCmd,
    refreshCmd,
    searchThreadsCmd,
    clearFilterCmd,
    exportZipCmd,
    importZipCmd,
    resumeThreadCmd,
    forkFreshThreadCmd,
    openWorkspaceCmd,
    openArtifactCmd,
    renameThreadCmd,
    deleteThreadCmd,
    showApiInfoCmd,
    {
      dispose: () => brainWatcher.dispose()
    },
    {
      dispose: () => {
        if (apiServer) {
          apiServer.stop();
        }
      }
    }
  );

  console.log('[ThreadWeaver] Activated successfully.');
}

export function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
  if (apiServer) {
    apiServer.stop();
  }
}
