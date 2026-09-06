/** A prepared sample document, served as a public asset without runtime storage. */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(null, {
    status: 307,
    headers: {
      location: "/sample-ac-job-packet.pdf",
      "cache-control": "public, max-age=300",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
