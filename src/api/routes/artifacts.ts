import * as fs from 'fs';
import * as path from 'path';
import { Router, Request, Response } from 'express';
import { BrainWatcher } from '../../services/brainWatcher';

export function registerArtifactRoutes(router: Router, brainWatcher: BrainWatcher) {
  
  // GET /threads/:id/artifacts
  router.get('/threads/:id/artifacts', (req: Request, res: Response) => {
    try {
      const threadId = req.params.id as string;
      const threadMeta = brainWatcher.getThread(threadId);

      if (!threadMeta) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }

      res.json({ artifacts: threadMeta.artifacts });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get artifacts' });
    }
  });

  // GET /threads/:id/artifacts/:filename
  router.get('/threads/:id/artifacts/:filename', (req: Request, res: Response) => {
    try {
      const threadId = req.params.id as string;
      const filename = req.params.filename as string;
      
      const threadMeta = brainWatcher.getThread(threadId);
      if (!threadMeta) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }

      const artifact = threadMeta.artifacts.find(a => a.name === filename);
      if (!artifact) {
        res.status(404).json({ error: 'Artifact not found' });
        return;
      }

      if (!fs.existsSync(artifact.absolutePath)) {
        res.status(404).json({ error: 'Artifact file is missing from disk' });
        return;
      }

      const content = fs.readFileSync(artifact.absolutePath, 'utf8');
      let metadata = null;
      let feedbackState = 'unknown';

      // Look for .metadata.json
      const metaPath = `${artifact.absolutePath}.metadata.json`;
      if (fs.existsSync(metaPath)) {
        try {
          const metaContent = fs.readFileSync(metaPath, 'utf8');
          metadata = JSON.parse(metaContent);
          
          // Simple heuristic based on thread data or metadata shape
          // If metadata exists, check for user interactions in transcript or assume 'reviewed'
          if (metadata && 'RequestFeedback' in metadata) {
            feedbackState = 'pending_or_reviewed'; // Can be refined by querying transcript
          }
        } catch (e) {
          // ignore parse errors
        }
      }

      res.json({
        content,
        metadata,
        feedbackState
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get artifact details' });
    }
  });
}
