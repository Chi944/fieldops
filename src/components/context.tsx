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
  reasons: string[];
  user?: { email?: string };
}
export interface WorkspaceContext {
  comparisons: Comparison[];
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
  const json = await response.json();
  if (!response.ok)
    throw new Error(
      json.error?.message ?? "The request could not be completed. Try again.",
    );
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
