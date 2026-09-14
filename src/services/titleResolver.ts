import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';

export class TitleResolver {
  private static cachedTitles: Map<string, string> = new Map();
  private static lastFetchTime = 0;

  /**
   * Resolves titles for all conversations across Antigravity state, SQLite, and annotations
   */
  public static async refreshTitles(extensionPath: string): Promise<Map<string, string>> {
    const homeDir = os.homedir();
    const resolved = new Map<string, string>();

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

    // 2. Run extractTitles.py to pull exact titles from state.vscdb and conversation_summaries.db
    const pyScript = path.join(extensionPath, 'src', 'services', 'extractTitles.py');
    const altPyScript = path.join(extensionPath, 'dist', 'extractTitles.py');
    const targetScript = fs.existsSync(pyScript) ? pyScript : fs.existsSync(altPyScript) ? altPyScript : null;

    if (targetScript) {
      await new Promise<void>((resolve) => {
        exec(`python "${targetScript}"`, { timeout: 3500 }, (err, stdout) => {
          if (!err && stdout) {
            try {
              const parsed = JSON.parse(stdout.trim());
              for (const [id, title] of Object.entries(parsed)) {
                if (typeof title === 'string' && title.trim()) {
                  resolved.set(id, title.trim());
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
    this.lastFetchTime = Date.now();
    return this.cachedTitles;
  }

  public static getCachedTitle(threadId: string): string | undefined {
    return this.cachedTitles.get(threadId);
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
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Normalize whitespace
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

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
}
