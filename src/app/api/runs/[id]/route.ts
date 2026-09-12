import { getRun } from "@/lib/server/service";
import { route } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = route(async (request: Request, context: { params: Promise<{ id: string }> }) => getRun(request, (await context.params).id));
