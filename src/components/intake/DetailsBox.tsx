"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Box 1 — "Details a technician will want." Green check = already have it
 * (auto-detected from their words, typed, or photographed). Nothing is
 * required; the packet is already available. Photo first, type as fallback.
 */
export interface DetailsField {
  field_key: string;
  label: string;
  why_it_matters: string;
  how_to_find: string;
  photo_prompt: string | null;
  accepts: Array<"photo" | "text">;
  priority: "core" | "helpful";
  harvest_to_property_memory: boolean;
  have: { value: string | null; source: string } | null;
}

export function DetailsBox({ requestId, fields }: { requestId: string; fields: DetailsField[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const done = fields.filter((f) => f.have).length;

  async function saveText(fieldKey: string) {
    const value = (typed[fieldKey] ?? "").trim();
    if (!value) return;
    setBusy(fieldKey);
    setErr(null);
    const res = await fetch("/api/intake/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, fields: [{ field_key: fieldKey, value }] }),
    });
    setBusy(null);
    if (!res.ok) {
      setErr("Could not save that — try again.");
      return;
    }
    setOpen(null);
    router.refresh();
  }

  async function upload(fieldKey: string, file: File) {
    setBusy(fieldKey);
    setErr(null);
    const form = new FormData();
    form.set("request_id", requestId);
    form.set("target", fieldKey);
    form.set("file", file);
    const res = await fetch("/api/intake/media", { method: "POST", body: form });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErr(data.error ?? "Upload failed — try again.");
      return;
    }
    setOpen(null);
    router.refresh();
  }

  return (
    <div className="card-light">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h2 className="d3" style={{ margin: 0 }}>
          Details a technician will want
        </h2>
        <span className="pill pill-green">
          {done}/{fields.length} ready
        </span>
      </div>
      <p className="hint" style={{ margin: "6px 0 16px" }}>
        Optional — but every one you add is a question nobody has to ask later. A photo usually
        answers it fastest.
      </p>
      {err && (
        <p role="alert" style={{ color: "var(--pink-ink)", marginBottom: 10 }}>
          {err}
        </p>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {fields.map((f) => {
          const isOpen = open === f.field_key;
          return (
            <li key={f.field_key} style={{ borderTop: "1px solid var(--line-l)", padding: "12px 0" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span
                  aria-hidden
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    flex: "0 0 24px",
                    display: "grid",
                    placeItems: "center",
                    background: f.have ? "var(--green)" : "transparent",
                    border: f.have ? "none" : "1px solid var(--line-l)",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  {f.have ? "✓" : ""}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{f.label}</strong>
                    {f.priority === "core" && !f.have && <span className="pill pill-pink">most useful</span>}
                    {f.harvest_to_property_memory && <span className="pill">kept with your home</span>}
                  </div>
                  {f.have ? (
                    <p className="hint" style={{ marginTop: 4 }}>
                      {f.have.value ?? "photo attached"}{" "}
                      <span style={{ color: "var(--on-light-mute)" }}>
                        · {f.have.source === "auto_detected" ? "from what you wrote" : f.have.source === "photo" ? "from your photo" : "you told us"}
                      </span>
                      {" · "}
                      <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px" }} onClick={() => setOpen(isOpen ? null : f.field_key)}>
                        change
                      </button>
                    </p>
                  ) : (
                    <p className="hint" style={{ marginTop: 4 }}>
                      {f.why_it_matters}{" "}
                      <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px" }} onClick={() => setOpen(isOpen ? null : f.field_key)}>
                        {isOpen ? "close" : "add"}
                      </button>
                    </p>
                  )}
                  {isOpen && (
                    <div style={{ marginTop: 10, padding: 12, background: "var(--chalk)", borderRadius: 4 }}>
                      <p style={{ marginBottom: 8 }}>
                        <strong>Where to find it:</strong> {f.how_to_find}
                      </p>
                      {f.accepts.includes("photo") && (
                        <div style={{ marginBottom: 10 }}>
                          {f.photo_prompt && <p className="hint">{f.photo_prompt}</p>}
                          <input
                            ref={(el) => {
                              fileInputs.current[f.field_key] = el;
                            }}
                            type="file"
                            accept="image/*,video/mp4,video/quicktime"
                            capture="environment"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) upload(f.field_key, file);
                            }}
                          />
                          <button
                            className="btn btn-pink btn-sm"
                            disabled={busy === f.field_key}
                            onClick={() => fileInputs.current[f.field_key]?.click()}
                          >
                            {busy === f.field_key ? "Uploading…" : "📷 Snap or upload a photo"}
                          </button>
                        </div>
                      )}
                      {f.accepts.includes("text") && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            className="inp"
                            placeholder="or type it here"
                            value={typed[f.field_key] ?? ""}
                            onChange={(e) => setTyped({ ...typed, [f.field_key]: e.target.value })}
                            onKeyDown={(e) => e.key === "Enter" && saveText(f.field_key)}
                          />
                          <button className="btn btn-ghost btn-sm" disabled={busy === f.field_key} onClick={() => saveText(f.field_key)}>
                            Save
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
