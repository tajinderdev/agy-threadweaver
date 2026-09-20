import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { WorkspaceDetails, WorkspaceColor } from '../models/thread';

export const WORKSPACE_COLORS: WorkspaceColor[] = [
  { name: 'blue', hex: '#3b82f6', bg: 'rgba(59, 130, 246, 0.18)', border: '#3b82f6', themeColor: 'charts.blue' },
  { name: 'emerald', hex: '#10b981', bg: 'rgba(16, 185, 129, 0.18)', border: '#10b981', themeColor: 'charts.green' },
  { name: 'purple', hex: '#a855f7', bg: 'rgba(168, 85, 247, 0.18)', border: '#a855f7', themeColor: 'charts.purple' },
  { name: 'amber', hex: '#f59e0b', bg: 'rgba(245, 158, 11, 0.18)', border: '#f59e0b', themeColor: 'charts.yellow' },
  { name: 'rose', hex: '#f43f5e', bg: 'rgba(244, 63, 94, 0.18)', border: '#f43f5e', themeColor: 'charts.red' },
  { name: 'cyan', hex: '#06b6d4', bg: 'rgba(6, 182, 212, 0.18)', border: '#06b6d4', themeColor: 'charts.cyan' },
  { name: 'orange', hex: '#f97316', bg: 'rgba(249, 115, 22, 0.18)', border: '#f97316', themeColor: 'charts.orange' },
  { name: 'pink', hex: '#ec4899', bg: 'rgba(236, 72, 153, 0.18)', border: '#ec4899', themeColor: 'charts.red' },
  { name: 'indigo', hex: '#6366f1', bg: 'rgba(99, 102, 241, 0.18)', border: '#6366f1', themeColor: 'charts.purple' },
  { name: 'teal', hex: '#14b8a6', bg: 'rgba(20, 184, 166, 0.18)', border: '#14b8a6', themeColor: 'charts.green' }
];

export class TitleResolver {
  private static cachedTitles: Map<string, string> = new Map();
  private static cachedWorkspaces: Map<string, { uri: string; path: string; name: string; corpus?: string }> = new Map();
  private static lastFetchTime = 0;

