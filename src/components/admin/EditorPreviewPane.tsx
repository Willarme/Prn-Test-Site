"use client";

import { useEffect, useRef } from "react";

/**
 * THE LIVE PREVIEW PANE for the page editor.
 *
 * Deliberately knows NOTHING about pages (condition C16): it receives only a
 * URL, reads the editor form's current field values out of the DOM, and
 * re-requests the preview route with them as query parameters, debounced.
 * The preview route is a server component that re-validates the draft and
 * renders the real door template — so this component can never drift from
 * what the page will actually look like, because it renders none of it.
 */
export function EditorPreviewPane({ previewPath }: { previewPath: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const form = document.getElementById("page-edit-form");
    if (!form) return;
    const onInput = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const params = new URLSearchParams();
        for (const [key, value] of new FormData(form as HTMLFormElement).entries()) {
          if (typeof value === "string") params.set(key, value);
        }
        if (frameRef.current) {
          frameRef.current.src = `${previewPath}?${params.toString()}`;
        }
      }, 500);
    };
    form.addEventListener("input", onInput);
    return () => {
      form.removeEventListener("input", onInput);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [previewPath]);

  return (
    <div style={{ position: "sticky", top: 16 }}>
      <div
        className="mono"
        style={{ fontSize: ".78rem", color: "var(--on-dark-mute)", marginBottom: 8 }}
      >
        LIVE PREVIEW — the real door template, your draft. Updates as you type.
      </div>
      <iframe
        ref={frameRef}
        src={previewPath}
        title="Live preview of your draft edits"
        style={{
          width: "100%",
          height: "78vh",
          border: "1px solid var(--line-d)",
          borderRadius: 12,
          background: "#fff",
        }}
      />
    </div>
  );
}
