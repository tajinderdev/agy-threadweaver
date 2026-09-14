import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import AdmZip from 'adm-zip';
import { ThreadMeta, ThreadStep } from '../models/thread';

export class ZipService {
  /**
   * Exports a thread, its transcript, and all artifacts into a self-contained zip file
   */
  public static async exportThread(
    thread: ThreadMeta,
    brainDir: string,
    transcript: ThreadStep[]
  ): Promise<string | undefined> {
    const threadDir = thread.threadPath || path.join(brainDir, thread.id);
    const sanitizedTitle = thread.title
      .replace(/[^a-zA-Z0-9_\-\s]/g, '')
      .trim()
      .slice(0, 40)
      .replace(/\s+/g, '_');

    const defaultFileName = `${sanitizedTitle || 'thread'}_${thread.id.slice(0, 8)}.zip`;

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultFileName),
      filters: {
        'Antigravity Thread Zip': ['zip']
      },
      title: 'Export Antigravity Thread Archive'
    });

    if (!saveUri) {
      return undefined;
    }

    const zip = new AdmZip();

    // 1. Add thread_meta.json
    zip.addFile(
      'thread_meta.json',
      Buffer.from(JSON.stringify(thread, null, 2), 'utf-8'),
      'Metadata of the Antigravity conversation'
    );

    // 2. Add full transcript.jsonl if it exists
    const transcriptPath = path.join(threadDir, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(transcriptPath)) {
      zip.addLocalFile(transcriptPath, 'logs');
    }

    const fullTranscriptPath = path.join(threadDir, '.system_generated', 'logs', 'transcript_full.jsonl');
    if (fs.existsSync(fullTranscriptPath)) {
      zip.addLocalFile(fullTranscriptPath, 'logs');
    }

    // 3. Add human-readable conversation.md
    const markdownContent = this.generateReadableMarkdown(thread, transcript);
    zip.addFile(
      'conversation.md',
      Buffer.from(markdownContent, 'utf-8'),
      'Human-readable thread transcript'
    );

    // 4. Add all artifacts and scratch files
    for (const artifact of thread.artifacts) {
      if (fs.existsSync(artifact.absolutePath)) {
        const zipSubFolder = artifact.isScratch ? 'artifacts/scratch' : 'artifacts';
        zip.addLocalFile(artifact.absolutePath, zipSubFolder);
      }
    }

    // Write zip to disk
    await zip.writeZipPromise(saveUri.fsPath);
    return saveUri.fsPath;
  }

  /**
   * Imports a thread zip bundle into the local Antigravity brain directory
   */
  public static async importThread(targetBrainDir: string): Promise<string | undefined> {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'Antigravity Thread Zip': ['zip']
      },
      title: 'Select Antigravity Thread Zip Archive to Import'
    });

    if (!fileUris || fileUris.length === 0) {
      return undefined;
    }

    const zipPath = fileUris[0].fsPath;
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    // Look for thread_meta.json
    const metaEntry = zipEntries.find((e) => e.entryName === 'thread_meta.json');
    let threadId: string;

    if (metaEntry) {
      try {
        const metaObj = JSON.parse(metaEntry.getData().toString('utf8'));
        threadId = metaObj.id || `imported_${Date.now()}`;
      } catch {
        threadId = `imported_${Date.now()}`;
      }
    } else {
      threadId = `imported_${Date.now()}`;
    }

    const destThreadDir = path.join(targetBrainDir, threadId);
    const logsDir = path.join(destThreadDir, '.system_generated', 'logs');

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Extract files into correct structure
    for (const entry of zipEntries) {
      if (entry.isDirectory) {
        continue;
      }

      const entryName = entry.entryName.replace(/\\/g, '/');

      if (entryName.startsWith('logs/')) {
        const fileName = path.basename(entryName);
        fs.writeFileSync(path.join(logsDir, fileName), entry.getData());
      } else if (entryName.startsWith('artifacts/scratch/')) {
        const scratchDir = path.join(destThreadDir, 'scratch');
        if (!fs.existsSync(scratchDir)) {
          fs.mkdirSync(scratchDir, { recursive: true });
        }
        const fileName = path.basename(entryName);
        fs.writeFileSync(path.join(scratchDir, fileName), entry.getData());
      } else if (entryName.startsWith('artifacts/')) {
        const fileName = path.basename(entryName);
        fs.writeFileSync(path.join(destThreadDir, fileName), entry.getData());
      } else if (entryName === 'thread_meta.json' || entryName === 'conversation.md') {
        fs.writeFileSync(path.join(destThreadDir, entryName), entry.getData());
      }
    }

    return threadId;
  }

  /**
   * Generates a readable Markdown document from transcript steps
   */
  private static generateReadableMarkdown(thread: ThreadMeta, steps: ThreadStep[]): string {
    const lines: string[] = [];
    lines.push(`# Conversation: ${thread.title}`);
    lines.push(`- **Thread ID**: \`${thread.id}\``);
    lines.push(`- **Created**: ${thread.createdAt}`);
    lines.push(`- **Total Context**: ~${thread.metrics.tokenFormatted} tokens (${thread.metrics.byteSizeFormatted})`);
    lines.push(`- **Total Steps**: ${thread.metrics.stepCount}`);
    lines.push(`- **Artifacts Attached**: ${thread.artifacts.length}`);
    lines.push(`\n---\n`);

    for (const step of steps) {
      const source = step.source || (step.type === 'USER_INPUT' ? 'USER' : 'AGENT');
      const time = step.created_at ? new Date(step.created_at).toLocaleTimeString() : '';

      if (step.type === 'USER_INPUT') {
        lines.push(`### 👤 User (${time})`);
        const cleanContent = (step.content || '')
          .replace(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/gi, '$1')
          .trim();
        lines.push(cleanContent || '*(empty message)*');
        lines.push('');
      } else if (step.type === 'PLANNER_RESPONSE' || source === 'MODEL') {
        lines.push(`### 🤖 Antigravity Assistant (${time})`);
        if (step.thinking) {
          lines.push('<details><summary>Thought Process</summary>\n');
          lines.push(step.thinking.trim());
          lines.push('\n</details>\n');
        }
        if (step.content) {
          lines.push(step.content.trim());
          lines.push('');
        }
        if (step.tool_calls && step.tool_calls.length > 0) {
          lines.push('**Tool Calls:**');
          for (const tc of step.tool_calls) {
            lines.push(`- \`${tc.tool || tc.name || 'tool'}\``);
          }
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }
}
