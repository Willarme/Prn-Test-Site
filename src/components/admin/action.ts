/** Transport for explicit admin actions. Never retries: a lost response may
 * still mean the server applied the action. Domain records stay on the server. */
export class AdminActionError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "AdminActionError";
  }
}

export async function adminAction<T = Record<string, unknown>>(
  url: string,
  options: { method?: "POST" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "POST", credentials: "same-origin",
      ...(options.body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new AdminActionError("Connection lost. The action may have reached the server. Refresh to check its state before trying again.", null);
  }
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const fallback = response.status === 401 || response.status === 403
      ? "Your session may have ended. Refresh and sign in before continuing."
      : "The action could not be completed. Refresh to check the current state.";
    throw new AdminActionError(typeof data?.error === "string" ? data.error : fallback, response.status);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new AdminActionError("The server returned an unreadable result. Refresh to check whether the action completed before trying again.", response.status);
  }
  return data as T;
}

export function adminActionMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The action could not be completed. Refresh to check its state.";
}
