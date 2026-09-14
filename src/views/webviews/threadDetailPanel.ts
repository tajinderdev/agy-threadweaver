import * as vscode from 'vscode';
import { ThreadMeta, ThreadStep } from '../../models/thread';
import { BrainWatcher } from '../../services/brainWatcher';
import { ZipService } from '../../services/zipService';
import { ContextDistiller } from '../../services/distiller';
import { StorageService } from '../../services/storageService';

export class ThreadDetailPanel {
  public static currentPanel: ThreadDetailPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _thread: ThreadMeta;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    thread: ThreadMeta,
    private readonly brainWatcher: BrainWatcher,
    private readonly storageService: StorageService
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._thread = thread;

    // Set initial HTML content
    this._update();

    // Listen for when panel is closed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'resume':
            vscode.commands.executeCommand('threadweaver.resumeThread', this._thread);
            return;
          case 'export':
            vscode.commands.executeCommand('threadweaver.exportZip', this._thread);
            return;
          case 'fork':
            vscode.commands.executeCommand('threadweaver.forkFreshThread', this._thread);
            return;
          case 'openArtifact':
            if (message.path) {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(message.path));
              await vscode.window.showTextDocument(doc);
            }
            return;
          case 'rename':
            vscode.commands.executeCommand('threadweaver.renameThread', { thread: this._thread });
            return;
          case 'togglePin':
            await this.storageService.togglePin(this._thread.id);
            await this.brainWatcher.refresh();
            const updated = this.brainWatcher.getThread(this._thread.id);
            if (updated) {
              this._thread = updated;
              this._update();
            }
            return;
          case 'refresh':
            await this.brainWatcher.refresh();
            const refreshed = this.brainWatcher.getThread(this._thread.id);
            if (refreshed) {
              this._thread = refreshed;
              this._update();
            }
            return;
        }
      },
      null,
      this._disposables
    );
  }

  public static async render(
    extensionUri: vscode.Uri,
    thread: ThreadMeta,
    brainWatcher: BrainWatcher,
    storageService: StorageService
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ThreadDetailPanel.currentPanel) {
      ThreadDetailPanel.currentPanel._thread = thread;
      ThreadDetailPanel.currentPanel._panel.reveal(column);
      await ThreadDetailPanel.currentPanel._update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'threadweaverDetail',
      `Thread: ${thread.title}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    ThreadDetailPanel.currentPanel = new ThreadDetailPanel(
      panel,
      extensionUri,
      thread,
      brainWatcher,
      storageService
    );
  }

  private async _update() {
    this._panel.title = `Thread: ${this._thread.title}`;
    const steps = await this.brainWatcher.loadTranscript(this._thread.id);
    this._panel.webview.html = this._getHtmlForWebview(steps);
  }

  private _getHtmlForWebview(steps: ThreadStep[]): string {
    const t = this._thread;
    const m = t.metrics;

    // Load progress bar color
    let barColor = 'var(--vscode-charts-green, #4caf50)';
    if (m.loadLevel === 'heavy') {
      barColor = 'var(--vscode-charts-red, #f44336)';
    } else if (m.loadLevel === 'moderate') {
      barColor = 'var(--vscode-charts-yellow, #ff9800)';
    }

    // Artifacts HTML
    const artifactsHtml = t.artifacts.length === 0
      ? '<p class="empty-state">No artifacts recorded in this session.</p>'
      : t.artifacts.map((a) => `
        <div class="artifact-card" onclick="postAction('openArtifact', { path: '${this.escapeJs(a.absolutePath)}' })">
          <div class="artifact-icon">📄</div>
          <div class="artifact-info">
            <div class="artifact-name">${this.escapeHtml(a.name)}</div>
            <div class="artifact-meta">${a.sizeFormatted} • ${a.type.toUpperCase()} ${a.isScratch ? '• (scratch)' : ''}</div>
          </div>
          <button class="small-btn">Open</button>
        </div>
      `).join('');

    // Transcript steps HTML
    const stepsHtml = steps.length === 0
      ? '<p class="empty-state">No conversation steps available in transcript.</p>'
      : steps.map((s, idx) => {
        const isUser = s.type === 'USER_INPUT';
        const role = isUser ? 'User' : 'Assistant';
        const time = s.created_at ? new Date(s.created_at).toLocaleTimeString() : '';

        let content = s.content || '';
        if (isUser) {
          content = content.replace(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/gi, '$1').trim();
        }

        let thinkingHtml = '';
        if (s.thinking) {
          thinkingHtml = `
            <details class="thinking-box">
              <summary>🧠 Model Reasoning</summary>
              <pre>${this.escapeHtml(s.thinking)}</pre>
            </details>
          `;
        }

        let toolsHtml = '';
        if (s.tool_calls && s.tool_calls.length > 0) {
          toolsHtml = `
            <div class="tools-box">
              <span class="tools-title">🛠️ Tools Used:</span>
              ${s.tool_calls.map((tc) => `<span class="tool-tag">${this.escapeHtml(tc.tool || tc.name || 'tool')}</span>`).join('')}
            </div>
          `;
        }

        return `
          <div class="step-card ${isUser ? 'user-card' : 'assistant-card'}">
            <div class="step-header">
              <span class="step-role">${isUser ? '👤' : '🤖'} ${role} (Step #${s.step_index ?? idx})</span>
              <span class="step-time">${time} ${s.status ? `• <code>${s.status}</code>` : ''}</span>
            </div>
            ${thinkingHtml}
            <div class="step-content">${this.formatContent(content)}</div>
            ${toolsHtml}
          </div>
        `;
      }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(t.title)}</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --card-bg: var(--vscode-sideBar-background);
      --border: var(--vscode-widget-border, #333);
      --accent: var(--vscode-button-background, #007acc);
      --accent-hover: var(--vscode-button-hoverBackground, #0062a3);
      --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--fg);
      padding: 24px;
      margin: 0;
      line-height: 1.5;
    }
    .header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 18px;
      margin-bottom: 20px;
    }
    .title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    h1 {
      font-size: 22px;
      margin: 0;
      font-weight: 600;
    }
    .badges {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      text-transform: uppercase;
      font-weight: 500;
    }
    .badge-status {
      background: ${t.status === 'completed' ? '#1b5e20' : t.status === 'active' ? '#0d47a1' : '#37474f'};
      color: #fff;
    }
    .actions-bar {
      display: flex;
      gap: 10px;
      margin-top: 14px;
      flex-wrap: wrap;
    }
    button {
      background: var(--accent);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      padding: 8px 14px;
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    button:hover {
      background: var(--accent-hover);
    }
    button.secondary {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--fg);
    }
    button.secondary:hover {
      background: var(--border);
    }
    .small-btn {
      padding: 4px 10px;
      font-size: 12px;
    }
    /* Context Load Meter */
    .meter-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .meter-header {
      display: flex;
      justify-content: space-between;
      font-weight: 500;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .progress-bar-bg {
      background: rgba(128,128,128,0.2);
      border-radius: 10px;
      height: 10px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: ${barColor};
      width: ${m.percentageOfLimit}%;
      transition: width 0.3s;
    }
    .meter-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 12px;
      margin-top: 14px;
      font-size: 12px;
    }
    .stat-box {
      background: rgba(0,0,0,0.1);
      padding: 8px 12px;
      border-radius: 4px;
      border: 1px solid rgba(128,128,128,0.15);
    }
    .stat-label {
      opacity: 0.7;
      margin-bottom: 2px;
    }
    .stat-val {
      font-size: 15px;
      font-weight: 600;
    }
    /* Sections */
    .section-title {
      font-size: 16px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    /* Artifacts */
    .artifacts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .artifact-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .artifact-card:hover {
      border-color: var(--accent);
    }
    .artifact-icon {
      font-size: 22px;
    }
    .artifact-info {
      flex: 1;
      overflow: hidden;
    }
    .artifact-name {
      font-weight: 500;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .artifact-meta {
      font-size: 11px;
      opacity: 0.7;
    }
    /* Transcript */
    .timeline {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .step-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
    }
    .user-card {
      border-left: 4px solid var(--accent);
    }
    .assistant-card {
      border-left: 4px solid #9c27b0;
    }
    .step-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      font-size: 12px;
      opacity: 0.8;
    }
    .step-role {
      font-weight: 600;
      font-size: 13px;
    }
    .step-content {
      font-size: 13.5px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .thinking-box {
      margin: 10px 0;
      padding: 8px 12px;
      background: rgba(0,0,0,0.15);
      border-radius: 4px;
      font-size: 12px;
    }
    .thinking-box summary {
      cursor: pointer;
      opacity: 0.8;
      font-weight: 500;
    }
    .thinking-box pre {
      white-space: pre-wrap;
      margin: 8px 0 0 0;
      font-family: monospace;
      max-height: 200px;
      overflow-y: auto;
    }
    .tools-box {
      margin-top: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      font-size: 12px;
    }
    .tool-tag {
      background: rgba(128,128,128,0.2);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 11px;
    }
    .empty-state {
      opacity: 0.6;
      font-style: italic;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-row">
      <h1>${this.escapeHtml(t.title)}</h1>
      <button class="secondary small-btn" onclick="postAction('rename')">✏️ Rename</button>
    </div>
    <div class="badges">
      <span class="badge badge-status">${t.status}</span>
      <span class="badge">ID: ${t.id}</span>
      <span class="badge">Created: ${new Date(t.createdAt).toLocaleDateString()}</span>
      <span class="badge">${t.pinned ? '📌 Pinned' : 'Normal'}</span>
    </div>
    <div class="actions-bar">
      <button onclick="postAction('fork')">🚀 Weave into Fresh Thread (Distilled Context)</button>
      <button class="secondary" onclick="postAction('export')">📦 Export as Zip</button>
      <button class="secondary" onclick="postAction('resume')">🔗 Resume in Chat</button>
      <button class="secondary" onclick="postAction('togglePin')">${t.pinned ? 'Unpin' : '📌 Pin'}</button>
      <button class="secondary" onclick="postAction('refresh')">🔄 Refresh</button>
    </div>
  </div>

  <!-- Context Window Load Meter -->
  <div class="meter-card">
    <div class="meter-header">
      <span>Context Window Load: ~${m.tokenFormatted} tokens (${m.percentageOfLimit}% of ${this.formatNumber(vscode.workspace.getConfiguration('threadweaver').get<number>('contextLimitThreshold', 100000))} threshold)</span>
      <span style="color:${barColor}; font-weight:700;">${m.loadLevel.toUpperCase()}</span>
    </div>
    <div class="progress-bar-bg">
      <div class="progress-bar-fill"></div>
    </div>
    <div class="meter-stats">
      <div class="stat-box">
        <div class="stat-label">Total Steps</div>
        <div class="stat-val">${m.stepCount}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Messages</div>
        <div class="stat-val">${m.messageCount}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Byte Size</div>
        <div class="stat-val">${m.byteSizeFormatted}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Artifacts</div>
        <div class="stat-val">${t.artifacts.length}</div>
      </div>
    </div>
  </div>

  <!-- Artifacts Explorer -->
  <div class="section-title">📂 Attached Artifacts (${t.artifacts.length})</div>
  <div class="artifacts-grid">
    ${artifactsHtml}
  </div>

  <!-- Full Conversation Timeline -->
  <div class="section-title">💬 Conversation Transcript (${steps.length} Steps)</div>
  <div class="timeline">
    ${stepsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function postAction(command, payload = {}) {
      vscode.postMessage({ command, ...payload });
    }
  </script>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private escapeJs(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  private formatContent(str: string): string {
    return this.escapeHtml(str);
  }

  private formatNumber(num: number): string {
    if (num >= 1000) {
      return `${(num / 1000).toFixed(0)}k`;
    }
    return num.toString();
  }

  public dispose() {
    ThreadDetailPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}
