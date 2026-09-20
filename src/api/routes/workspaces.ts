import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { BrainWatcher } from '../../services/brainWatcher';

export function registerWorkspaceRoutes(router: Router, brainWatcher: BrainWatcher) {
  
  // GET /workspaces
  router.get('/workspaces', (req: Request, res: Response) => {
    try {
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
            const ws = workspacesMap.get(thread.workspaceUri);
            ws.threadCount++;
          }
        }
      }

      res.json({ workspaces: Array.from(workspacesMap.values()) });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get workspaces' });
    }
  });

  // GET /workspaces/:id/threads
  router.get('/workspaces/:id/threads', (req: Request, res: Response) => {
    try {
      const targetId = req.params.id as string;
      const threads = brainWatcher.getThreads().filter(t => {
        if (!t.workspaceUri) return false;
        const hash = crypto.createHash('md5').update(t.workspaceUri).digest('hex');
        return hash === targetId;
      });
      res.json({ threads });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get threads for workspace' });
    }
  });
}
