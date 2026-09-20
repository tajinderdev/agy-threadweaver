import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OSSurface } from '../models/thread';

export interface StateDatabasePaths {
  /** Antigravity IDE global state DB (vscdb) */
  ideStateDbs: string[];
  /** Antigravity CLI conversation summaries */
  cliSummaryDbs: string[];
  /** Protobuf summary files (agyhub_summaries_proto.pb) */
  protobufs: string[];
}

/**
 * Detects the current OS surface and returns the correct Antigravity
 * brain directories and metadata paths. Supports Windows, macOS, Linux,
 * and WSL (with cross-access to Windows-side paths via /mnt/c).
 */
export class PlatformResolver {
  // ─── Surface Detection ──────────────────────────────────────────────────────

  /**
   * Detects the current OS surface.
   * WSL is detected by reading /proc/version for the word "Microsoft" or "WSL".
   */
  public static detectSurface(): OSSurface {
    const platform = process.platform;

    if (platform === 'win32') {
      return 'windows';
    }
    if (platform === 'darwin') {
      return 'macos';
    }
    // Linux — distinguish native vs WSL
    if (platform === 'linux') {
      try {
        const procVersion = fs.readFileSync('/proc/version', 'utf8');
        if (/microsoft|wsl/i.test(procVersion)) {
          return 'wsl';
        }
      } catch {
        // /proc/version unreadable — treat as plain Linux
      }
      return 'linux';
    }

    return 'linux'; // Fallback for any exotic platform
  }

  // ─── Brain Directory Candidates ──────────────────────────────────────────────

  /**
   * Returns all possible Antigravity brain directory paths for the given surface,
   * ordered by priority (most authoritative first).
   *
   * For WSL this includes BOTH the WSL-native paths AND the Windows-side paths
   * mounted at /mnt/c, so threads from both installs are visible.
   */
  public static getBrainCandidates(surface: OSSurface): string[] {
    const home = os.homedir();
    const candidates: string[] = [];

    switch (surface) {
      case 'windows': {
        // Primary .gemini locations
        candidates.push(
          path.join(home, '.gemini', 'antigravity-ide', 'brain'),
          path.join(home, '.gemini', 'antigravity-cli', 'brain'),
          path.join(home, '.gemini', 'antigravity', 'brain'),
          path.join(home, '.gemini', 'brain')
        );
        // APPDATA-based legacy locations
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        candidates.push(path.join(appData, 'antigravity', 'brain'));
        break;
      }

      case 'macos': {
        const appSupport = path.join(home, 'Library', 'Application Support');
        // Electron app install location
        candidates.push(
          path.join(appSupport, 'Antigravity IDE', 'brain'),
          path.join(appSupport, 'Antigravity', 'brain')
        );
        // CLI / dotfile location
        candidates.push(
          path.join(home, '.gemini', 'antigravity-ide', 'brain'),
          path.join(home, '.gemini', 'antigravity-cli', 'brain'),
          path.join(home, '.gemini', 'antigravity', 'brain'),
          path.join(home, '.gemini', 'brain')
        );
        break;
      }

      case 'linux': {
        // XDG-compliant location first, then .gemini dotfiles
        const xdgData = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
        candidates.push(
          path.join(xdgData, 'Antigravity IDE', 'brain'),
          path.join(xdgData, 'Antigravity', 'brain'),
          path.join(home, '.config', 'Antigravity IDE', 'brain'),
          path.join(home, '.gemini', 'antigravity-ide', 'brain'),
          path.join(home, '.gemini', 'antigravity-cli', 'brain'),
          path.join(home, '.gemini', 'antigravity', 'brain'),
          path.join(home, '.gemini', 'brain')
        );
        break;
      }

      case 'wsl': {
        // 1. WSL-native Linux paths (own Antigravity install on WSL)
        const xdgData = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
        candidates.push(
          path.join(home, '.gemini', 'antigravity-ide', 'brain'),
          path.join(home, '.gemini', 'antigravity-cli', 'brain'),
          path.join(home, '.gemini', 'antigravity', 'brain'),
          path.join(home, '.gemini', 'brain'),
          path.join(xdgData, 'Antigravity IDE', 'brain')
        );

        // 2. Windows-side paths accessible via /mnt/c
        const windowsHome = PlatformResolver.resolveWindowsHomeFromWSL();
        if (windowsHome) {
          candidates.push(
            path.join(windowsHome, '.gemini', 'antigravity-ide', 'brain'),
            path.join(windowsHome, '.gemini', 'antigravity-cli', 'brain'),
            path.join(windowsHome, '.gemini', 'antigravity', 'brain'),
            path.join(windowsHome, '.gemini', 'brain')
          );
          // Windows APPDATA (mapped through /mnt/c)
          const winAppData = PlatformResolver.resolveWindowsAppDataFromWSL(windowsHome);
          if (winAppData) {
            candidates.push(path.join(winAppData, 'antigravity', 'brain'));
          }
        }
        break;
      }
    }

    return candidates;
  }

