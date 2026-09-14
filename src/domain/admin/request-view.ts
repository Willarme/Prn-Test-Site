/** Small authenticated table projection. Raw descriptions, media references and
 * homeowner capability tokens do not belong in the client-side search index. */
export interface AdminRequestRow {
  requestId: string;
  enteredAt: string;
  source: string;
  category: string;
  confidence: string | null;
  status: string;
  safety: "normal" | "review" | "urgent" | "unverified";
  packetVersion: number;
  consentReferences: number;
  synthetic: boolean;
}

export const REQUEST_PAGE_SIZE = 20;
export function selectRequestRows(rows: readonly AdminRequestRow[], options: {
  query: string; status: string; category: string; page: number;
}) {
  const query = options.query.trim().slice(0, 200).toLocaleLowerCase();
  const filtered = rows.filter(row =>
    (!query || [row.requestId, row.source, row.category].some(value => value.toLocaleLowerCase().includes(query))) &&
    (!options.status || row.status === options.status) &&
    (!options.category || row.category === options.category)
  );
  const pages = Math.max(1, Math.ceil(filtered.length / REQUEST_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.isFinite(options.page) ? Math.floor(options.page) : 1));
  return { rows: filtered.slice((page - 1) * REQUEST_PAGE_SIZE, page * REQUEST_PAGE_SIZE), total: filtered.length, pages, page };
}

export function requestStatusLabel(status: string): string {
  return ({ draft: "Draft", clarifying: "Clarifying", packet_ready: "Packet ready", closed: "Closed" } as Record<string, string>)[status] ?? status;
}
