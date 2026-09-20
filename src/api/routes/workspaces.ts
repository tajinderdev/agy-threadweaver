import { Router, Request, Response } from 'express';
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
            workspacesMap.set(thread.workspaceUri, {
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

  // GET /workspaces/:encodedUri/threads
  router.get('/workspaces/:encodedUri/threads', (req: Request, res: Response) => {
    try {
      const uri = decodeURIComponent(req.params.encodedUri as string);
      const threads = brainWatcher.getThreads().filter(t => t.workspaceUri === uri);
      res.json({ threads });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get threads for workspace' });
    }
  });
}
