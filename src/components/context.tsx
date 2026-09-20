"use client";
import { createContext, useContext } from "react";
import type {
  Comparison,
  Correction,
  FieldValue,
  ProcessingRun,
} from "@/lib/domain/types";

export interface Capabilities {
  mode: "local" | "cloud" | "demo";
  authenticated: boolean;
  canPersist: boolean;
  canUpload: boolean;
  canExtract: boolean;
  processingMode?: "parse_only" | "ai";
  reasons: string[];
  user?: { email?: string };
}
export interface WorkspaceContext {
  comparisons: Comparison[];
  workspaceScope: "personal" | "samples";
  switchWorkspace: (scope: "personal" | "samples") => void;
  capabilities: Capabilities;
  runs: ProcessingRun[];
  toast: (message: string, error?: boolean) => void;
  save: (comparison: Comparison) => Promise<void>;
  create: (name: string, description: string) => Promise<void>;
  remove: (comparison: Comparison) => Promise<void>;
  reset: () => void;
  correct: (
    comparison: Comparison,
    quotationId: string,
    path: string,
    after: FieldValue,
    reason: string,
  ) => Promise<void>;
  refresh: (id: string) => Promise<void>;
}
export const AppContext = createContext<WorkspaceContext | null>(null);
export function useWorkspace() {
  const value = useContext(AppContext);
  if (!value) throw new Error("Workspace context missing");
  return value;
}
export class ApiRequestError extends Error {
  readonly code?: string;
  readonly details?: { documentId: string };

  constructor(
    readonly status: number,
    payload: unknown,
    fallback = "The request could not be completed. Try again.",
  ) {
    const envelope = payload && typeof payload === "object" && "error" in payload
      ? payload.error : undefined;
    const error = envelope && typeof envelope === "object" ? envelope : undefined;
    const message = error && "message" in error && typeof error.message === "string"
      && error.message.trim() ? error.message : fallback;
    super(message);
    this.name = "ApiRequestError";
    if (error && "code" in error && typeof error.code === "string"
      && /^[a-z][a-z0-9_]{0,79}$/.test(error.code)) this.code = error.code;
    const details = error && "details" in error ? error.details : undefined;
    // Keep only the identifier needed for recovery, never arbitrary server
    // details or a supplied URL. The original endpoint still authorizes access.
    if (details && typeof details === "object" && "documentId" in details
      && typeof details.documentId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(details.documentId)) {
      this.details = { documentId: details.documentId };
    }
  }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && typeof init.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(response.status, payload);
  }
  const json = await response.json();
  return json as T;
}
export function revisionOf(c: Comparison): Comparison {
  return {
    ...c,
    revision: c.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}
export function lastCorrection(
  corrections: Correction[],
  quotationId: string,
  path: string,
) {
  return [...corrections]
    .reverse()
    .find((c) => c.quotationId === quotationId && c.path === path);
}
