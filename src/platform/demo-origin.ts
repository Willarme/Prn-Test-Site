/** A fixed deployment setting, never a forwarded-header value supplied by a
 * visitor. Next's internal Request URL can remain loopback behind a tunnel. */
export function demoAwareOrigin(request: Request): string {
  const configured = process.env.PRN_CLIENT_DEMO === "1" ? process.env.PRN_DEMO_PUBLIC_ORIGIN : undefined;
  if (!configured) return new URL(request.url).origin;
  const url = new URL(configured);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Client demo requires one configured HTTPS origin");
  }
  return url.origin;
}
