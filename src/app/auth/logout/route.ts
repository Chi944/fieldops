import { checkRequestBoundary } from "@/lib/server/config";
import { ApiError, json, route } from "@/lib/server/errors";
import { postAuth, withAuthCookies } from "../transport";

export const POST = route(async (request: Request) => {
  checkRequestBoundary(request, false);
  const response = await postAuth(request, "sign-out");
  if (!response.ok) throw new ApiError(503, "sign_out_failed", "Sign-out could not be confirmed. Try again before leaving a shared device.");
  return withAuthCookies(json({ signedOut: true }), response);
});
