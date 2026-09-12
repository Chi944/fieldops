import { retryRun } from "@/lib/server/service";
import { route } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = route(async (request: Request, context: { params: Promise<{ id: string }> }) => retryRun(request, (await context.params).id));
