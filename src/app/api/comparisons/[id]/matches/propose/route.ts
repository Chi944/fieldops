import { proposeGroups } from "@/lib/server/service";
import { route } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const POST = route(async (request: Request, context: { params: Promise<{ id: string }> }) => proposeGroups(request, (await context.params).id));
