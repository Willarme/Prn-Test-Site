"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CANNOT_REACH_FIELD_VALUE } from "@/domain/intake/extract";

/**
 * Box 1 — "Details a technician will want." Green check = already have it
 * (auto-detected from their words, typed, photographed, or confirmed).
 * Nothing is required; the packet is already available. Photo first, type as
 * fallback.
 *
 * Campaign track P4 (2026-09-05), the confirm ladder (Coverage Standard §4.3,
 * §4.4) and the no-dead-end rule (§7.4):
 *   - a field that already has an answer is a collapsed line, never an empty
 *     box (never ask twice);
 *   - a value read off a photo is shown as "We read X — is that right?" with
 *     Yes / Fix it; Yes stores it with source "confirmed";
 *   - a label photo that yielded nothing says so and opens the typed input;
 *   - every open field carries "I can't get to this", which records the gap
 *     so the packet can list it under Still unknown with the reason;
 *   - the address of the house is the first group when it is missing, and it
 *     is skippable (the packet page asks again).
 */
export interface DetailsField {
  field_key: string;
  label: string;
  why_it_matters: string;
  how_to_find: string;
  photo_prompt: string | null;
  accepts: Array<"photo" | "text">;
  priority: "core" | "helpful";
  optional_group?: "context" | "history" | "access";
  choices?: { value: string; label: string }[];
  harvest_to_property_memory: boolean;
  have: { value: string | null; source: string; confirmed_from_photo?: boolean } | null;
  conflict?: { held_value: string; reported_values: string[] };
}

export interface DetailsAddress {
  street: string;
  city_state_zip: string;
  property_type: string | null;
  storeys: string | null;
}

/** Fields whose photo is a rating plate we try to read. Others are just attached. */
const LABEL_FIELDS = new Set(["unit_model_serial"]);

const PROPERTY_TYPES = ["House", "Condo or townhouse", "Mobile home", "Other"];
const STOREYS = ["1", "2", "3 or more"];

function provenance(source: string, confirmedFromPhoto = false): string {
  switch (source) {
    case "auto_detected":
      return "from what you wrote";
    case "photo":
      return "from your photo";
    case "confirmed":
      return confirmedFromPhoto ? "from your photo, confirmed" : "confirmed by you";
    default:
      return "you told us";
  }
}

