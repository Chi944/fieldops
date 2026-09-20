export interface WorkspaceStatus {
  checkedAt: string;
  mode: "local" | "cloud";
  processing: "ai" | "parse_only";
  uploadsAvailable: boolean;
  capacity: null | {
    comparisons: number; documents: number; bytes: number;
    pendingDeletionDocuments: number; pendingDeletionBytes: number;
    limits: { comparisons: number; documents: number; bytes: number };
  };
  sharedCapacityAvailable: boolean | null;
  uploadIntentTtlHours: number | null;
  jobs: { active: number; waitingQuota: number; failed: number };
}
