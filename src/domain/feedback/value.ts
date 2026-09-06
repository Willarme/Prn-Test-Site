/** Browser-profile frequency only: no identity or cross-device tracking. */
export const FEEDBACK_DONE_KEY = "prn_feedback_done";
export const FEEDBACK_VALUE_EVENT = "prn:feedback-value";
export const FEEDBACK_DELAY_MS = 8000;
export function feedbackValueKey(requestId: string): string {
  // v2 intentionally ignores old navigation/click-based armed timestamps.
  return `prn_feedback_value_v2:${requestId}`;
}

export function recordFeedbackValue(requestId: string): void {
  try {
    if (window.localStorage.getItem(FEEDBACK_DONE_KEY)) return;
    const key = feedbackValueKey(requestId);
    window.localStorage.setItem(key, String(Date.now()));
    window.dispatchEvent(new Event(FEEDBACK_VALUE_EVENT));
  } catch { /* Storage unavailable: do not prompt. */ }
}

/** Only inserted into an owner packet after rendering and self-check succeed. */
export function feedbackValueScript(requestId: string): string {
  const key = JSON.stringify(feedbackValueKey(requestId)).replace(/</g, "\\u003c");
  return `<script data-feedback-value>window.addEventListener("load",function(){try{if(!window.localStorage.getItem("${FEEDBACK_DONE_KEY}")){window.localStorage.setItem(${key},String(Date.now()));window.dispatchEvent(new Event("${FEEDBACK_VALUE_EVENT}"));}}catch(e){}},{once:true});</script>`;
}
