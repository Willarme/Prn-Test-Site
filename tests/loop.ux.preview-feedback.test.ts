import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { wirePreviewFeedback } from "@/platform/pages/preview-feedback";

const FILES = ["One Connected Home.dc.html", "Dashboard v3.dc.html", "Trust Network v3.dc.html", "SmartQuote v3.dc.html", "Home Memory v2.dc.html", "Provider OS v2.dc.html"];

function component(file: string, fetcher: typeof fetch) {
  const source = readFileSync(join(process.cwd(), "public/feature", file), "utf8");
  const html = wirePreviewFeedback(source, file);
  const script = [...html.matchAll(/<script\b[^>]*type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
  expect(script).toBeTruthy();
  class Logic {
    state: Record<string, unknown> = {};
    props = {};
    setState(update: Record<string, unknown>) { Object.assign(this.state, update); }
  }
  const scope = { DCLogic: Logic, React: { createRef: () => ({ current: null }) }, fetch: fetcher, ComponentResult: null };
  runInNewContext(script + "\nComponentResult = Component;", scope);
  const Constructor = scope.ComponentResult as unknown as new () => Logic & { renderVals(): Record<string, () => Promise<void>> };
  return { instance: new Constructor(), html, source };
}

describe("all six preview assets wait for real collector receipts", () => {
  for (const file of FILES) {
    it(`${file}: no recorded panel before persistence, then changes once`, async () => {
      let resolve!: (value: Response) => void;
      const fetcher = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
      const { instance } = component(file, fetcher);
      const pending = instance.renderVals().voteYes!();
      expect(instance.state.vote).toBeNull();
      expect(instance.state.saving).toBe(true);
      resolve(Response.json({ ok: true, recorded: "file" }));
      await pending;
      expect(instance.state.vote).toBe("yes");
      expect(instance.state.saving).toBe(false);
      expect(fetcher).toHaveBeenCalledOnce();
    });

    it(`${file}: refused persistence leaves the action available for retry`, async () => {
      const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: false }, { status: 503 }))
        .mockResolvedValueOnce(Response.json({ ok: true, recorded: "file" }));
      const { instance, html } = component(file, fetcher);
      expect(html).toContain('data-preview-scope');
      expect(html).toContain('Interactive concept preview.');
      await instance.renderVals().voteNo!();
      expect(instance.state.vote).toBeNull();
      expect(instance.state.saveError).toContain("could not be saved");
      expect(instance.state.saving).toBe(false);
      expect(html).toContain('role="alert"');
      await instance.renderVals().voteNo!();
      expect(instance.state.vote).toBe("no");
      const records = fetcher.mock.calls.map(call => JSON.parse(call[1].body));
      expect(records[0].id).toBe(records[1].id);
    });

    it(`${file}: signup waits for a saved receipt and retains fields after failure`, async () => {
      const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: false }, { status: 503 }))
        .mockResolvedValueOnce(Response.json({ ok: true, recorded: "file" }));
      const { instance } = component(file, fetcher);
      const fields = instance as unknown as { emailRef: { current: { value: string } | null } };
      fields.emailRef.current = { value: "preview@example.com" };
      await instance.renderVals().submit!();
      expect(instance.state.sent).toBe(false);
      expect(instance.state.thanks).toBe("");
      expect(fields.emailRef.current.value).toBe("preview@example.com");
      await instance.renderVals().submit!();
      expect(instance.state.sent).toBe(true);
      expect(instance.state.thanks).not.toBe("");
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  }
});
