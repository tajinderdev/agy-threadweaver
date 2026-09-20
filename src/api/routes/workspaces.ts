import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { BrainWatcher } from '../../services/brainWatcher';

/**
 * Runs extractTitles.py and returns the parsed workspaces map.
 * Falls back to brainWatcher thread cache if the script fails.
 */
function getWorkspacesFromPython(extensionPath: string): Promise<Map<string, any>> {
  return new Promise((resolve) => {
    const pyScript = path.join(extensionPath, 'dist', 'extractTitles.py');
    const fallbackScript = path.join(extensionPath, 'src', 'services', 'extractTitles.py');
    const targetScript = fs.existsSync(pyScript) ? pyScript : fs.existsSync(fallbackScript) ? fallbackScript : null;

    if (!targetScript) {
      resolve(new Map());
      return;
    }

    exec(`python "${targetScript}"`, { timeout: 30000, encoding: 'utf8' }, (err, stdout) => {
      if (err || !stdout) {
        resolve(new Map());
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const wsMap = new Map<string, any>();
        const workspaces: Record<string, any> = parsed.workspaces || {};

        for (const [threadId, ws] of Object.entries(workspaces)) {
          if (ws && (ws as any).uri) {
            const uri: string = (ws as any).uri;
            if (!wsMap.has(uri)) {
              const workspaceId = crypto.createHash('md5').update(uri).digest('hex');
              wsMap.set(uri, {
                id: workspaceId,
                uri,
                path: (ws as any).path || '',
                name: (ws as any).name || '',
                corpus: (ws as any).corpus || null,
                threadIds: [threadId],
                threadCount: 1
              });
            } else {
              const existing = wsMap.get(uri)!;
              if (!existing.threadIds.includes(threadId)) {
                existing.threadIds.push(threadId);
                existing.threadCount++;
              }
            }
          }
        }
        resolve(wsMap);
      } catch {
        resolve(new Map());
      }
    });
  });
}

export function registerWorkspaceRoutes(router: Router, brainWatcher: BrainWatcher, extensionPath: string) {

  // GET /workspaces — reads directly from Python extractor, not from thread cache
  router.get('/workspaces', async (req: Request, res: Response) => {
    try {
      // Primary: use Python script (authoritative, always fresh)
      const pyMap = await getWorkspacesFromPython(extensionPath);

      if (pyMap.size > 0) {
        res.json({ workspaces: Array.from(pyMap.values()) });
        return;
      }

      // Fallback: derive from brainWatcher thread cache if Python fails
      const threads = brainWatcher.getThreads();
      const workspacesMap = new Map<string, any>();
      for (const thread of threads) {
        if (thread.workspaceUri && thread.workspace) {
          if (!workspacesMap.has(thread.workspaceUri)) {
            const workspaceId = crypto.createHash('md5').update(thread.workspaceUri).digest('hex');
            workspacesMap.set(thread.workspaceUri, {
              id: workspaceId,
              ...thread.workspace,
              threadCount: 1
            });
          } else {
            workspacesMap.get(thread.workspaceUri).threadCount++;
          }
        }
      }
      res.json({ workspaces: Array.from(workspacesMap.values()) });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get workspaces' });
    }
  });

  // GET /workspaces/:id/threads
  router.get('/workspaces/:id/threads', async (req: Request, res: Response) => {
    try {
      const targetId = req.params.id as string;

      // Primary: resolve workspace URI from Python, then filter threads
      const pyMap = await getWorkspacesFromPython(extensionPath);
      let matchedUri: string | null = null;
      let threadIdsFromPy: string[] | null = null;

      for (const [uri, ws] of pyMap.entries()) {
        if (ws.id === targetId) {
          matchedUri = uri;
          threadIdsFromPy = ws.threadIds;
          break;
        }
      }

      if (threadIdsFromPy) {
        const threadIdSet = new Set(threadIdsFromPy);
        const threads = brainWatcher.getThreads().filter(t => threadIdSet.has(t.id));
        res.json({ threads });
        return;
      }

      // Fallback: use MD5 hash on thread's workspaceUri from cache
      const threads = brainWatcher.getThreads().filter(t => {
        if (!t.workspaceUri) { return false; }
        const hash = crypto.createHash('md5').update(t.workspaceUri).digest('hex');
        return hash === targetId;
      });
      res.json({ threads });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get threads for workspace' });
    }
  });
}
