import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { ThreadMeta, ThreadStep, ContextMetrics, ContextLoadLevel, OSSurface } from '../models/thread';
import { ArtifactItem } from '../models/artifact';
import { StorageService } from './storageService';
import { TitleResolver } from './titleResolver';
import { PlatformResolver } from './platformResolver';

export class BrainWatcher {
  private brainDirs: string[] = [];
  /** Maps each brain directory path to the OS surface it came from */
  private brainDirSurface: Map<string, OSSurface> = new Map();
  private threadsCache: Map<string, ThreadMeta> = new Map();
  private fileWatchers: fs.FSWatcher[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  private _onDidChangeThreads = new vscode.EventEmitter<void>();
  public readonly onDidChangeThreads = this._onDidChangeThreads.event;

  private _onDidAutoSync = new vscode.EventEmitter<{ thread: ThreadMeta; reason: string }>();
  public readonly onDidAutoSync = this._onDidAutoSync.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly storageService: StorageService
  ) {
    this.brainDirs = this.resolveAllBrainDirectories();
    this.initWatcher();
  }

  public getPrimaryBrainDirectory(): string {
    return this.brainDirs[0] || path.join(os.homedir(), '.gemini', 'antigravity-ide', 'brain');
  }

  public getBrainDirectories(): string[] {
    return this.brainDirs;
  }

  /**
   * Resolves all possible Antigravity Brain directories across surfaces (IDE, CLI, App).
   * Uses PlatformResolver to detect the current OS surface and return the correct
   * candidate paths. On WSL this bridges to Windows-side paths as well.
   */
  public resolveAllBrainDirectories(): string[] {
    const dirs: string[] = [];
    this.brainDirSurface.clear();

    // 1. User-configured override always takes priority
    const configPath = vscode.workspace.getConfiguration('threadweaver').get<string>('brainPath');
    if (configPath && fs.existsSync(configPath)) {
      dirs.push(configPath);
      this.brainDirSurface.set(configPath, PlatformResolver.detectSurface());
    }

    // 2. Probe all OS-appropriate candidates
    const surface = PlatformResolver.detectSurface();
    const candidatePaths = PlatformResolver.getBrainCandidates(surface);

    for (const p of candidatePaths) {
      if (fs.existsSync(p) && !dirs.includes(p)) {
        dirs.push(p);
        // Determine which sub-surface this path belongs to:
        // If we are on WSL and the path starts with /mnt/, it came from Windows-side
        const pathSurface: OSSurface =
          surface === 'wsl' && p.startsWith('/mnt/') ? 'windows' : surface;
        this.brainDirSurface.set(p, pathSurface);
      }
    }

    // 3. Default fallback if nothing exists yet (keeps the primary IDE path)
    if (dirs.length === 0) {
      const fallback = candidatePaths[0];
      dirs.push(fallback);
      this.brainDirSurface.set(fallback, surface);
    }

    return dirs;
  }

  /**
   * Scans and indexes all conversation threads across all Antigravity brain directories
   */
  public async refresh(): Promise<ThreadMeta[]> {
    this.threadsCache.clear();
    this.brainDirs = this.resolveAllBrainDirectories();

    // 1. Refresh official titles from state.vscdb, annotations, and summaries DB
    try {
      await TitleResolver.refreshTitles(this.context.extensionPath);
    } catch (err) {
      console.warn('[ThreadWeaver] Error fetching title index:', err);
    }

    const overrides = this.storageService.getOverrides();

    // 2. Scan each brain directory
    for (const brainDir of this.brainDirs) {
      if (!fs.existsSync(brainDir)) {
        continue;
      }

      const dirSurface = this.brainDirSurface.get(brainDir) || PlatformResolver.detectSurface();

      try {
        const entries = fs.readdirSync(brainDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }

          const threadId = entry.name;
          // Skip internal/scratch directories
          if (threadId.startsWith('.') || threadId === 'scratch' || threadId === 'node_modules' || threadId === 'tempmediaStorage') {
            continue;
          }

          const threadPath = path.join(brainDir, threadId);
          const threadMeta = await this.parseThreadDirectory(threadId, threadPath, brainDir, overrides[threadId], dirSurface);

          if (threadMeta) {
            // If already indexed from another dir, keep the most recently active
            const existing = this.threadsCache.get(threadId);
            if (!existing || new Date(threadMeta.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
              this.threadsCache.set(threadId, threadMeta);
            }
          }
        }
      } catch (err) {
        console.error(`[ThreadWeaver] Error scanning brain directory ${brainDir}:`, err);
      }
    }

    this._onDidChangeThreads.fire();
    return this.getThreads();
  }

