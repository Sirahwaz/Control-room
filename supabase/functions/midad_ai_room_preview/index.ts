import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Supabase's default project hostname rewrites HTML responses to text/plain.
// Keep this endpoint as a fixed, read-only redirect to the separate GitHub Pages preview.
const PREVIEW_URL = "https://sirahwaz.github.io/Control-room/ai-room.html";

Deno.serve((req: Request) => {
  if (req.method !== "GET") {
    return new Response("method_not_allowed", {
      status: 405,
      headers: { "content-type": "text/plain; charset=utf-8", "allow": "GET", "cache-control": "no-store" }
    });
  }
  return new Response(null, {
    status: 302,
    headers: { "location": PREVIEW_URL, "cache-control": "no-store" }
  });
});
