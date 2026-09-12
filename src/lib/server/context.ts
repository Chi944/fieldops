import { configuration, checkRequestBoundary } from "./config";
import { ApiError } from "./errors";
import { LocalRepository } from "./local-repository";
import { CloudRepository } from "./cloud-repository";
import { invitedSession } from "./neon-auth";
import type { Repository } from "./contracts";

export interface RequestContext { ownerId: string; workspaceId: string; repository: Repository; user: { id: string; name: string }; }
export async function authorize(request: Request): Promise<RequestContext> {
  const config = configuration(); checkRequestBoundary(request, config.local);
  if (config.local) return { ownerId: "local-user", workspaceId: "local-workspace", repository: new LocalRepository(), user: { id: "local-user", name: "Local workspace" } };
  if (!config.cloud) throw new ApiError(503, "live_unconfigured", "Live workspaces are not configured. Explore the labelled demonstration instead.");
  const user = await invitedSession();
  return { ownerId: user.id, workspaceId: user.id, repository: new CloudRepository(), user };
}
