/**
 * THE RESULTS PAGE'S STYLES — MOCKUP-2-results-page.html's CSS, scoped.
 *
 * Every rule below is the approved mockup's rule with its selector prefixed by
 * `.rp` (the results page root) so nothing here restyles the rest of the app,
 * and the mockup's `body` and `.wrap` rules land on `.rp` / `.rp-wrap` instead.
 * The three font families come from the layout's next/font variables (the
 * same Archivo / Public Sans / JetBrains Mono the mockup loads from Google).
 *
 * Design is open (Melissa: "Design is open for Joshua — wording is frozen"),
 * so the additions at the bottom — the 375px pass (checklist D10), the popup's
 * fixed placement and slide-up (decisions §2: bottom-right, slides up, never a
 * dark overlay), the ask-answer rows in the Trust band and the two sub-pages'
 * form controls — are ours. Nothing in the mockup's own rules was changed.
 *
 * A string rather than a .css import so the template is a self-contained,
 * test-renderable component (tests/loop.p2.results-template.test.ts renders
 * it with react-dom/server and diffs its text nodes against the mockup).
 */
export const RESULTS_CSS = `
.rp{
  --ink:#0F1114; --text:#12161A; --muted:#5A6462; --dim:#6B7472;
  --paper:#F7F7F5; --paper2:#EFF0EC; --white:#FFFFFF;
  --pink:#FF2E7E; --pinkd:#C1004F; --pinkl:#FF6FA6; --pink100:#FFC2DA; --pink50:#FDE8F0;
  --green:#1F6B47; --blue:#2D5C68; --teal:#3E6E7A; --amber:#9A6A1F; --on-ink:#F2F3F5;
  --line:rgba(18,22,26,.13); --line-s:rgba(18,22,26,.22);
  --r:4px; --r6:6px;
  --plane:0 3px 0 rgba(18,22,26,.09);
  --bevel:inset 0 1px 0 rgba(255,255,255,.75), inset 0 -1px 0 rgba(18,22,26,.06);
  --mono:var(--font-mono),'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --disp:var(--font-display),'Archivo',system-ui,sans-serif;
  --body:var(--font-body),'Public Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  background:var(--paper2);color:var(--text);font-family:var(--body);margin:0;padding:26px 16px 70px;line-height:1.55;font-size:16px;
}
.rp *{box-sizing:border-box}
.rp .rp-wrap{max-width:920px;margin:0 auto}
.rp .screen{background:var(--paper);border:1px solid var(--line);border-radius:var(--r6);overflow:hidden;box-shadow:var(--plane)}
.rp .nav{display:flex;align-items:center;gap:11px;padding:14px 28px;border-bottom:1px solid var(--line);font-size:.8rem;color:var(--muted);background:var(--white)}
.rp .nav .logo{font-family:var(--disp);font-weight:800;color:var(--text);letter-spacing:-.02em;font-size:.95rem}
.rp .pad{padding:42px 34px}

/* ============ HERO ============ */
.rp .hero{text-align:center;max-width:62ch;margin:0 auto}
.rp .seal{width:64px;height:64px;border-radius:50%;background:rgba(31,107,71,.12);border:1.5px solid var(--green);color:var(--green);
      display:grid;place-items:center;margin:0 auto 20px;box-shadow:var(--bevel)}
.rp .seal svg{width:32px;height:32px}
.rp .kick{font:500 .7rem/1 var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--pinkd);margin-bottom:14px}
.rp h1{font-family:var(--disp);font-size:clamp(2rem,4.7vw,2.9rem);line-height:1.04;letter-spacing:-.035em;margin:0 auto 16px;font-weight:800;max-width:14ch;color:var(--text)}
.rp .lede{font-size:1.06rem;color:var(--muted);margin:0 auto;max-width:48ch;line-height:1.6}

/* ==== WHAT YOU WALK AWAY WITH ==== */
.rp .packet{margin-top:40px}
.rp .eyebrow{font:500 .68rem/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--muted);
         margin:0 0 12px;display:flex;align-items:center;gap:9px;justify-content:center}
.rp .pennant{width:9px;height:9px;background:var(--pink);display:inline-block;
         clip-path:polygon(0 0,100% 0,100% 100%);border-radius:1px}
.rp .ph2{font-family:var(--disp);font-size:clamp(1.5rem,3.4vw,2.15rem);font-weight:800;letter-spacing:-.035em;
     line-height:1.1;margin:0 auto 26px;text-align:center;max-width:20ch}
.rp .ph2 .accent{color:var(--pinkd)}
.rp .bengrid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.rp .benefit{background:var(--white);border:1px solid var(--line);border-radius:var(--r6);padding:30px 26px;
         box-shadow:var(--plane);position:relative;overflow:hidden}
.rp .benefit::before{content:"";position:absolute;inset:0 0 auto 0;height:3px}
.rp .ben-green::before{background:var(--green)}
.rp .ben-blue::before{background:var(--blue)}
.rp .b-ico{width:62px;height:62px;border-radius:var(--r6);display:grid;place-items:center;margin-bottom:18px;
       box-shadow:var(--bevel)}
.rp .b-ico svg{width:32px;height:32px}
.rp .ic-green{background:rgba(31,107,71,.13);color:var(--green)}
.rp .ic-blue{background:rgba(45,92,104,.14);color:var(--blue)}
.rp .b-h{display:block;font-family:var(--disp);font-size:1.22rem;font-weight:800;letter-spacing:-.03em;
     line-height:1.18;margin-bottom:9px}
.rp .c-green{color:var(--green)} .rp .c-blue{color:var(--blue)}
.rp .b-p{font-size:.92rem;color:var(--muted);line-height:1.55;display:block}

/* shared icon tiles */
.rp .ic{width:54px;height:54px;border-radius:var(--r6);display:grid;place-items:center;margin:0 auto 14px;box-shadow:var(--bevel)}
.rp .ic svg{width:28px;height:28px}
.rp .ic-ink{background:rgba(18,22,26,.07);color:var(--text)}
.rp .ic-pink{background:rgba(255,46,126,.14);color:var(--pinkd)}

/* ============ PACKET CTA ============ */
.rp .cta-band{margin-top:34px;text-align:center;background:var(--white);border:1px solid var(--line);
          border-top:3px solid var(--pink);border-radius:var(--r6);padding:34px 34px 30px;box-shadow:var(--plane)}
.rp .cta-eyebrow{font:500 .72rem/1 var(--mono);letter-spacing:.19em;text-transform:uppercase;color:var(--pinkd);margin:0 0 22px}
.rp .cta-h{font-family:var(--disp);font-size:clamp(1.6rem,3.6vw,2.2rem);font-weight:800;letter-spacing:-.036em;
       line-height:1.08;margin:0 auto 12px;max-width:18ch}
.rp .cta-sub{font-size:1rem;color:var(--muted);margin:0 auto 26px;max-width:40ch}
.rp .cta-btn{display:inline-block;background:var(--pinkd);color:#fff;font-family:var(--disp);font-weight:800;
         font-size:1.06rem;letter-spacing:-.015em;padding:17px 40px;border-radius:var(--r);
         text-decoration:none;box-shadow:var(--plane)}
.rp .cta-alt{margin:14px 0 0;font-size:.82rem}
.rp .cta-alt a{color:var(--dim);text-decoration:underline;text-underline-offset:3px}

/* ============ HOME MEMORY ============ */
.rp .hm{margin-top:34px;display:grid;grid-template-columns:1fr 1.12fr;gap:32px;align-items:center;
    background:var(--paper2);border:1px solid var(--line);border-top:3px solid var(--amber);
    border-radius:var(--r6);padding:34px 32px;box-shadow:var(--plane)}
.rp .hm-eyebrow{font:500 .68rem/1 var(--mono);letter-spacing:.17em;text-transform:uppercase;color:var(--amber);margin:0 0 12px}
.rp .hm-h{font-family:var(--disp);font-size:1.62rem;font-weight:800;letter-spacing:-.034em;line-height:1.1;margin:0 0 11px;max-width:18ch}
.rp .hm-p{font-size:.93rem;color:var(--muted);line-height:1.58;margin:0 0 18px}
.rp .hm-fig{margin:0;background:var(--white);border:1px solid var(--line);border-radius:var(--r6);
        padding:16px 16px 12px;box-shadow:var(--plane)}
.rp .fplan{width:100%;height:auto;display:block}
.rp .hm-fig figcaption{font:500 .6rem/1.45 var(--mono);letter-spacing:.07em;text-transform:uppercase;
                   color:var(--dim);text-align:center;margin-top:10px}
.rp ul.saved{list-style:none;margin:0 0 18px;padding:0}
.rp ul.saved li{position:relative;padding:8px 0 8px 27px;font-size:.86rem;line-height:1.45;border-bottom:1px solid var(--line)}
.rp ul.saved li:last-child{border-bottom:0}
.rp ul.saved li::before{content:"";position:absolute;left:3px;top:13px;width:11px;height:6px;
  border-left:2px solid var(--amber);border-bottom:2px solid var(--amber);transform:rotate(-45deg)}
.rp .kicker{font-family:var(--disp);font-size:.9rem;font-weight:800;color:var(--text);letter-spacing:-.018em;
        line-height:1.35;margin:0 0 18px}
.rp .btn{display:block;text-align:center;padding:15px 18px;border-radius:var(--r);font-weight:700;font-size:.97rem;
     text-decoration:none;font-family:var(--disp);letter-spacing:-.012em;box-shadow:var(--plane)}
.rp .btn.fill{background:var(--amber);color:#fff}
.rp .skip{text-align:center;margin-top:12px;font-size:.79rem}
.rp .skip a{color:var(--dim);text-decoration:underline;text-underline-offset:3px}

/* ============ SEND BLOCK ============ */
.rp .trust{margin-top:34px;background:var(--paper2);border:1px solid var(--line);border-top:3px solid var(--blue);
       border-radius:var(--r6);padding:34px 32px;box-shadow:var(--plane)}
.rp .trust-eyebrow{font:500 .68rem/1 var(--mono);letter-spacing:.17em;text-transform:uppercase;color:var(--blue);margin:0 0 12px}
.rp .path.lead .ic52{opacity:1;filter:none}
.rp .trusttop{display:grid;grid-template-columns:.92fr 1.32fr;gap:28px;align-items:center;margin-bottom:26px}
.rp .trust h2{font-family:var(--disp);font-size:1.56rem;margin:0 0 10px;letter-spacing:-.032em;font-weight:800;
          line-height:1.12;max-width:20ch;color:var(--text)}
.rp .trust .sub{font-size:.93rem;color:var(--muted);margin:0;line-height:1.55}
.rp .trustfig{margin:0;background:var(--white);border:1px solid var(--line);border-radius:var(--r6);
          padding:16px 16px 12px;box-shadow:var(--plane)}
.rp .tmap{width:100%;height:auto;display:block}
.rp .trustfig figcaption{font:500 .6rem/1.45 var(--mono);letter-spacing:.07em;text-transform:uppercase;
                     color:var(--dim);text-align:center;margin-top:10px}
.rp .paths{display:grid;grid-template-columns:repeat(3,1fr);gap:13px}
.rp .path{border:1px solid var(--line);border-radius:var(--r6);padding:22px 20px;background:var(--white);box-shadow:var(--plane);
      text-decoration:none;color:inherit;display:block}
.rp .path.lead{background:rgba(31,107,71,.07);border:1.5px solid var(--green);
           box-shadow:0 3px 0 rgba(31,107,71,.22)}
.rp .path.lead b{color:var(--green)}
.rp .ic52{width:56px;height:56px;margin:0 0 14px;border-radius:50%;display:grid;place-items:center}
.rp .ic52 svg{width:56px;height:56px;display:block}
.rp .icq{opacity:.62;filter:grayscale(1)}
.rp .path b{display:block;font-family:var(--disp);font-size:1rem;margin-bottom:6px;letter-spacing:-.022em;font-weight:800}
.rp .path span{font-size:.82rem;color:var(--muted);line-height:1.5;display:block}

/* ============ PRODUCT CARDS ============ */
.rp .prods{margin-top:38px}
.rp .prods h2{font-family:var(--disp);font-size:1.38rem;font-weight:800;letter-spacing:-.03em;margin:0 0 6px;color:var(--text)}
.rp .prods .sub{font-size:.93rem;color:var(--muted);margin:0 0 20px;max-width:56ch;line-height:1.58}
.rp .pgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.rp .p{border:1px solid var(--line);border-radius:var(--r6);padding:24px;background:var(--white);text-decoration:none;color:inherit;
   display:grid;grid-template-columns:auto 1fr;gap:17px;align-items:start;box-shadow:var(--plane)}
.rp .p .num{font:500 .63rem/1 var(--mono);letter-spacing:.12em;color:var(--dim);margin-bottom:8px}
.rp .p b{display:block;font-family:var(--disp);font-size:1.04rem;margin-bottom:8px;letter-spacing:-.025em;line-height:1.24}
.rp .p span.d{font-size:.83rem;color:var(--muted);line-height:1.52;display:block}
.rp .p .arrow{margin-top:12px;font:500 .73rem/1 var(--mono);letter-spacing:.07em;color:var(--pinkd)}
.rp .signoff{margin-top:26px;background:var(--green);border-radius:var(--r6);padding:42px 30px;text-align:center;
         box-shadow:var(--plane);position:relative;overflow:hidden}
.rp .signoff::after{content:"";position:absolute;right:-52px;top:-52px;width:210px;height:210px;border-radius:50%;
                background:rgba(255,255,255,.06)}
.rp .signoff-line{font-family:var(--disp);font-size:clamp(1.55rem,3.6vw,2.3rem);font-weight:800;letter-spacing:-.038em;
              line-height:1.1;margin:0 auto;max-width:20ch;color:#fff;position:relative;z-index:1}
.rp .so-accent{color:var(--pink100)}

.rp .legal{margin-top:38px;padding-top:16px;border-top:1px solid var(--line);font-size:.76rem;color:var(--dim);line-height:1.62;font-style:italic}

/* ============ FEEDBACK ============ */
.rp .fb{background:var(--white);border:1px solid var(--line);border-radius:var(--r6);padding:26px;box-shadow:0 18px 40px -22px rgba(18,22,26,.45);max-width:434px}
.rp .fb h4{font-family:var(--disp);margin:0 0 7px;font-size:1.1rem;font-weight:800;letter-spacing:-.025em;line-height:1.22;color:var(--text)}
.rp .fb .fsub{font-size:.85rem;color:var(--muted);margin:0 0 17px;line-height:1.5}
.rp .chips{display:flex;gap:8px;margin-bottom:19px;flex-wrap:wrap}
.rp .fchip{border:1px solid var(--line-s);border-radius:999px;padding:9px 15px;font-size:.83rem;font-weight:600;background:var(--white);box-shadow:var(--plane)}
.rp .fchip.sel{background:var(--green);border-color:var(--green);color:#fff}
.rp .q{font-size:.85rem;font-weight:700;margin:0 0 9px}
.rp .opts{display:flex;flex-direction:column;gap:7px;margin-bottom:19px}
.rp .opt{border:1px solid var(--line);border-radius:var(--r);padding:11px 13px;font-size:.83rem;color:var(--muted)}
.rp .fbbtn{display:flex;gap:13px;align-items:center}
.rp .fbbtn .fb-send{flex:1;text-align:center;background:var(--green);color:#fff;padding:12px;border-radius:var(--r);font-weight:700;font-size:.89rem;text-decoration:none;font-family:var(--disp);box-shadow:var(--plane)}
.rp .fbbtn .fb-skip{font-size:.81rem;color:var(--dim);text-decoration:underline;text-underline-offset:3px}
@media (max-width:820px){.rp .trusttop,.rp .hm{grid-template-columns:1fr}}
@media (max-width:700px){.rp .paths,.rp .pgrid,.rp .bengrid{grid-template-columns:1fr}}

/* ============ OURS (design open) ============ */
/* the mockup animates the trusted-provider halo with a keyframe it never defines */
@keyframes prnglow{0%,100%{opacity:.14}50%{opacity:.34}}
/* the trigger controls are anchors and buttons that must look like the mockup's */
.rp button{font:inherit;color:inherit;cursor:pointer}
.rp .fchip{cursor:pointer;color:var(--text)}
.rp .opt{display:flex;gap:10px;align-items:flex-start;cursor:pointer;background:var(--white);text-align:left}
.rp .opt input{margin:3px 0 0;flex:none;accent-color:var(--green)}
.rp .opt.sel{border-color:var(--green);color:var(--text);background:rgba(31,107,71,.06)}
.rp .fb textarea.opt{width:100%;min-height:52px;resize:vertical;font-family:var(--body);color:var(--text);display:block}
.rp .fb textarea.opt::placeholder{color:var(--muted)}
.rp .fbbtn .fb-send{border:0}
.rp .fbbtn .fb-send[disabled]{opacity:.45;cursor:default}
.rp .fbbtn .fb-skip{border:0;background:none;padding:0}
.rp .fb-x{position:absolute;top:10px;right:10px;width:32px;height:32px;border:0;background:none;color:var(--dim);display:grid;place-items:center;border-radius:50%}
.rp .fb-x:hover{background:rgba(18,22,26,.06);color:var(--text)}
.rp .fb-x svg{width:16px;height:16px}
/* bottom-right, slides up, never an overlay (decisions §2) */
.rp .fb-dock{position:fixed;right:16px;bottom:16px;z-index:40;width:min(434px,calc(100vw - 32px));
  transform:translateY(24px);opacity:0;pointer-events:none;transition:transform .32s ease,opacity .32s ease}
.rp .fb-dock.open{transform:none;opacity:1;pointer-events:auto}
.rp .fb-dock .fb{position:relative;max-width:none}
/* the friend's answers, inside the Trust band (WORDING 41: one name, who it came from, the reason, one next action) */
.rp .answers{margin:0 0 22px;padding:18px 20px;background:var(--white);border:1px solid var(--line);border-left:3px solid var(--green);border-radius:var(--r6)}
.rp .answers .eyebrow{justify-content:flex-start;color:var(--green)}
.rp .answers ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.rp .answers li{font-size:.9rem;line-height:1.5}
.rp .answers li b{font-family:var(--disp);font-size:1rem;letter-spacing:-.02em}
.rp .answers li .from{color:var(--muted);display:block;font-size:.83rem}
.rp .answers li .why{display:block}
.rp .answers .next{display:inline-block;margin-top:12px;font:500 .73rem/1 var(--mono);letter-spacing:.07em;color:var(--pinkd);text-decoration:none}
/* the two sub-pages (email / send) */
.rp .sub-h{font-family:var(--disp);font-size:clamp(1.5rem,3.4vw,2.15rem);font-weight:800;letter-spacing:-.035em;line-height:1.1;margin:0 0 12px;max-width:22ch;color:var(--text)}
.rp .sub-p{font-size:.98rem;color:var(--muted);margin:0 0 26px;max-width:52ch;line-height:1.58}
.rp .form{display:grid;gap:16px;max-width:520px}
.rp .field{display:grid;gap:6px}
.rp .field label{font:500 .72rem/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.rp .field input{font:inherit;color:var(--text);background:var(--white);border:1px solid var(--line-s);border-radius:var(--r);padding:13px 14px;width:100%}
.rp .field input:focus{outline:2px solid var(--pink);outline-offset:2px}
.rp .field .hint{font-size:.8rem;color:var(--dim)}
.rp .actions{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:6px}
.rp .btn.primary{display:inline-block;background:var(--pinkd);color:#fff;border:0;padding:15px 30px}
.rp .btn.quiet{display:inline-block;background:none;border:0;box-shadow:none;color:var(--dim);text-decoration:underline;text-underline-offset:3px;font-family:var(--body);font-weight:500;font-size:.85rem;padding:0}
.rp .alert{margin:0 0 20px;padding:12px 14px;background:var(--pink50);border:1px solid var(--pink100);border-radius:var(--r6);font-size:.9rem;color:var(--text)}
.rp .share{margin-top:30px;background:var(--white);border:1px solid var(--line);border-top:3px solid var(--blue);border-radius:var(--r6);padding:24px;box-shadow:var(--plane)}
.rp .share .eyebrow{justify-content:flex-start;color:var(--blue)}
.rp .share-text{font-family:var(--mono);font-size:.86rem;line-height:1.5;background:var(--paper2);border:1px solid var(--line);border-radius:var(--r);padding:14px;overflow-wrap:anywhere;margin:0 0 14px;white-space:pre-wrap}
.rp .share .actions .btn{padding:12px 20px;font-size:.9rem}
.rp .btn.line{display:inline-block;background:var(--white);border:1px solid var(--line-s);color:var(--text)}
.rp .fine{font-size:.8rem;color:var(--dim);margin:14px 0 0;line-height:1.55}
.rp .back{display:inline-block;margin-top:28px;font-size:.85rem;color:var(--dim);text-decoration:underline;text-underline-offset:3px}
/* 375px: the whole page, every band (checklist D10) */
@media (max-width:480px){
  .rp{padding:12px 8px 60px}
  .rp .nav{padding:12px 16px}
  .rp .pad{padding:28px 16px}
  .rp .benefit{padding:24px 20px}
  .rp .cta-band{padding:28px 18px 24px}
  .rp .cta-btn{padding:15px 26px;font-size:1rem}
  .rp .hm,.rp .trust{padding:24px 16px}
  .rp .hm-h{max-width:none}
  .rp .path{padding:18px 16px}
  .rp .p{padding:18px;grid-template-columns:1fr}
  .rp .signoff{padding:32px 18px}
  .rp .fb-dock{right:8px;bottom:8px;width:calc(100vw - 16px)}
  .rp .fb{padding:20px}
}
`;
