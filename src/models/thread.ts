import { ArtifactItem } from './artifact';

export interface ThreadStep {
  step_index?: number;
  source?: 'USER_EXPLICIT' | 'MODEL' | 'SYSTEM' | string;
  type?: 'USER_INPUT' | 'PLANNER_RESPONSE' | 'TOOL_CALL' | 'TOOL_RESULT' | string;
  status?: 'DONE' | 'ERROR' | 'RUNNING' | string;
  created_at?: string;
  content?: string;
  thinking?: string;
  tool_calls?: any[];
  truncated_fields?: string[];
}

export type ContextLoadLevel = 'light' | 'moderate' | 'heavy';

export interface WorkspaceColor {
  name: string;
  hex: string;
  bg: string;
  border: string;
  themeColor: string;
}

export interface WorkspaceDetails {
  uri?: string;
  path?: string;
  name?: string;
  corpus?: string;
  color?: string;
  bgColor?: string;
  borderColor?: string;
  themeColor?: string;
  isCurrent?: boolean;
}

export interface ContextMetrics {
  tokenEstimate: number;
  tokenFormatted: string;
  byteSize: number;
  byteSizeFormatted: string;
  stepCount: number;
  messageCount: number;
  loadLevel: ContextLoadLevel;
  percentageOfLimit: number;
}

export type OSSurface = 'windows' | 'macos' | 'linux' | 'wsl';

export interface ThreadMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  threadPath: string;
  brainDir: string;
  metrics: ContextMetrics;
  status: 'active' | 'completed' | 'error' | 'idle';
  workspaceUri?: string;
  workspace?: WorkspaceDetails;
  artifacts: ArtifactItem[];
  firstPrompt?: string;
  lastPrompt?: string;
  lastResponse?: string;
  pinned?: boolean;
  archived?: boolean;
  /** The OS surface this thread originated from (windows, macos, linux, wsl) */
  surface?: OSSurface;
}

export interface ThreadExportBundle {
  version: string;
  exportedAt: string;
  meta: ThreadMeta;
  transcript: ThreadStep[];
  artifacts: {
    fileName: string;
    relativePath: string;
    content: string;
  }[];
}
