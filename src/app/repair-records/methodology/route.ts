/** Preserve the established methodology URL; the former proposed spelling has one destination. */
export function GET(request: Request): Response {
  return new Response(null, {
    status: 308,
    headers: {
      Location: new URL("/local-records/methodology", request.url).href,
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