export function DetailsBox({
  requestId,
  ownerKey,
  fields,
  address,
  labelConfidence,
}: {
  requestId: string;
  ownerKey?: string;
  fields: DetailsField[];
  address: DetailsAddress | null;
  labelConfidence: Record<string, "high" | "medium" | "low">;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addressOpen, setAddressOpen] = useState<boolean>(address === null);
  const [addr, setAddr] = useState<DetailsAddress>({
    street: address?.street ?? "",
    city_state_zip: address?.city_state_zip ?? "",
    property_type: address?.property_type ?? null,
    storeys: address?.storeys ?? null,
  });
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const plannedFields = fields.filter(f => !f.optional_group);
  const done = plannedFields.filter((f) => !f.conflict && f.have && f.have.value !== CANNOT_REACH_FIELD_VALUE &&
    !(LABEL_FIELDS.has(f.field_key) && f.have.source === "photo" && f.have.value === null)).length;

  async function post(body: Record<string, unknown>, failMessage: string): Promise<boolean> {
    const res = await fetch("/api/intake/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, k: ownerKey, ...body }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (data?.safety?.intake_may_continue === false && typeof data.next === "string" && /^\/safety\/[a-z0-9_]+$/.test(data.next)) {
      router.replace(data.next);
      return false;
    }
    if (!res?.ok) {
      setErr(failMessage);
      return false;
    }
    return true;
  }

  async function saveText(fieldKey: string) {
    const value = (typed[fieldKey] ?? "").trim();
    if (!value) return;
    setBusy(fieldKey);
    setErr(null);
    const ok = await post({ fields: [{ field_key: fieldKey, value }] }, "Could not save that — try again.");
    setBusy(null);
    if (!ok) return;
    setOpen(null);
    router.refresh();
  }

  async function confirm(fieldKey: string, value: string) {
    setBusy(fieldKey);
    setErr(null);
    const ok = await post(
      { fields: [{ field_key: fieldKey, value, confirmed: true }] },
      "Could not save that — try again."
    );
    setBusy(null);
    if (!ok) return;
    router.refresh();
  }

  async function cannotReach(fieldKey: string) {
    setBusy(fieldKey);
    setErr(null);
    const ok = await post(
      { fields: [{ field_key: fieldKey, value: CANNOT_REACH_FIELD_VALUE }] },
      "Could not save that — try again."
    );
    setBusy(null);
    if (!ok) return;
    setOpen(null);
    router.refresh();
  }

  async function saveAddress() {
    const street = addr.street.trim();
    const cityStateZip = addr.city_state_zip.trim();
    if (!street || !cityStateZip) {
      setErr("The street and the city, state and ZIP are the two lines the packet needs.");
      return;
    }
    setBusy("address");
    setErr(null);
    const ok = await post(
      {
        address: {
          street,
          city_state_zip: cityStateZip,
          property_type: addr.property_type,
          storeys: addr.storeys,
        },
      },
      "Could not save the address — try again."
    );
    setBusy(null);
    if (!ok) return;
    setAddressOpen(false);
    router.refresh();
  }

  async function upload(fieldKey: string, file: File) {
    setBusy(fieldKey);
    setErr(null);
    const form = new FormData();
    form.set("request_id", requestId);
    if (ownerKey) form.set("k", ownerKey);
    form.set("target", fieldKey);
    form.set("file", file);
    const res = await fetch("/api/intake/media", { method: "POST", body: form }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setErr(data?.error ?? "Upload failed — try again.");
      return;
    }
    setOpen(null);
    router.refresh();
  }

  function typedInput(f: DetailsField, placeholder = "or type it here") {
    return (
      <div style={{ display: "flex", gap: 8 }}>
        {f.choices ? (
          <select className="inp" aria-label={f.label} value={typed[f.field_key] ?? ""}
            onChange={(e) => setTyped({ ...typed, [f.field_key]: e.target.value })}>
            <option value="">Choose an answer (optional)</option>
            {f.choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        ) : <input
          className="inp"
          aria-label={f.label}
          placeholder={placeholder}
          value={typed[f.field_key] ?? ""}
          onChange={(e) => setTyped({ ...typed, [f.field_key]: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && saveText(f.field_key)}
        />}
        <button className="btn btn-ghost btn-sm" disabled={busy === f.field_key} onClick={() => saveText(f.field_key)}>
          Save
        </button>
      </div>
    );
  }

  function escapeHatch(f: DetailsField) {
    return (
      <button
        className="btn btn-ghost btn-sm"
        style={{ padding: "2px 8px" }}
        disabled={busy === f.field_key}
        onClick={() => cannotReach(f.field_key)}
        data-escape={f.field_key}
      >
        I can&apos;t get to this
      </button>
    );
  }

  function renderField(f: DetailsField) {
          const isOpen = open === f.field_key;
          const have = f.have;
          const unreachable = have?.value === CANNOT_REACH_FIELD_VALUE;
          const readFromPhoto = have !== null && have.source === "photo" && have.value !== null;
          const photoOnly = have !== null && have.source === "photo" && have.value === null;
          const unreadLabel = photoOnly && LABEL_FIELDS.has(f.field_key);
          const held = have !== null && !unreachable && !readFromPhoto && !unreadLabel;
          const confidence = labelConfidence[f.field_key];
          return (
            <li key={f.field_key} style={{ borderTop: "1px solid var(--line-l)", padding: "12px 0" }} data-field={f.field_key}>
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
                    background: !f.conflict && (held || readFromPhoto) ? "var(--green)" : "transparent",
                    border: !f.conflict && (held || readFromPhoto) ? "none" : "1px solid var(--line-l)",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  {!f.conflict && (held || readFromPhoto) ? "✓" : ""}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{f.label}</strong>
                    {f.priority === "core" && !have && <span className="pill pill-pink">most useful</span>}
                    {f.harvest_to_property_memory && <span className="pill">kept with your home</span>}
                  </div>

                  {held && (
                    <p className="hint" style={{ marginTop: 4 }} data-held={f.field_key}>
                      {f.choices?.find(c => c.value === have.value)?.label ?? have.value ?? "photo attached"}{" "}
                      <span style={{ color: "var(--on-light-mute)" }}>· {provenance(have.source, have.confirmed_from_photo)}</span>
                      {" · "}
                      <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px" }} onClick={() => setOpen(isOpen ? null : f.field_key)}>
                        change
                      </button>
                    </p>
                  )}

                  {f.conflict && (
                    <div role="status" data-field-conflict={f.field_key} style={{ marginTop: 8 }}>
                      <p style={{ marginBottom: 8 }}>
                        Kept: <strong>{f.conflict.held_value}</strong>. Later you reported: <strong>{f.conflict.reported_values.join(" / ")}</strong>.
                        {" "}Which value belongs to this system? Both reports stay in your packet until you choose.
                      </p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {[f.conflict.held_value, ...f.conflict.reported_values].map(value => (
                          <button key={value} className="btn btn-ghost btn-sm" disabled={busy === f.field_key} onClick={() => confirm(f.field_key, value)}>
                            Use {value}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {readFromPhoto && !f.conflict && (
                    <div style={{ marginTop: 6 }} data-confirm={f.field_key}>
                      <p style={{ marginBottom: 6 }}>
                        {confidence === "low" ? "Our best read is " : "We read "}
                        <strong>{have.value}</strong> — is that right?
                      </p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-pink btn-sm" disabled={busy === f.field_key} onClick={() => confirm(f.field_key, have.value!)}>
                          Yes
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={busy === f.field_key} onClick={() => setOpen(isOpen ? null : f.field_key)}>
                          Fix it
                        </button>
                      </div>
                    </div>
                  )}

                  {unreadLabel && (
                    <div style={{ marginTop: 6 }} data-unread={f.field_key}>
                      <p style={{ marginBottom: 6 }}>We could not read that one. The photo is in your packet.</p>
                      {typedInput(f, "Type the model and serial here")}
                      <p className="hint" style={{ marginTop: 6 }}>{!f.optional_group && escapeHatch(f)}</p>
                    </div>
                  )}

                  {photoOnly && !unreadLabel && (
                    <p className="hint" style={{ marginTop: 4 }}>
                      photo attached <span style={{ color: "var(--on-light-mute)" }}>· {provenance(have.source)}</span>
                      {f.accepts.includes("text") && (
                        <>
                          {" · "}
                          <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px" }} onClick={() => setOpen(isOpen ? null : f.field_key)}>
                            add a note
                          </button>
                        </>
                      )}
                    </p>
                  )}

                  {unreachable && (
                    <p className="hint" style={{ marginTop: 4 }} data-unreachable={f.field_key}>
                      You could not get to this. It goes in the packet as still unknown.{" "}
                      <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px" }} onClick={() => setOpen(isOpen ? null : f.field_key)}>
                        {isOpen ? "close" : "add it now"}
                      </button>
                    </p>
                  )}

                  {!have && (
                    <p className="hint" style={{ marginTop: 4 }}>
                      {f.why_it_matters}{" "}
                      <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px" }} onClick={() => setOpen(isOpen ? null : f.field_key)}>
                        {isOpen ? "close" : "add"}
                      </button>{" "}
                      {!f.optional_group && escapeHatch(f)}
                    </p>
                  )}

                  {isOpen && (
                    <div style={{ marginTop: 10, padding: 12, background: "var(--chalk)", borderRadius: 4 }}>
                      <p style={{ marginBottom: 8 }}>
                        <strong>{f.optional_group ? "How to answer:" : "Where to find it:"}</strong> {f.how_to_find}
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
                      {f.accepts.includes("text") && typedInput(f)}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
  }

  return (
    <div className="card-light">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h2 className="d3" style={{ margin: 0 }}>
          Details a technician will want
        </h2>
        <span className="pill pill-green">
          {done}/{plannedFields.length} ready
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

      {/* The address of the house — first when missing, one line when held. */}
      <div style={{ borderTop: "1px solid var(--line-l)", padding: "12px 0" }} data-address-group>
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
              background: address ? "var(--green)" : "transparent",
              border: address ? "none" : "1px solid var(--line-l)",
              color: "#fff",
              fontWeight: 700,
            }}
          >
            {address ? "✓" : ""}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong>The address of the house</strong>
              {!address && <span className="pill pill-pink">goes on the packet</span>}
            </div>
            {address && !addressOpen ? (
              <p className="hint" style={{ marginTop: 4 }}>
                {address.street}, {address.city_state_zip}
                {address.property_type ? ` · ${address.property_type}` : ""}
                {address.storeys ? ` · ${address.storeys} storey${address.storeys === "1" ? "" : "s"}` : ""}
                {" · "}
                <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px" }} onClick={() => setAddressOpen(true)}>
                  change
                </button>
              </p>
            ) : !addressOpen ? (
              <p className="hint" style={{ marginTop: 4 }}>
                Where the job is.{" "}
                <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px" }} onClick={() => setAddressOpen(true)}>
                  add
                </button>
              </p>
            ) : (
              <div style={{ marginTop: 10, padding: 12, background: "var(--chalk)", borderRadius: 4 }}>
                <p className="hint" style={{ marginBottom: 8 }}>
                  Where the job is. The packet prints the street and town; the rest is optional.
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  <input
                    className="inp"
                    aria-label="Street address"
                    placeholder="Street address"
                    value={addr.street}
                    onChange={(e) => setAddr({ ...addr, street: e.target.value })}
                  />
                  <input
                    className="inp"
                    aria-label="City, state ZIP"
                    placeholder="City, state ZIP"
                    value={addr.city_state_zip}
                    onChange={(e) => setAddr({ ...addr, city_state_zip: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && saveAddress()}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select
                      className="inp"
                      aria-label="House type (optional)"
                      value={addr.property_type ?? ""}
                      onChange={(e) => setAddr({ ...addr, property_type: e.target.value || null })}
                    >
                      <option value="">House type (optional)</option>
                      {PROPERTY_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <select
                      className="inp"
                      aria-label="Storeys (optional)"
                      value={addr.storeys ?? ""}
                      onChange={(e) => setAddr({ ...addr, storeys: e.target.value || null })}
                    >
                      <option value="">Storeys (optional)</option>
                      {STOREYS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-pink btn-sm" disabled={busy === "address"} onClick={saveAddress}>
                      Save the address
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={busy === "address"} onClick={() => setAddressOpen(false)}>
                      Skip for now
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {fields.filter(f => !f.optional_group).map(renderField)}
      </ul>
      {(["context", "history", "access"] as const).map(group => {
        const grouped = fields.filter(f => f.optional_group === group);
        if (!grouped.length) return null;
        const labels = { context: "More about the system and what you need", history: "Service history", access: "Access and visit preferences" };
        return <details key={group} data-optional-group={group} style={{ borderTop: "1px solid var(--line-l)", padding: "14px 0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>{labels[group]} <span className="hint">· optional</span></summary>
          <p className="hint" style={{ marginTop: 8 }}>Add what you know. Leave any item blank to skip it.</p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>{grouped.map(renderField)}</ul>
        </details>;
      })}
    </div>
  );
}
