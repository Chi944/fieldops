import { workspaceStatus } from "@/lib/server/workspace-status";
import { route } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = route(workspaceStatus);
