import { withCors } from "./cors";

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: withCors({
      "Content-Type": "application/json; charset=utf-8",
      ...init.headers
    })
  });
}

export function badRequest(message: string): Response {
  return json({ status: "error", message }, { status: 400 });
}
