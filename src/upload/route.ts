/**
 * Upload route factory.
 *
 * Creates a `POST /api/upload` handler that:
 *  1. Optionally enforces authentication (401 when requireAuth is true and no
 *     valid Authorization header / session token is present).
 *  2. Delegates to `handleUpload` for body parsing, size/type validation, and storage.
 *  3. Returns JSON `{ url, filename, size }` on success, or a typed error response.
 *
 * Authentication check is intentionally minimal — the route verifies the
 * presence of a non-empty `Authorization: Bearer <token>` header and delegates
 * real session validation to the caller-supplied `validateToken` function.
 * This keeps the route layer transport-agnostic (works with JWT, opaque tokens,
 * or any other scheme the site uses).
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { UploadConfig, UploadResult } from "./handler.ts";
import { handleUpload } from "./handler.ts";

export interface UploadRouteOptions {
  config: UploadConfig;
  storage: StorageAdapter;
  dataDir: string;
  /**
   * Optional token validator called when `config.requireAuth` is true.
   * Receives the raw `Authorization` header value (or null) and should
   * return true when the request may proceed.
   *
   * When omitted and `config.requireAuth` is true, any non-empty Bearer
   * token is accepted (useful for simple shared-secret setups).
   */
  validateToken?: (authorization: string | null) => boolean | Promise<boolean>;
}

/**
 * Create a POST handler for `POST /api/upload`.
 *
 * Returns a function that accepts a `Request` and resolves to a `Response`.
 * Mount this handler with `app.post("/api/upload", handler)` or equivalent.
 */
export function createUploadHandler(
  options: UploadRouteOptions,
): (req: Request) => Promise<Response> {
  const { config, storage, dataDir, validateToken } = options;

  return async function uploadHandler(req: Request): Promise<Response> {
    // Authentication gate
    if (config.requireAuth) {
      const authorization = req.headers.get("authorization");
      let allowed = false;

      if (validateToken) {
        allowed = await validateToken(authorization);
      } else {
        // Default: require a non-empty Bearer token
        allowed = typeof authorization === "string" &&
          authorization.startsWith("Bearer ") &&
          authorization.slice(7).trim().length > 0;
      }

      if (!allowed) {
        return new Response(
          JSON.stringify({ error: "Authentication required" }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              "WWW-Authenticate": 'Bearer realm="upload"',
            },
          },
        );
      }
    }

    const result = await handleUpload(req, config, storage, dataDir);

    // handleUpload returns a Response on error, UploadResult on success.
    if (result instanceof Response) {
      return result;
    }

    const { publicUrl, filename, sizeBytes } = result as UploadResult;
    return new Response(
      JSON.stringify({ url: publicUrl, filename, size: sizeBytes }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}
