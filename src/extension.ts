import * as vscode from 'vscode';
import { StorageService } from './services/storageService';
import { BrainWatcher } from './services/brainWatcher';
import { ZipService } from './services/zipService';
import { ContextDistiller } from './services/distiller';
import { ThreadTreeProvider, ThreadTreeItem } from './views/threadTreeProvider';
import { ThreadDetailPanel } from './views/webviews/threadDetailPanel';
import { ThreadMeta } from './models/thread';
import { ArtifactItem } from './models/artifact';

let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  console.log('[ThreadWeaver] Activating Antigravity Thread History Extension...');

  const storageService = new StorageService(context);
  const brainWatcher = new BrainWatcher(context, storageService);

  const threadTreeProvider = new ThreadTreeProvider(brainWatcher);

  // Register Tree Views in Sidebar (Dedicated Container & Explorer)
  vscode.window.registerTreeDataProvider('threadweaver-threads', threadTreeProvider);
  vscode.window.registerTreeDataProvider('threadweaver-threads-explorer', threadTreeProvider);

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
    } catch (err) {
      vscode.window.showErrorMessage('Could not focus ThreadWeaver view');
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

        // Copy to clipboard
        await vscode.env.clipboard.writeText(briefing);

        // Open briefing in an untitled markdown editor document for immediate preview and editing
        const doc = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: briefing
        });
        await vscode.window.showTextDocument(doc, { preview: true });

        vscode.window.showInformationMessage(
          `🚀 Distilled Context Briefing copied to clipboard! Paste it into a new Antigravity chat to continue with a clean context window.`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to distill thread context: ${err?.message || err}`);
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

  context.subscriptions.push(
    focusCmd,
    viewThreadDetailsCmd,
    refreshCmd,
    exportZipCmd,
    importZipCmd,
    resumeThreadCmd,
    forkFreshThreadCmd,
    openArtifactCmd,
    renameThreadCmd,
    deleteThreadCmd,
    {
      dispose: () => brainWatcher.dispose()
    }
  );

  console.log('[ThreadWeaver] Activated successfully.');
}

export function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
