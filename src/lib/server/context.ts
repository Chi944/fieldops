import { configuration, checkRequestBoundary } from "./config";
import { ApiError } from "./errors";
import { LocalRepository } from "./local-repository";
import { CloudRepository } from "./cloud-repository";
import { authClient, adminClient } from "./supabase";
import type { Repository } from "./contracts";

export interface RequestContext { ownerId: string; workspaceId: string; repository: Repository; user: { id: string; name: string }; }
export async function authorize(request: Request): Promise<RequestContext> {
  const config = configuration(); checkRequestBoundary(request, config.local);
  if (config.local) return { ownerId: "local-user", workspaceId: "local-workspace", repository: new LocalRepository(), user: { id: "local-user", name: "Local workspace" } };
  if (!config.supabase) throw new ApiError(503, "live_unconfigured", "Live workspaces are not configured. Explore the labelled demonstration instead.");
  const supabase = await authClient(); const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new ApiError(401, "sign_in_required", "Sign in with an invited GitHub account.");
  // Identity data comes from the OAuth provider; editable user_metadata is never used for authorization.
  const identity = data.user.identities?.find((i) => i.provider === "github");
  const githubId = String(identity?.identity_data?.provider_id ?? identity?.identity_data?.sub ?? "");
  const { data: invite, error: inviteError } = await adminClient().from("invited_accounts").select("github_user_id").eq("github_user_id", githubId).eq("active", true).maybeSingle();
  if (inviteError) throw new ApiError(503, "invites_unavailable", "Private workspace access could not be verified.");
  if (!invite) throw new ApiError(403, "invite_required", "This GitHub account has not been invited to the private pilot. The sample workspace is available without sign-in.");
  return { ownerId: data.user.id, workspaceId: data.user.id, repository: new CloudRepository(), user: { id: data.user.id, name: data.user.email ?? "Invited buyer" } };
}
