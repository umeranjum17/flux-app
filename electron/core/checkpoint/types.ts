export interface Checkpoint {
  id: string;
  workspaceId: string;
  sessionId: string;
  messageIndex: number;
  gitCommitSha: string;
  parentSha: string;
  description: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  createdAt: number;
}
