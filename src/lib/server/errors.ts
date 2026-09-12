export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message); this.name = "ApiError";
  }
}
export function publicError(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  if (error instanceof Error && error.name === "ZodError") return Response.json({ error: { code: "invalid_input", message: "Check the submitted fields and try again." } }, { status: 400 });
  console.error(JSON.stringify({ event: "request_failed", code: "internal_error", type: error instanceof Error ? error.name : "unknown" }));
  return Response.json({ error: { code: "internal_error", message: "The request could not be completed. Your saved work has been preserved." } }, { status: 500 });
}
export function route<T extends unknown[]>(handler: (...args: T) => Promise<Response>) {
  return async (...args: T): Promise<Response> => { try { return await handler(...args); } catch (error) { return publicError(error); } };
}
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
