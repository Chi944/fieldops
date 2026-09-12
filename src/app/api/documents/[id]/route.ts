import { deleteDocument } from "@/lib/server/service";
import { route } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const DELETE = route(async (request: Request, context: { params: Promise<{ id: string }> }) => deleteDocument(request, (await context.params).id));
