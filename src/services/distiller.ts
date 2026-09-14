import { ThreadMeta, ThreadStep } from '../models/thread';

export class ContextDistiller {
  /**
   * Generates a concise briefing prompt to bridge context into a fresh thread
   */
  public static generateBriefing(thread: ThreadMeta, steps: ThreadStep[]): string {
    const userInputs = steps.filter((s) => s.type === 'USER_INPUT' && s.content);
    const agentResponses = steps.filter((s) => s.type === 'PLANNER_RESPONSE' && s.content);

    const initialGoal = userInputs.length > 0
      ? this.cleanUserContent(userInputs[0].content || '')
      : thread.title;

    const latestUserRequest = userInputs.length > 1
      ? this.cleanUserContent(userInputs[userInputs.length - 1].content || '')
      : initialGoal;

    const lastAgentSummary = agentResponses.length > 0
      ? this.extractExecutiveSummary(agentResponses[agentResponses.length - 1].content || '')
      : 'Work in progress.';

    // Extract tools used or touched files
    const touchedFiles = new Set<string>();
    for (const s of steps) {
      if (s.tool_calls) {
        for (const tc of s.tool_calls) {
          const args = tc.arguments || tc.args || {};
          const filePath = args.TargetFile || args.AbsolutePath || args.SearchPath || args.DirectoryPath;
          if (filePath && typeof filePath === 'string') {
            touchedFiles.add(filePath.replace(/\\/g, '/'));
          }
        }
      }
    }

    const artifactList = thread.artifacts.map((a) => `- [${a.name}](${a.absolutePath.replace(/\\/g, '/')}) (${a.sizeFormatted})`).join('\n');
    const touchedFilesList = Array.from(touchedFiles).slice(0, 15).map((f) => `- \`${f}\``).join('\n');

    return `### Context Continuation from Prior Thread
> **Previous Thread ID**: \`${thread.id}\` (Reference: [Fork Thread Context](command:threadweaver.forkFreshThread?%5B%22${thread.id}%22%5D))
> **Original Thread Context Size**: ~${thread.metrics.tokenFormatted} tokens (${thread.metrics.byteSizeFormatted}) across ${thread.metrics.stepCount} steps.

#### 1. Initial Objective
${initialGoal}

#### 2. Latest State & Accomplishments
${lastAgentSummary}

#### 3. Active Artifacts
${artifactList || '*(No formal artifacts generated)*'}

#### 4. Primary Files Touched
${touchedFilesList || '*(None tracked)*'}

#### 5. Latest Pending Request
${latestUserRequest}

---
*Please continue the work seamlessly in this fresh, lightweight context window based on the summary and artifacts above.*`;
  }

  private static cleanUserContent(raw: string): string {
    return raw
      .replace(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/gi, '$1')
      .replace(/<USER_INFORMATION>[\s\S]*?<\/USER_INFORMATION>/gi, '')
      .trim();
  }

  private static extractExecutiveSummary(raw: string): string {
    const lines = raw.split('\n');
    // Grab first 8 non-empty lines
    const summaryLines = lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('```'))
      .slice(0, 8);
    return summaryLines.join('\n') || raw.slice(0, 400);
  }
}
