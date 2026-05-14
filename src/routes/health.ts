import { json } from "../lib/response";

export function health(): Response {
  return json({ ok: true, service: "lyrixa" });
}
