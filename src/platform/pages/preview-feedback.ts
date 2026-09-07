/** Functional wiring for replaceable, frozen Claude Design preview assets.
 * Their visible success copy is shown only after the collector confirms a write.
 * Assets remain unchanged; illustrations and non-feedback handlers pass through.
 */
export function wirePreviewFeedback(source: string, page: string): string {
  let html = source.replace(/\r\n/g, "\n");
  const record = `  async __save(rec, next) {
    if (this.__saving) return;
    this.__saving = true;
    this.setState({ saving: true, saveError: "" });
    if (!this.__voteId) this.__voteId = Math.random().toString(36).slice(2, 12);
    try {
      const response = await fetch("/api/signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rec, page: ${JSON.stringify(page)}, id: this.__voteId, at: new Date().toISOString() })
      });
      const receipt = await response.json();
      if (!response.ok || receipt.ok !== true || !receipt.recorded || receipt.recorded === "none") throw new Error("save refused");
      this.setState(next);
    } catch (_) {
      this.setState({ saveError: "Your response could not be saved. Your entries are still here. Try again." });
    } finally {
      this.__saving = false;
      this.setState({ saving: false });
    }
  }

`;
  // Five homeowner pages have a fire-and-forget recorder; Provider OS did not.
  if (html.includes("  __record(rec) {")) {
    html = html.replace(/ {2}__record\(rec\) \{[\s\S]*?(?= {2}renderVals\(\))/, record);
  } else {
    html = html.replace("  renderVals() {", record + "  renderVals() {");
  }
  html = html.replace('      voteOpen: !s.vote,', '      saving: !!s.saving, saveError: s.saveError || "",\n      voteOpen: !s.vote,');
  html = html.replace('voteYes: () => this.setState({ vote: "yes" })', 'voteYes: () => this.__save({ vote: "yes" }, { vote: "yes" })');
  html = html.replace('voteNo: () => this.setState({ vote: "no" })', 'voteNo: () => this.__save({ vote: "no" }, { vote: "no" })');
  html = html.replace(/ {6}sendReasons: [^\n]+/, line => {
    const thanks = line.match(/thanks: ("(?:[^"\\]|\\.)*")/);
    if (!thanks) throw new Error("Preview feedback thanks slot changed");
    return `      sendReasons: () => this.__save({ vote: "no", reasons: this.state.picked }, { thanks: ${thanks[1]} }),`;
  });
  html = html.replace(/ {6}submit: \(\) => \{[\s\S]*?\n {6}\}/, block => {
    const thanks = block.match(/thanks: ("(?:[^"\\]|\\.)*")/);
    if (!thanks) throw new Error("Preview signup thanks slot changed");
    return `      submit: () => {
        const email = this.emailRef.current && this.emailRef.current.value.trim();
        if (!email || email.indexOf("@") < 1) { this.setState({ error: true }); return; }
        const val = r => r && r.current ? r.current.value.trim() : "";
        return this.__save({ vote: "yes", name: val(this.nameRef), email, phone: val(this.phoneRef), zip: val(this.zipRef) }, { error: false, sent: true, thanks: ${thanks[1]} });
      }`;
  });
  const marker = '      <sc-if value="{{ voteOpen }}"';
  html = html.replace(marker, `      <sc-if value="{{ saveError }}" hint-placeholder-val="{{ false }}"><p role="alert" style="border-left:3px solid currentColor;padding:12px;margin:0 0 16px">{{ saveError }}</p></sc-if>
      <sc-if value="{{ saving }}" hint-placeholder-val="{{ false }}"><p role="status" style="margin:0 0 12px">Saving your response…</p></sc-if>
${marker}`);
  html = html.replace(/onClick="{{ (voteYes|voteNo|submit|sendReasons) }}"/g, 'onClick="{{ $1 }}" disabled="{{ saving }}"');
  // Functional scope sits outside the frozen concept artwork and its claims.
  html = html.replace(/<body\b[^>]*>/i, `$&<aside role="note" data-preview-scope style="position:relative;z-index:10;padding:14px 24px;border-bottom:1px solid currentColor;background:#fff4d6;color:#242320;font:14px/1.5 system-ui,sans-serif"><strong>Interactive concept preview.</strong> The illustrated product states, including any “REAL NOW” labels, are examples. The demonstration includes prepared Job Packets and preview controls. Amounts shown are TEST examples.</aside>`);
  return html;
}
