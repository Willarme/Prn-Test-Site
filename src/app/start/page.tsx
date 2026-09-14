import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { rootIntakeEnabled } from "@/components/intake/NativeIntakeForm";
import { readFeatureSnapshot } from "@/platform/features/state";

export const metadata: Metadata = { title: "Start with what happened" };

export default async function StartPage() {
  if (!rootIntakeEnabled(await readFeatureSnapshot())) notFound();
  permanentRedirect("/");
}
