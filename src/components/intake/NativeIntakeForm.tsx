import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { flagEnabled } from "@/platform/flags";
import { featureIsLive, type FeatureSnapshot } from "@/platform/features/state";

/** The root and its old-link alias must agree about whether intake is available. */
export function rootIntakeEnabled(snapshot: FeatureSnapshot): boolean {
  // Consent cannot be offered while its mandatory Terms/Privacy pages are hidden.
  return flagEnabled("intake_shell_enabled") && featureIsLive(snapshot, "intake")
    && featureIsLive(snapshot, "explainers");
}

// Same bounded codes as the door adapter. Native POST recovery cannot promise
// that the browser retained a description or file selection after a redirect.
const ERRORS: Record<string, string> = {
  needs_description: "Describe what is happening, then start again.",
  consent: "This page has been updated. Review the note below, then start again.",
  unavailable: "The walkthrough is unavailable right now. Try again shortly.",
  try_again: "We could not finish starting your request. Try again.",
};

/** Native counterpart of the frozen door form; no client script is required. */
export function NativeIntakeForm({ error }: { error?: string | string[] }) {
  const message = typeof error === "string" && Object.hasOwn(ERRORS, error) ? ERRORS[error] : null;
  return (
    <form id="intake" className="card-light" action="/api/intake/start" method="post" encType="multipart/form-data"
      aria-label="Describe a problem">
      {message && <p id="intake-error" role="alert">{message}</p>}
      {message && <p className="hint">Enter your description and choose any files again before submitting.</p>}
      <input type="hidden" name="page_id" value="" />
      <input type="hidden" name="intent_cluster_id" value="" />
      <input type="hidden" name="search_opportunity_id" value="" />
      <input type="hidden" name="problem_family_hint" value="" />
      <input type="hidden" name="landing_path" value="/" />
      <input type="hidden" name="disclosure_content_hash" value={ACTIVE_DISCLOSURE.content_hash} />
      <div className="field">
        <label className="field-label" htmlFor="problem-description">What went wrong? In your own words</label>
        <textarea id="problem-description" name="problem_description" className="inp" rows={4} required minLength={8}
          aria-describedby={`problem-description-help${message ? " intake-error" : ""}`} />
        <p id="problem-description-help" className="hint">Tell us a little more — a sentence is plenty.</p>
        <p className="hint">If there&apos;s an immediate danger to people, or a gas smell or downed line — call 911 or your utility first. We&apos;ll still be here after.</p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="intake-photos">Add photos (optional)</label>
        <input id="intake-photos" className="inp" type="file" name="photos" accept="image/*" multiple />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="intake-video">Add a short video (optional)</label>
        <input id="intake-video" className="inp" type="file" name="video" accept="video/*" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="intake-voice">Add a voice note (optional)</label>
        <input id="intake-voice" className="inp" type="file" name="voice_note" accept="audio/*" aria-describedby="intake-voice-help" />
        <p id="intake-voice-help" className="hint">Voice notes are attached to your request, not transcribed.</p>
      </div>
      <p className="disclosure">{ACTIVE_DISCLOSURE.content_text.split(/(Terms|Privacy Notice)/).map((part, index) =>
        part === "Terms" ? <a key={index} href="/terms" target="_blank" rel="noopener noreferrer">{part}</a>
          : part === "Privacy Notice" ? <a key={index} href="/privacy" target="_blank" rel="noopener noreferrer">{part}</a> : part
      )}</p>
      <button type="submit" className="btn btn-pink">Start with what happened</button>
    </form>
  );
}
