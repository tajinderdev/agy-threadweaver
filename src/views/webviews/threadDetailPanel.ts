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
          case 'openWorkspace':
            if (message.path) {
              const wsUri = vscode.Uri.file(message.path);
              await vscode.commands.executeCommand('vscode.openFolder', wsUri, { forceNewWindow: true });
            }
            return;
          case 'copyText':
            if (message.text) {
              await vscode.env.clipboard.writeText(message.text);
              vscode.window.showInformationMessage(message.message || 'Copied to clipboard!');
            }
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
      --border: var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
      --accent: var(--vscode-button-background, #007acc);
      --accent-hover: var(--vscode-button-hoverBackground, #0062a3);
      --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      --font-mono: var(--vscode-editor-font-family, Consolas, 'Courier New', monospace);
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--fg);
      padding: 28px 32px;
      margin: 0;
      font-size: 14px;
      line-height: 1.65;
      letter-spacing: 0.01em;
    }
    .header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 22px;
      margin-bottom: 24px;
    }
    .title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    h1 {
      font-size: 24px;
      margin: 0;
      font-weight: 650;
      line-height: 1.35;
    }
    .badges {
      display: flex;
      gap: 10px;
      margin-top: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .badge {
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 4px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.03em;
    }
    .badge-status {
      background: ${t.status === 'completed' ? '#1b5e20' : t.status === 'active' ? '#0d47a1' : '#37474f'};
      color: #fff;
    }
    .actions-bar {
      display: flex;
      gap: 12px;
      margin-top: 18px;
      flex-wrap: wrap;
    }
    button {
      background: var(--accent);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      padding: 9px 16px;
      border-radius: 5px;
      font-size: 13.5px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      transition: background 0.15s, transform 0.05s;
    }
    button:hover {
      background: var(--accent-hover);
    }
    button:active {
      transform: scale(0.98);
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
      padding: 5px 12px;
      font-size: 12.5px;
    }
    /* Context Load Meter */
    .meter-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 26px;
    }
    .meter-header {
      display: flex;
      justify-content: space-between;
      font-weight: 600;
      margin-bottom: 10px;
      font-size: 14px;
    }
    .progress-bar-bg {
      background: rgba(128,128,128,0.2);
      border-radius: 10px;
      height: 12px;
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
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 14px;
      margin-top: 16px;
      font-size: 13px;
    }
    .stat-box {
      background: rgba(0,0,0,0.12);
      padding: 10px 14px;
      border-radius: 6px;
      border: 1px solid rgba(128,128,128,0.15);
    }
    .stat-label {
      opacity: 0.75;
      font-size: 12px;
      margin-bottom: 4px;
      font-weight: 500;
    }
    .stat-val {
      font-size: 16px;
      font-weight: 650;
    }
    /* Sections */
    .section-title {
      font-size: 17px;
      font-weight: 650;
      margin: 28px 0 14px 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    /* Artifacts */
    .artifacts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 14px;
      margin-bottom: 26px;
    }
    .artifact-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 14px;
      cursor: pointer;
      transition: border-color 0.15s, transform 0.1s;
    }
    .artifact-card:hover {
      border-color: var(--accent);
      transform: translateY(-1px);
    }
    .artifact-icon {
      font-size: 24px;
    }
    .artifact-info {
      flex: 1;
      overflow: hidden;
    }
    .artifact-name {
      font-weight: 600;
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 3px;
    }
    .artifact-meta {
      font-size: 12px;
      opacity: 0.75;
    }
    /* Transcript Timeline */
    .timeline {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .step-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
    }
    .user-card {
      border-left: 5px solid var(--accent);
    }
    .assistant-card {
      border-left: 5px solid #9c27b0;
    }
    .step-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
      font-size: 13.5px;
      opacity: 0.85;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(128,128,128,0.12);
    }
    .step-role {
      font-weight: 650;
      font-size: 14px;
    }
    .step-content {
      font-size: 14.5px;
      line-height: 1.7;
      letter-spacing: 0.015em;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .step-content p {
      margin: 8px 0;
    }
    .thinking-box {
      margin: 14px 0;
      padding: 10px 14px;
      background: rgba(0,0,0,0.18);
      border-radius: 6px;
      font-size: 13px;
    }
    .thinking-box summary {
      cursor: pointer;
      opacity: 0.9;
      font-weight: 600;
      font-size: 13.5px;
    }
    .thinking-box pre {
      white-space: pre-wrap;
      margin: 10px 0 0 0;
      font-family: var(--font-mono);
      font-size: 13px;
      line-height: 1.65;
      max-height: 260px;
      overflow-y: auto;
    }
    .tools-box {
      margin-top: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .tool-tag {
      background: rgba(128,128,128,0.22);
      padding: 3px 8px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 500;
    }
    /* Workspace Card */
    .workspace-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px 20px;
      margin-bottom: 24px;
    }
    .ws-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 14px;
    }
    .ws-title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .ws-status-badge {
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 12px;
      font-weight: 600;
      margin-left: 8px;
      display: inline-block;
    }
    .ws-current {
      background: rgba(16, 185, 129, 0.2);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.4);
    }
    .ws-other {
      background: rgba(139, 92, 246, 0.2);
      color: #a78bfa;
      border: 1px solid rgba(139, 92, 246, 0.4);
    }
    .ws-details-grid {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 13.5px;
      background: rgba(0,0,0,0.12);
      padding: 12px 16px;
      border-radius: 6px;
      border: 1px solid rgba(128,128,128,0.15);
    }
    .ws-detail-item {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .ws-detail-label {
      opacity: 0.75;
      font-size: 12.5px;
      font-weight: 500;
      min-width: 140px;
    }
    .ws-path-code {
      font-family: monospace;
      font-size: 12px;
      word-break: break-all;
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
      ${t.workspace ? `
        <span class="badge badge-workspace" style="background: ${t.workspace.bgColor || 'rgba(59,130,246,0.18)'}; border-color: ${t.workspace.borderColor || '#3b82f6'}; color: ${t.workspace.color || '#3b82f6'}; font-weight: 600;">
          📁 ${this.escapeHtml(t.workspace.name || 'Workspace')} ${t.workspace.isCurrent ? '⚡ ACTIVE' : ''}
        </span>
      ` : ''}
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

  <!-- Workspace Details & Relationship Card -->
  ${t.workspace ? `
  <div class="workspace-card" style="border-left: 4px solid ${t.workspace.color || '#3b82f6'};">
    <div class="ws-header">
      <div class="ws-title-group">
        <span style="font-size: 20px;">📁</span>
        <div>
          <span style="font-weight: 600; font-size: 15px; color: ${t.workspace.color || 'inherit'};">${this.escapeHtml(t.workspace.name || 'Workspace')}</span>
          <span class="ws-status-badge ${t.workspace.isCurrent ? 'ws-current' : 'ws-other'}">
            ${t.workspace.isCurrent ? '🟢 Current Window Workspace' : '🌐 External Workspace'}
          </span>
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        ${t.workspace.path ? `
          <button class="secondary small-btn" onclick="postAction('openWorkspace', { path: '${this.escapeJs(t.workspace.path)}' })">
            📂 Open Workspace
          </button>
          <button class="secondary small-btn" onclick="postAction('copyText', { text: '${this.escapeJs(t.workspace.path)}', message: 'Workspace path copied!' })">
            📋 Copy Path
          </button>
        ` : ''}
      </div>
    </div>
    <div class="ws-details-grid">
      ${t.workspace.path ? `
        <div class="ws-detail-item">
          <span class="ws-detail-label">📁 Folder Path:</span>
          <code class="ws-path-code">${this.escapeHtml(t.workspace.path)}</code>
        </div>
      ` : ''}
      ${t.workspace.corpus ? `
        <div class="ws-detail-item">
          <span class="ws-detail-label">🧬 Corpus / Repo:</span>
          <code>${this.escapeHtml(t.workspace.corpus)}</code>
        </div>
      ` : ''}
      ${t.workspace.uri ? `
        <div class="ws-detail-item">
          <span class="ws-detail-label">🔗 URI:</span>
          <code style="font-size: 11px; opacity: 0.75;">${this.escapeHtml(t.workspace.uri)}</code>
        </div>
      ` : ''}
      <div class="ws-detail-item">
        <span class="ws-detail-label">🏷️ Relationship:</span>
        <span>${t.workspace.isCurrent ? 'This thread was conducted in the project currently opened in your active IDE window.' : 'This thread was conducted in a separate project workspace.'}</span>
      </div>
    </div>
  </div>
  ` : ''}

  <!-- Context Window Load Meter -->
  <div class="meter-card">
    <div class="meter-header">
      <span>Context Window Load: ~${m.tokenFormatted} tokens (${m.percentageOfLimit}% of ${this.formatNumber(vscode.workspace.getConfiguration('threadweaver').get<number>('contextLimitThreshold', 2000000))} threshold)</span>
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