  public getThreads(): ThreadMeta[] {
    const threads = Array.from(this.threadsCache.values());
    // Sort: pinned first, then by updated timestamp descending
    return threads.sort((a, b) => {
      if (a.pinned && !b.pinned) {
        return -1;
      }
      if (!a.pinned && b.pinned) {
        return 1;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }

  public getThread(id: string): ThreadMeta | undefined {
    return this.threadsCache.get(id);
  }

  /**
   * Parses an individual conversation directory
   */
  private async parseThreadDirectory(
    threadId: string,
    threadPath: string,
    brainDir: string,
    override?: { customTitle?: string; pinned?: boolean; archived?: boolean },
    surface?: OSSurface
  ): Promise<ThreadMeta | null> {
    try {
      const stat = fs.statSync(threadPath);
      const logsDir = path.join(threadPath, '.system_generated', 'logs');
      const transcriptFile = path.join(logsDir, 'transcript.jsonl');
      const fullTranscriptFile = path.join(logsDir, 'transcript_full.jsonl');

      const targetFile = fs.existsSync(transcriptFile)
        ? transcriptFile
        : fs.existsSync(fullTranscriptFile)
        ? fullTranscriptFile
        : null;

      let steps: ThreadStep[] = [];
      let totalChars = 0;
      let byteSize = 0;

      if (targetFile && fs.existsSync(targetFile)) {
        const fileStat = fs.statSync(targetFile);
        byteSize += fileStat.size;

        const content = fs.readFileSync(targetFile, 'utf8');
        const lines = content.split('\n').filter((l) => l.trim().length > 0);

        for (const line of lines) {
          try {
            const step = JSON.parse(line) as ThreadStep;
            steps.push(step);
            totalChars += (step.content?.length || 0) + (step.thinking?.length || 0);
          } catch {
            // Ignore malformed lines
          }
        }
      }

      // Collect artifacts in thread directory
      const artifacts: ArtifactItem[] = [];
      this.collectArtifacts(threadPath, threadId, brainDir, artifacts);

      for (const a of artifacts) {
        byteSize += a.sizeBytes;
      }

      // Extract user prompts and assistant responses
      const userInputs = steps.filter((s) => s.type === 'USER_INPUT' && s.content);
      const firstPrompt = userInputs.length > 0 ? userInputs[0].content : undefined;
      const lastPrompt = userInputs.length > 0 ? userInputs[userInputs.length - 1].content : undefined;

      const responses = steps.filter((s) => (s.type === 'PLANNER_RESPONSE' || s.source === 'MODEL') && s.content);
      const lastResponse = responses.length > 0 ? responses[responses.length - 1].content : undefined;

      // 🎯 Exact Real Title Resolution
      let title = override?.customTitle;
      if (!title) {
        // 1. Check TitleResolver index (official Antigravity title from state.vscdb / annotations / summaries)
        const officialTitle = TitleResolver.getCachedTitle(threadId);
        if (officialTitle) {
          title = officialTitle;
        } else if (firstPrompt) {
          // 2. Intelligent cleaned prompt title
          title = TitleResolver.cleanPromptTitle(firstPrompt);
        } else if (artifacts.length > 0) {
          // 3. Artifact name
          title = `Session: ${artifacts[0].name.replace(/\.md$/i, '')}`;
        } else {
          // 4. Default fallback
          title = `Thread ${threadId.slice(0, 8)}`;
        }
      }

      // Context Metrics calculation
      const tokenEstimate = Math.max(Math.round(totalChars / 4), Math.round(byteSize / 4));
      const threshold = vscode.workspace.getConfiguration('threadweaver').get<number>('contextLimitThreshold', 2000000);

      let loadLevel: ContextLoadLevel = 'light';
      if (tokenEstimate > threshold) {
        loadLevel = 'heavy';
      } else if (tokenEstimate > threshold * 0.35) {
        loadLevel = 'moderate';
      }

      const metrics: ContextMetrics = {
        tokenEstimate,
        tokenFormatted: this.formatNumber(tokenEstimate),
        byteSize,
        byteSizeFormatted: this.formatBytes(byteSize),
        stepCount: steps.length,
        messageCount: userInputs.length + responses.length,
        loadLevel,
        percentageOfLimit: Math.min(100, Math.round((tokenEstimate / threshold) * 100))
      };

      // Determine status from the last step
      let status: 'active' | 'completed' | 'error' | 'idle' = 'idle';
      if (steps.length > 0) {
        const lastStep = steps[steps.length - 1];
        if (lastStep.status === 'DONE') {
          status = 'completed';
        } else if (lastStep.status === 'ERROR') {
          status = 'error';
        } else {
          const diffMinutes = (Date.now() - stat.mtimeMs) / (1000 * 60);
          status = diffMinutes < 5 ? 'active' : 'idle';
        }
      }

      // 🏢 Workspace Details Resolution & Deterministic Coloring
      let wsInfo = TitleResolver.getCachedWorkspace(threadId);
      let wsUri = wsInfo?.uri;
      let wsPath = wsInfo?.path;
      let wsName = wsInfo?.name;
      let wsCorpus = wsInfo?.corpus;

      // Fallback: If not found in SQLite/vscdb, parse active workspaces directly from <user_information> block in transcript
      if (!wsPath && steps.length > 0) {
        for (const step of steps) {
          const stepContent = step.content || '';
          const wsMatch = stepContent.match(/The user has \d+ active workspaces[^\n]*\n([\s\S]*?)(?:App Data Directory:|<\/user_information>)/i);
          if (wsMatch && wsMatch[1]) {
            const lines = wsMatch[1].split('\n');
            for (const l of lines) {
              const lineMatch = l.match(/^\s*(.+?)(?:\s*->\s*(.+))?$/);
              if (lineMatch && lineMatch[1]) {
                const candidatePath = lineMatch[1].trim();
                // Ensure it looks like a path before accepting it
                if ((candidatePath.match(/^[A-Za-z]:/) || candidatePath.startsWith('/')) && 
                    !candidatePath.toLowerCase().includes('appdata') && 
                    !candidatePath.toLowerCase().includes('temp')) {
                  wsPath = candidatePath;
                  if (lineMatch[2]) {
                    wsCorpus = lineMatch[2].trim();
                  }
                  wsName = path.basename(wsPath) || wsPath;
                  wsUri = `file:///${wsPath.replace(/\\/g, '/')}`;
                  break;
                }
              }
            }
            if (wsPath) {
              break;
            }
          }
        }
      }

      // Check if this thread matches the currently active workspace in VS Code
      let isCurrentWorkspace = false;
      const currentWorkspaceFolders = vscode.workspace.workspaceFolders || [];
      if (wsPath) {
        const normalizedWsPath = path.normalize(wsPath).toLowerCase().replace(/[\/\\]+$/, '');
        for (const wf of currentWorkspaceFolders) {
          const currentPath = path.normalize(wf.uri.fsPath).toLowerCase().replace(/[\/\\]+$/, '');
          if (normalizedWsPath === currentPath || normalizedWsPath.startsWith(currentPath) || currentPath.startsWith(normalizedWsPath)) {
            isCurrentWorkspace = true;
            break;
          }
        }
      }

      const wsColor = TitleResolver.getWorkspaceColor(wsName || wsPath || 'default');
      const workspaceDetails = wsPath || wsName ? {
        uri: wsUri,
        path: wsPath,
        name: wsName || (wsPath ? path.basename(wsPath) : 'Workspace'),
        corpus: wsCorpus,
        color: wsColor.hex,
        bgColor: wsColor.bg,
        borderColor: wsColor.border,
        themeColor: wsColor.themeColor,
        isCurrent: isCurrentWorkspace
      } : undefined;

      return {
        id: threadId,
        title,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
        threadPath,
        brainDir,
        metrics,
        status,
        workspaceUri: wsUri,
        workspace: workspaceDetails,
        artifacts,
        firstPrompt,
        lastPrompt,
        lastResponse,
        pinned: override?.pinned,
        archived: override?.archived,
        surface: surface ?? PlatformResolver.detectSurface()
      };
    } catch (err) {
      console.warn(`[ThreadWeaver] Could not parse thread directory ${threadId}:`, err);
      return null;
    }
  }

  /**
   * Recursively discovers all markdown artifacts and scratch files in a thread
   */
  private collectArtifacts(folderPath: string, threadId: string, brainDir: string, results: ArtifactItem[]): void {
    if (!fs.existsSync(folderPath)) {
      return;
    }

    try {
      const items = fs.readdirSync(folderPath, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(folderPath, item.name);
        if (item.isDirectory()) {
          if (item.name === '.system_generated' || item.name === 'node_modules') {
            continue;
          }
          if (item.name === 'scratch') {
            this.collectArtifacts(fullPath, threadId, brainDir, results);
          }
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (['.md', '.txt', '.json', '.sh', '.js', '.ts', '.py'].includes(ext)) {
            const stat = fs.statSync(fullPath);
            const isScratch = fullPath.includes(`${path.sep}scratch${path.sep}`);
            
            let type: ArtifactItem['type'] = 'other';
            if (ext === '.md') {
              type = item.name.toLowerCase().includes('plan') ? 'plan' : 'markdown';
            } else if (['.js', '.ts', '.py', '.sh'].includes(ext)) {
              type = 'code';
            } else if (ext === '.json') {
              type = 'json';
            }

            results.push({
              id: `${threadId}_${item.name}`,
              name: item.name,
              relativePath: path.relative(path.join(brainDir, threadId), fullPath),
              absolutePath: fullPath,
              conversationId: threadId,
              sizeBytes: stat.size,
              sizeFormatted: this.formatBytes(stat.size),
              createdAt: stat.birthtime,
              modifiedAt: stat.mtime,
              isScratch,
              type
            });
          }
        }
      }
    } catch {
      // Best effort collection
    }
  }

  /**
   * Initializes real-time file watchers across all brain directories
   */
  private initWatcher(): void {
    for (const w of this.fileWatchers) {
      try {
        w.close();
      } catch {}
    }
    this.fileWatchers = [];

    for (const bDir of this.brainDirs) {
      if (!fs.existsSync(bDir)) {
        continue;
      }

      try {
        const watcher = fs.watch(bDir, { recursive: true }, (eventType, filename) => {
          if (!filename) {
            return;
          }

          const normalized = filename.replace(/\\/g, '/');

          if (normalized.endsWith('transcript.jsonl') || normalized.endsWith('.md')) {
            const parts = normalized.split('/');
            const threadId = parts[0];

            if (this.debounceTimers.has(threadId)) {
              clearTimeout(this.debounceTimers.get(threadId)!);
            }

            this.debounceTimers.set(
              threadId,
              setTimeout(async () => {
                await this.handleFileChange(threadId, bDir);
              }, 600)
            );
          }
        });

        this.fileWatchers.push(watcher);
      } catch (err) {
        console.warn(`[ThreadWeaver] Could not attach file watcher to ${bDir}:`, err);
      }
    }
  }

  private async handleFileChange(threadId: string, brainDir: string): Promise<void> {
    const threadPath = path.join(brainDir, threadId);
    if (!fs.existsSync(threadPath)) {
      return;
    }

    const overrides = this.storageService.getOverrides();
    const updatedMeta = await this.parseThreadDirectory(threadId, threadPath, brainDir, overrides[threadId]);

    if (updatedMeta) {
      this.threadsCache.set(threadId, updatedMeta);
      this._onDidChangeThreads.fire();

      const autoSyncConfig = vscode.workspace.getConfiguration('threadweaver').get<boolean>('autoSyncOnSuccess', true);

      if (autoSyncConfig && updatedMeta.status === 'completed') {
        this._onDidAutoSync.fire({
          thread: updatedMeta,
          reason: 'Agent completed step with success status (DONE)'
        });
      }
    }
  }

  /**
   * Loads the full step transcript for a thread
   */
  public async loadTranscript(threadId: string): Promise<ThreadStep[]> {
    const thread = this.threadsCache.get(threadId);
    let searchDirs: string[] = [];

    if (thread?.threadPath) {
      searchDirs.push(thread.threadPath);
    }
    for (const bDir of this.brainDirs) {
      searchDirs.push(path.join(bDir, threadId));
    }

    for (const threadPath of searchDirs) {
      const transcriptFile = path.join(threadPath, '.system_generated', 'logs', 'transcript_full.jsonl');
      const compactFile = path.join(threadPath, '.system_generated', 'logs', 'transcript.jsonl');

      const target = fs.existsSync(transcriptFile) ? transcriptFile : compactFile;
      if (fs.existsSync(target)) {
        try {
          const content = fs.readFileSync(target, 'utf8');
          const lines = content.split('\n').filter((l) => l.trim().length > 0);
          const steps: ThreadStep[] = [];

          for (const line of lines) {
            try {
              steps.push(JSON.parse(line));
            } catch {}
          }

          return steps;
        } catch (err) {
          console.error(`[ThreadWeaver] Error loading transcript for ${threadId}:`, err);
        }
      }
    }

    return [];
  }

  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}k`;
    }
    return num.toString();
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  public dispose(): void {
    for (const w of this.fileWatchers) {
      try {
        w.close();
      } catch {}
    }
    this.fileWatchers = [];
  }
}
