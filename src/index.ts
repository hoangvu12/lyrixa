import type { Env } from "./types";
import { optionsResponse } from "./lib/cors";
import { json } from "./lib/response";
import { health } from "./routes/health";
import { lyrics } from "./routes/lyrics";
import { refresh } from "./routes/refresh";
import { search } from "./routes/search";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      if (request.method === "OPTIONS") return optionsResponse();

      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") return health();
      if (request.method === "GET" && url.pathname === "/v1/lyrics") return lyrics(request, env, ctx);
      if (request.method === "GET" && url.pathname === "/v1/search") return search(request, env);
      if (request.method === "POST" && url.pathname === "/v1/refresh") return refresh(request, env);

      return json({ status: "error", message: "Not found" }, { status: 404 });
    } catch (error) {
      return json({ status: "error", code: "internal_error", message: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
    }
  }
};
