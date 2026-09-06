/** Carry the exact signed owner proof issued by the real intake route. */
const ownerCookies = new Map<string, string>();

export function ownerCookieFrom(response: Response): string {
  const value = response.headers.get("set-cookie") ?? "";
  const cookie = value.match(/prn_owner_[a-f0-9]+=[^;,]+/)?.[0];
  if (!cookie) throw new Error("Intake did not issue a signed owner cookie");
  return cookie;
}

export function ownerTokenFrom(response: Response): string {
  return ownerCookieFrom(response).split("=").slice(1).join("=");
}

export function rememberOwner(requestId: string, response: Response): void {
  ownerCookies.set(requestId, ownerCookieFrom(response));
}

export function ownerHeaders(requestId: string): { Cookie: string } {
  const cookie = ownerCookies.get(requestId);
  if (!cookie) throw new Error("No intake-issued owner proof for " + requestId);
  return { Cookie: cookie };
}

/** Direct route tests lack a Next request context; use the same issued keep capability. */
export function ownerTokenFor(requestId: string): string {
  return ownerHeaders(requestId).Cookie.split("=").slice(1).join("=");
}
