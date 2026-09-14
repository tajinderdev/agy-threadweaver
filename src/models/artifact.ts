export interface ArtifactItem {
  id: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  conversationId: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: Date;
  modifiedAt: Date;
  isScratch: boolean;
  type: 'markdown' | 'plan' | 'diagram' | 'code' | 'json' | 'other';
  previewSnippet?: string;
}