  // ─── State Database Candidates ───────────────────────────────────────────────

  /**
   * Returns all possible Antigravity metadata/DB paths for the given surface.
   * These are used by extractTitles.py (passed as env vars or CLI args).
   */
  public static getStateDatabaseCandidates(surface: OSSurface): StateDatabasePaths {
    const home = os.homedir();

    switch (surface) {
      case 'windows': {
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        return {
          ideStateDbs: [
            path.join(appData, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
            path.join(appData, 'Code', 'User', 'globalStorage', 'state.vscdb')
          ],
          cliSummaryDbs: [
            path.join(home, '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
            path.join(home, '.gemini', 'antigravity', 'conversation_summaries.db')
          ],
          protobufs: [
            path.join(home, '.gemini', 'antigravity', 'agyhub_summaries_proto.pb'),
            path.join(home, '.gemini', 'antigravity-ide', 'agyhub_summaries_proto.pb'),
            path.join(home, '.gemini', 'agyhub_summaries_proto.pb'),
            path.join(home, '.gemini', 'antigravity-cli', 'agyhub_summaries_proto.pb')
          ]
        };
      }

      case 'macos': {
        const appSupport = path.join(home, 'Library', 'Application Support');
        return {
          ideStateDbs: [
            path.join(appSupport, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
            path.join(appSupport, 'Antigravity', 'User', 'globalStorage', 'state.vscdb')
          ],
          cliSummaryDbs: [
            path.join(home, '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
            path.join(home, '.gemini', 'antigravity', 'conversation_summaries.db')
          ],
          protobufs: [
            path.join(home, '.gemini', 'antigravity', 'agyhub_summaries_proto.pb'),
            path.join(home, '.gemini', 'antigravity-ide', 'agyhub_summaries_proto.pb'),
            path.join(home, '.gemini', 'agyhub_summaries_proto.pb'),
            path.join(home, '.gemini', 'antigravity-cli', 'agyhub_summaries_proto.pb'),
            path.join(appSupport, 'Antigravity IDE', 'agyhub_summaries_proto.pb')
          ]
        };
      }

      case 'linux': {
        const xdgData = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
        return {
          ideStateDbs: [
            path.join(home, '.config', 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'),
            path.join(xdgData, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb')
          ],
          cliSummaryDbs: [
            path.join(home, '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
            path.join(home, '.gemini', 'antigravity', 'conversation_summaries.db')
          ],
          protobufs: [
            path.join(home, '.gemini', 'antigravity', 'agyhub_summaries_proto.pb'),
            path.join(home, '.gemini', 'antigravity-ide', 'agyhub_summaries_proto.pb'),
            path.join(home, '.gemini', 'agyhub_summaries_proto.pb'),
            path.join(home, '.gemini', 'antigravity-cli', 'agyhub_summaries_proto.pb')
          ]
        };
      }

      case 'wsl': {
        // Start with WSL-native Linux paths
        const result = PlatformResolver.getStateDatabaseCandidates('linux');
        // Bridge: also include Windows-side paths
        const windowsHome = PlatformResolver.resolveWindowsHomeFromWSL();
        if (windowsHome) {
          const winAppData = PlatformResolver.resolveWindowsAppDataFromWSL(windowsHome);
          if (winAppData) {
            result.ideStateDbs.push(
              path.join(winAppData, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb')
            );
            result.cliSummaryDbs.push(
              path.join(windowsHome, '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
              path.join(windowsHome, '.gemini', 'antigravity', 'conversation_summaries.db')
            );
            result.protobufs.push(
              path.join(windowsHome, '.gemini', 'antigravity', 'agyhub_summaries_proto.pb'),
              path.join(windowsHome, '.gemini', 'antigravity-ide', 'agyhub_summaries_proto.pb'),
              path.join(windowsHome, '.gemini', 'agyhub_summaries_proto.pb')
            );
          }
        }
        return result;
      }
    }
  }

  // ─── WSL Windows Bridge ──────────────────────────────────────────────────────

  /**
   * On WSL, resolves the Windows-side user home directory via /mnt/c/Users/<user>.
   * First checks USERPROFILE env var (set by Windows), then probes common mount paths.
   * Returns null if Windows side is not accessible.
   */
  public static resolveWindowsHomeFromWSL(): string | null {
    // WSL_DISTRO_NAME is set by WSL itself — confirms we are truly in WSL
    if (!process.env.WSL_DISTRO_NAME && !PlatformResolver._isWSLEnvironment()) {
      return null;
    }

    // USERPROFILE is often injected into WSL env from Windows
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      // Convert Windows path to WSL mount path: C:\Users\foo -> /mnt/c/Users/foo
      const wslPath = PlatformResolver._windowsPathToWSL(userProfile);
      if (wslPath && fs.existsSync(wslPath)) {
        return wslPath;
      }
    }

    // Probe /mnt/c/Users/ for directories matching the current WSL user
    const mountRoot = '/mnt/c/Users';
    if (fs.existsSync(mountRoot)) {
      const wslUser = os.userInfo().username;
      const exactMatch = path.join(mountRoot, wslUser);
      if (fs.existsSync(exactMatch)) {
        return exactMatch;
      }
      // Fallback: pick the first non-system user dir
      try {
        const entries = fs.readdirSync(mountRoot, { withFileTypes: true });
        const systemDirs = new Set(['Public', 'Default', 'All Users', 'Default User']);
        for (const entry of entries) {
          if (entry.isDirectory() && !systemDirs.has(entry.name)) {
            return path.join(mountRoot, entry.name);
          }
        }
      } catch {
        // Mount not accessible
      }
    }

    return null;
  }

  /**
   * Resolves the Windows AppData/Roaming directory when running inside WSL.
   * Returns a WSL-accessible /mnt/c/... path, or null if not resolvable.
   */
  public static resolveWindowsAppDataFromWSL(windowsHome: string): string | null {
    // Standard Windows layout: <home>/AppData/Roaming
    const appData = path.join(windowsHome, 'AppData', 'Roaming');
    return fs.existsSync(appData) ? appData : null;
  }

  // ─── Surface Label Helpers ───────────────────────────────────────────────────

  /**
   * Returns a short emoji + label for display in the UI.
   * e.g. "🪟 Windows", "🐧 WSL", "🍎 macOS", "🐧 Linux"
   */
  public static surfaceLabel(surface: OSSurface): string {
    switch (surface) {
      case 'windows': return '🪟 Windows';
      case 'macos':   return '🍎 macOS';
      case 'wsl':     return '🐧 WSL';
      case 'linux':   return '🐧 Linux';
    }
  }

  /**
   * Returns a short compact tag for sidebar descriptions.
   * e.g. "[WSL]", "[CLI]"
   */
  public static surfaceTag(surface: OSSurface): string {
    switch (surface) {
      case 'windows': return '';   // No tag needed — it's the native surface
      case 'macos':   return '';
      case 'wsl':     return '[WSL] ';
      case 'linux':   return '[Linux] ';
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private static _isWSLEnvironment(): boolean {
    try {
      const v = fs.readFileSync('/proc/version', 'utf8');
      return /microsoft|wsl/i.test(v);
    } catch {
      return false;
    }
  }

  private static _windowsPathToWSL(winPath: string): string | null {
    // C:\Users\foo  →  /mnt/c/Users/foo
    const match = winPath.match(/^([A-Za-z]):[\\\/](.*)/);
    if (!match) {
      return null;
    }
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }
}
