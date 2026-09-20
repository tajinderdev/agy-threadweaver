import * as vscode from 'vscode';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as crypto from 'crypto';
import { Server } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BrainWatcher } from '../services/brainWatcher';
import { registerWorkspaceRoutes } from './routes/workspaces';
import { registerThreadRoutes } from './routes/threads';
import { registerArtifactRoutes } from './routes/artifacts';

export class ApiServer {
  private app = express();
  private server?: Server;
  private token: string;
  private port: number = 0;

  constructor(private context: vscode.ExtensionContext, private brainWatcher: BrainWatcher) {
    this.token = crypto.randomBytes(32).toString('hex');

    this.app.use(cors());
    this.app.use(express.json());

    // Authentication Middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${this.token}`) {
         res.status(401).json({ error: 'Unauthorized. Invalid Bearer token.' });
         return;
      }
      next();
    });

    // Register Routes
    const router = express.Router();
    registerWorkspaceRoutes(router, this.brainWatcher, this.context.extensionPath);
    registerThreadRoutes(router, this.brainWatcher);
    registerArtifactRoutes(router, this.brainWatcher);

    this.app.use('/api/v1', router);
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(0, '127.0.0.1', () => {
          const address = this.server?.address();
          if (address && typeof address !== 'string') {
            this.port = address.port;
            console.log(`[ThreadWeaver API] Started at http://127.0.0.1:${this.port}`);
            console.log(`[ThreadWeaver API] Token: ${this.token}`);
            
            this.context.globalState.update('threadWeaverApiPort', this.port);
            this.context.globalState.update('threadWeaverApiToken', this.token);
            this.writeConnectionFile();
            resolve();
          } else {
             reject(new Error("Could not get port"));
          }
        });
        
        this.server.on('error', (err) => {
           reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public stop(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
      this.deleteConnectionFile();
      console.log(`[ThreadWeaver API] Stopped.`);
    }
  }

  public getPort(): number {
    return this.port;
  }

  public getToken(): string {
    return this.token;
  }

  private getConnectionFilePath(): string {
    return path.join(os.homedir(), '.gemini', 'threadweaver_api.json');
  }

  private writeConnectionFile() {
    try {
      const geminiDir = path.join(os.homedir(), '.gemini');
      if (!fs.existsSync(geminiDir)) {
        fs.mkdirSync(geminiDir, { recursive: true });
      }
      
      const info = {
        port: this.port,
        baseUrl: `http://127.0.0.1:${this.port}`,
        token: this.token,
        docsPath: path.join(this.context.extensionPath, 'docs', 'API.md')
      };
      
      fs.writeFileSync(this.getConnectionFilePath(), JSON.stringify(info, null, 2), 'utf8');
    } catch (err) {
      console.error('[ThreadWeaver API] Failed to write connection file:', err);
    }
  }

  private deleteConnectionFile() {
    try {
      const file = this.getConnectionFilePath();
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      console.error('[ThreadWeaver API] Failed to delete connection file:', err);
    }
  }
}