  /**
   * Resolves titles and workspace metadata across Antigravity state, SQLite, and annotations
   */
  public static async refreshTitles(extensionPath: string): Promise<Map<string, string>> {
    const homeDir = os.homedir();
    const resolved = new Map<string, string>();
    const resolvedWorkspaces = new Map<string, { uri: string; path: string; name: string; corpus?: string }>();

    // 1. Read .pbtxt annotations in all known annotation directories (Fast, synchronous, pure JS)
    const annDirs = [
      path.join(homeDir, '.gemini', 'antigravity-cli', 'annotations'),
      path.join(homeDir, '.gemini', 'antigravity', 'annotations'),
      path.join(homeDir, '.gemini', 'antigravity-ide', 'annotations')
    ];

    for (const dir of annDirs) {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir);
          for (const f of files) {
            if (f.endsWith('.pbtxt')) {
              const threadId = f.slice(0, -6);
              try {
                const content = fs.readFileSync(path.join(dir, f), 'utf8');
                const match = content.match(/title:\s*"([^"]+)"/);
                if (match && match[1]) {
                  resolved.set(threadId, match[1].trim());
                }
              } catch {
                // Ignore unreadable file
              }
            }
          }
        } catch {
          // Ignore directory error
        }
      }
    }

    // 2. Run extractTitles.py to pull exact titles and workspace mappings from SQLite DBs
    const pyScript = path.join(extensionPath, 'src', 'services', 'extractTitles.py');
    const altPyScript = path.join(extensionPath, 'dist', 'extractTitles.py');
    const targetScript = fs.existsSync(pyScript) ? pyScript : fs.existsSync(altPyScript) ? altPyScript : null;

    if (targetScript) {
      await new Promise<void>((resolve) => {
        exec(`python "${targetScript}"`, { timeout: 3500 }, (err, stdout) => {
          if (!err && stdout) {
            try {
              const parsed = JSON.parse(stdout.trim());
              if (parsed.titles && typeof parsed.titles === 'object') {
                for (const [id, title] of Object.entries(parsed.titles)) {
                  if (typeof title === 'string' && title.trim()) {
                    resolved.set(id, title.trim());
                  }
                }
              }
              if (parsed.workspaces && typeof parsed.workspaces === 'object') {
                for (const [id, ws] of Object.entries(parsed.workspaces)) {
                  if (ws && typeof ws === 'object') {
                    resolvedWorkspaces.set(id, ws as any);
                  }
                }
              }
              // Legacy direct format fallback
              if (!parsed.titles && !parsed.workspaces) {
                for (const [id, title] of Object.entries(parsed)) {
                  if (typeof title === 'string' && title.trim()) {
                    resolved.set(id, title.trim());
                  }
                }
              }
            } catch {
              // Ignore json parse error
            }
          }
          resolve();
        });
      });
    }

    this.cachedTitles = resolved;
    this.cachedWorkspaces = resolvedWorkspaces;
    this.lastFetchTime = Date.now();
    return this.cachedTitles;
  }

  public static getCachedTitle(threadId: string): string | undefined {
    return this.cachedTitles.get(threadId);
  }

  public static getCachedWorkspace(threadId: string): { uri: string; path: string; name: string; corpus?: string } | undefined {
    return this.cachedWorkspaces.get(threadId);
  }

  /**
   * Deterministically maps a workspace key (name or path) to a vibrant color
   */
  public static getWorkspaceColor(workspaceKey?: string): WorkspaceColor {
    if (!workspaceKey) {
      return WORKSPACE_COLORS[0];
    }
    const normalized = workspaceKey.toLowerCase().replace(/[\\\/]/g, '_');
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      hash = (hash << 5) - hash + normalized.charCodeAt(i);
      hash |= 0;
    }
    const index = Math.abs(hash) % WORKSPACE_COLORS.length;
    return WORKSPACE_COLORS[index];
  }

  /**
   * Intelligently cleans and titles a raw prompt when no formal title exists
   */
  public static cleanPromptTitle(raw: string): string {
    if (!raw) {
      return 'Untitled Thread';
    }

    let clean = raw
      // Strip XML / System tags
      .replace(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/gi, '$1')
      .replace(/<[\s\S]*?>/g, ' ')
      // Strip markdown code fences, urls, and brackets
      .replace(/```[\s\S]*?```/g, '')
      .replace(/https?:\/\/[^\s]+/g, '')
      // Strip file mentions like @[c:\path\file.php:L10-L20] or @[filename]
      .replace(/@\[[^\]]+\]/g, '')
      .replace(/@\S+/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Normalize whitespace
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Format slash commands (e.g. /processing-mantis-tickets 12345 -> Mantis Ticket #12345)
    const slashMatch = clean.match(/^\/([a-zA-Z0-9_\-]+)(?:\s+([0-9]+))?(?:\s+(.*))?$/);
    if (slashMatch) {
      let cmdName = slashMatch[1].replace(/^processing-/, '').replace(/[-_]/g, ' ');
      cmdName = cmdName.replace(/\b\w/g, (c) => c.toUpperCase());
      const num = slashMatch[2] ? ` #${slashMatch[2]}` : '';
      const rest = slashMatch[3] ? `: ${slashMatch[3]}` : '';
      clean = `${cmdName}${num}${rest}`.trim();
    }

    // Strip conversational filler prefixes
    clean = clean
      .replace(/^(okay|ok|hey|hi|hello)\s*,?\s*(let'?s\s*(make|build|create|write|do|implement)?\s*)?/i, '')
      .replace(/^let'?s\s*(make|build|create|write|do|implement)?\s*/i, '')
      .replace(/^(can|could|would)\s*you\s*(please\s*)?/i, '')
      .replace(/^(please\s*)?(help\s*me\s*(to\s*)?)?/i, '')
      .replace(/^(i\s*(want|need|would like)\s*to\s*)/i, '')
      .trim();

    // Take first sentence or first 55 characters
    const sentenceEnd = clean.search(/[\.\?\!\n]/);
    if (sentenceEnd > 15 && sentenceEnd < 65) {
      clean = clean.slice(0, sentenceEnd);
    } else if (clean.length > 55) {
      clean = clean.slice(0, 52) + '...';
    }

    if (!clean) {
      return 'Untitled Thread';
    }

    // Capitalize first character
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  /**
   * Cleans and extracts the first user prompt or description line (without system metadata/tags)
   */
  public static cleanDescription(raw?: string): string {
    if (!raw) {
      return '';
    }

    let text = raw;
    const match = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
    if (match && match[1]) {
      text = match[1];
    }

    text = text
      .replace(/<[\s\S]*?>/g, ' ')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/@\[[^\]]+\]/g, '')
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text.length > 140 ? text.slice(0, 137) + '...' : text;
  }
}
