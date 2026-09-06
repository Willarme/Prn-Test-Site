import { describe, expect, it } from "vitest";
import { MOCKUP_CSS } from "@/domain/packet/mockup-css";
import { PACKET_CSS, renderPacketHtml } from "@/domain/packet/render";
import { PACKET_SCREEN_CSS } from "@/domain/packet/screen-css";
import { referenceInput, thinInput } from "./loop.p1.fixtures";

describe("packet screen repairs preserve the paper contract", () => {
  for (const [name, input] of [["rich", referenceInput], ["thin", thinInput]] as const) {
    it(`${name} restricts responsive additions to screen while retaining all five counters`, () => {
      const { html } = renderPacketHtml(input());
      const styles = [...html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)];
      expect(styles.map(style => ({ attributes: style[1], css: style[2] }))).toEqual([
        { attributes: "", css: `${MOCKUP_CSS}\n${PACKET_CSS}` },
        { attributes: ' media="screen"', css: PACKET_SCREEN_CSS },
      ]);
      const labels = [...html.matchAll(/<div class="n">\d+<\/div><div class="l">([^<]+)<\/div>/g)].map(match => match[1]);
      expect(labels).toEqual(["Facts captured", "Photos", "Checks done", "Made less likely", "Tech-only left"]);
    });
  }
});
