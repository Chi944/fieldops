import { listComparisons, createComparison } from "@/lib/server/service";
import { route } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = route(listComparisons);
export const POST = route(createComparison);
