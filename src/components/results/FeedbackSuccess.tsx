"use client";

import { useEffect } from "react";
import { recordFeedbackValue } from "@/domain/feedback/value";

/** Mount only with a verified durable save/send receipt, never a URL flag alone. */
export function FeedbackSuccess({ requestId }: { requestId: string }) {
  useEffect(() => { recordFeedbackValue(requestId); }, [requestId]);
  return null;
}
