import { describe, expect, it } from "vitest";
import { redactSharedText } from "@/domain/privacy/share-text";
import { linkBase } from "@/platform/links/views";
describe("shared narrative projection", () => {
  it("removes email, formatted phone and labelled access codes while retaining repair facts", () => {
    const text = "Warm air since Tuesday. Email jo@example.invalid or call +1 (260) 555-0123. Gate code is 4826. Unit is 8 years old.";
    const shared = redactSharedText(text);
    expect(shared).not.toMatch(/jo@|555-0123|4826/);
    expect(shared).toContain("Warm air since Tuesday.");
    expect(shared).toContain("Unit is 8 years old.");
    expect(text).toContain("4826");
  });
  it("does not rewrite model identifiers, normal measurements or an explicit job address", () => {
    const text = "Model 38MURAQ24; 120 volts; job at 12 Elm Street, Fort Wayne, IN 46802.";
    expect(redactSharedText(text)).toBe(text);
  });
  it("an untrusted Origin cannot select the destination of magic links", () => {
    expect(linkBase(new Request("https://fixture.invalid/api/keep", { headers: { Origin: "https://attacker.invalid" } }))).toBe("https://fixture.invalid");
  });
});
