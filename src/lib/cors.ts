export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export function withCors(headers: HeadersInit = {}): Headers {
  return new Headers({ ...corsHeaders, ...headers });
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: withCors() });
}
