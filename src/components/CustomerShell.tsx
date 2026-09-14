import { CUSTOMER_SHELL_CSS, renderCustomerFooter, renderCustomerHeader } from "@/platform/pages/customer-shell";
import type { FeatureSnapshot } from "@/platform/features/state";

export function CustomerHeader({ snapshot }: { snapshot: FeatureSnapshot }) {
  return <><style>{CUSTOMER_SHELL_CSS}</style><div dangerouslySetInnerHTML={{ __html: renderCustomerHeader(snapshot) }} /></>;
}

export function CustomerFooter({ snapshot }: { snapshot: FeatureSnapshot }) {
  return <div dangerouslySetInnerHTML={{ __html: renderCustomerFooter(snapshot) }} />;
}
