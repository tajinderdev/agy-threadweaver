import { Router, Request, Response } from 'express';
import { BrainWatcher } from '../../services/brainWatcher';

export function registerThreadRoutes(router: Router, brainWatcher: BrainWatcher) {
  
  // GET /threads
  router.get('/threads', (req: Request, res: Response) => {
    try {
      let threads = brainWatcher.getThreads();

      // Simple query filtering
      const { status, surface, limit } = req.query;
      
      if (status && typeof status === 'string') {
        threads = threads.filter(t => t.status === status);
      }
      
      if (surface && typeof surface === 'string') {
        threads = threads.filter(t => t.surface === surface);
      }

      if (limit && typeof limit === 'string' && !isNaN(parseInt(limit))) {
        threads = threads.slice(0, parseInt(limit));
      }

      res.json({ threads });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get threads' });
    }
  });

  // GET /threads/:id
  router.get('/threads/:id', async (req: Request, res: Response) => {
    try {
      const threadId = req.params.id as string;
      const threadMeta = brainWatcher.getThread(threadId);

      if (!threadMeta) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }

      const transcript = await brainWatcher.loadTranscript(threadId);

      res.json({
        meta: threadMeta,
        transcript,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get thread details' });
    }
  });

  // GET /threads/:id/transcript
  router.get('/threads/:id/transcript', async (req: Request, res: Response) => {
    try {
      const threadId = req.params.id as string;
      const threadMeta = brainWatcher.getThread(threadId);

      if (!threadMeta) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }

      const transcript = await brainWatcher.loadTranscript(threadId);
      res.json({ transcript });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get thread transcript' });
    }
  });
}
