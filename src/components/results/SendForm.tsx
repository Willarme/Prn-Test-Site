"use client";

import { useActionState, useState } from "react";
import type { ShareState } from "@/app/results/[request_id]/send/actions";

/**
 * "I already have someone" — the form, then the message (campaign track P2).
 *
 * Two optional fields: the person's name and their phone or email. Neither is
 * required, neither is stored; they only address the sms:/mailto: link the
 * homeowner's own phone opens. Submitting asks the server action for the
 * signed packet link and the share text, which then shows on screen with a
 * copy button and the two one-tap targets.
 *
 * New homeowner-visible strings (WORDING: fact, second person, no negation,
 * may/can not will) — all listed in the P2 report:
 *   "Their name" · "Their phone or email" · "Make my link"
 *   "Your message" · "Copy" · "Copied" · "Send by text" · "Send by email"
 *   "This link can be turned off later. A packet already opened stays with
 *    the person who opened it."  (decisions 7 and 8, recommendation A: say
 *    so in one sentence at the share moment)
 */
export function SendForm({
  requestId,
  ownerKey,
  action,
}: {
  requestId: string;
  ownerKey?: string;
  action: (prev: ShareState, formData: FormData) => Promise<ShareState>;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as ShareState);
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the text is on screen to select by hand */
    }
  }

  return (
    <>
      {state.status === "error" && (
        <p className="alert" role="alert">
          {state.error}
        </p>
      )}

      <form className="form" action={formAction}>
        <input type="hidden" name="request_id" value={requestId} />
        {ownerKey && <input type="hidden" name="k" value={ownerKey} />}
        <div className="field">
          <label htmlFor="person">Their name</label>
          <input id="person" name="person" type="text" maxLength={120} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="contact">Their phone or email</label>
          <input id="contact" name="contact" type="text" inputMode="email" maxLength={320} autoComplete="off" />
        </div>
        <div className="actions">
          <button type="submit" className="btn primary" disabled={pending}>
            Make my link
          </button>
        </div>
      </form>

      {state.status === "ready" && (
        <div className="share" data-testid="share-message">
          <p className="eyebrow">
            <i className="pennant" aria-hidden="true" />
            Your message
          </p>
          <pre className="share-text">{state.message.text}</pre>
          <div className="actions">
            <a className="btn line" href={state.message.share_url} target="_blank" rel="noopener noreferrer">
              Preview what they will open
            </a>
            <button type="button" className="btn line" onClick={() => copy(state.message.text)}>
              {copied ? "Copied" : "Copy"}
            </button>
            <a className="btn line" href={state.message.sms_href}>
              Send by text
            </a>
            <a className="btn line" href={state.message.mailto_href}>
              Send by email
            </a>
          </div>
          <p className="fine">
            This link can be turned off later. A packet already opened stays with the person who
            opened it.
          </p>
        </div>
      )}
    </>
  );
}
