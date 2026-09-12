import { getComparison, updateComparison, deleteComparison } from "@/lib/server/service";
import { route } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = route(async (request: Request, context: { params: Promise<{ id: string }> }) => getComparison(request, (await context.params).id));
export const PATCH = route(async (request: Request, context: { params: Promise<{ id: string }> }) => updateComparison(request, (await context.params).id));
export const DELETE = route(async (request: Request, context: { params: Promise<{ id: string }> }) => deleteComparison(request, (await context.params).id));
