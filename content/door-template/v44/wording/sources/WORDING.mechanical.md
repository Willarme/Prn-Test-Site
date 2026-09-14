# PRN wording rules

Every wording correction [[Melissa]] has made, turned into something that can be applied without her.

---

## The rule that governs all the others

**Draft it. Do not ask.**

This document exists so drafts land closer, not so there is a new approval step. Her instruction, verbatim:

> *"you DONT need my approval on thing slike this . ASSUME i will be testing the system COMPLETLEY when built and keep an internal record of ALL items you want me to look at and double check wording and action wise checklists for then. but do NOT wait for me now as that is wasting effort and time."*

So: make the call, write the line, note what you decided, keep moving. Hold a running list of things worth her eye later. Interrupt her only when you genuinely cannot proceed without an answer — never to ask permission, and never to raise a risk about a sentence nobody was going to write.

A rule in here that creates a queue for her attention is a failed rule. There is exactly one deliberate exception, rule 40 on humour, because she asked for jokes to come as a numbered list.

---

# The freeze rule

**Draft-do-not-ask applies to NEW work only. A page she has edited is frozen.**

Her words, 2026-09-04:

> *"if I'm actively editing pages or gave you wording edits on a page you would NOT go back and change things on that page as i already looked and read and approved a certian number of that and gave you just the edits i wanted changed. the rest is essentially something i said yes this is good and works so for those they should be frozen unless i come back and edit it."*

> *"so the draft it dont ask is for NEW items. that i havent looked at yet. Dont ask as ill be looking at it eventually anyway and that makes duplicate work. Dont change things (you can suggest or giv eme a revised copy with your suggestions) if i already gave at least one wording edit on."*

**Why.** A page she has edited has been read. Sending back edits on four lines is not a partial review, it is a full read that produced four changes, and everything she left alone is a yes. Touching an unedited line after that is overwriting an approval she already gave, silently, and it makes her re-read work she has already signed off. It also destroys the signal she is paying for: if the page changes under her between reviews, her next read cannot trust that anything she approved is still there.

**The two states.**

| State | What it means | What you may do |
|---|---|---|
| **New** | She has never looked at it | Draft it. Do not ask. She will see it when she sees it, and asking first makes her do the job twice. |
| **Touched** | She has given at least one wording edit on it | Frozen. Change only what her instruction names. Everything else is approved by omission. |

**A page moves from New to Touched the moment she sends the first wording edit on it, and it never moves back.**

**What to do when a frozen line is wrong.** Do not fix it in place, and do not stop to ask. Say what you would change and why, in the reply, and offer a revised copy alongside the live one. Her call, on her clock, and the page keeps working in the meantime.

**Scope of an instruction.** An instruction authorises what it names and nothing adjacent. "Even up these blurbs" licenses evening the blurbs. "Cite the prices" licenses citations, not a clause explaining the price. When an instruction cannot be carried out without touching approved wording, do it, then say which approved words moved and offer them back.

**Suggestions are always welcome, and they are the job.** Her words: *"you cna always give suggestions thats your job to see and think of wha twe cannot."* The rule governs edits to a page, not what may be raised.

---

## How to use this

Each rule carries three things. The **rule**. The **why**, which is the mechanism, because a rule you understand transfers to sentences nobody has written yet. And **how to find more**, which is the point of the whole document: a test that catches new instances of the same class rather than the specific words already banned.

1. Before writing, read the six most-corrected rules below. They cover most of what goes wrong.
2. After writing, run the mechanical checks. They find candidates, they do not deliver verdicts.
3. Run the detection heuristics by hand on whatever the checks flagged, plus the hero, the headline, and every sentence the page says about itself. Those three places produce most violations.
4. Anything no rule covers, use the five questions at the end.

**Rules are written as what to do**, not as a pile of prohibitions, because a rule that only forbids leaves you without a move. Where a "never" survived, it is carrying weight the positive form could not.

**Once approved, the words are frozen.** Design work on an approved page must not change a single visible character. `_textdiff.js` in this folder enforces that byte for byte, which is how v7 through v16 were rebuilt from the ground up without losing a word of approved copy.

---

## The six that cost the most time

Ranked by how many separate occasions [[Melissa]] had to raise them. A rule corrected twenty-four times is not a preference, it is a standard nobody wrote down.

1. **Cut any word, clause or section that does not hand over a fact, give a reason to act, or kill a fear the reader has right now.** *(24×, rule 15)*
2. **Do not name the fear you are denying. Delete the negative half and let the positive fact stand alone.** *(14×, rule 1)* The contrast exception on that rule is the one Melissa flagged specifically.
3. **Second person, naming her own concrete thing: "your AC", never "the unit", never a line that would fit unchanged on another page.** *(12×, rule 20)*
4. **Hedge every outcome claim, and never state what a [[Provider|provider]] does, only what to ask them.** *(12×, rule 25)*
5. **Change only the lines the instruction names, in the smallest span that satisfies it, and revert anything else you touched.** *(11×, rule 44)*
6. **Publish a number only when you can say out loud who published it, for where, over what window, and out of how many.** *(10×, rule 26)*

---

## Where this came from

Mined from **220 separate corrections** across 9 working sessions, all 551 shared-vault entries, and the existing spec documents, then clustered into **36 rules**. A further **12 rules** were merged in from the GPT [[canon]] and are marked as such — those carry no correction count yet, because they came from strategy rather than from a mistake that reached a page.

What was left out of the GPT version, deliberately: the authority-level taxonomy, the structured `WordingRule` schema, the ten-step correction procedure, the end-of-task reporting ritual, and every clause that said to check with Melissa or wait for her. Those add process without improving a draft, and the last group contradicts the rule at the top of this page.

---

## Contents

- **Persuasion shape** (14)
- **Words and phrases** (5)
- **Voice and person** (5)
- **Claims, numbers and safety** (5)
- **Structure and layout** (6)
- **Numerals and formatting** (2)
- **Brand and emphasis** (2)
- **Humour** (1)
- **Surface-specific** (3)
- **How we work** (5)

---

# Persuasion shape


## 1. Never tell the reader what you are not, are not doing, or are not asking for; delete the negative half and let the positive fact stand alone.

**Corrected 14 times.**

**Why.** To understand "this is not a scam" the brain first builds the picture of a scam, then applies "not" as a separate second step (Gilbert's Spinozan model of comprehension: understanding is automatic, rejecting is effortful and optional). That second step is the one that fails under [[Cognitive burden|cognitive load]], and a [[Homeowner|homeowner]] at 9pm in a hot house, sweating and doing math on a repair she cannot afford, is a reader already at her limit; what survives is the pairing this page, scam. Repetition makes it worse rather than better, because a denial only grows more familiar and familiarity is what people read as truth (Skurnik and Schwarz found myth-and-fact flyers left readers more confident in the myth). The same applies to the softer "X, not Y" shape: "a setting, not a gamble" is the first moment she considered gambling, and now the page has to spend words climbing back to where it started.

**How to find more.** Run the Thumb Test on every sentence the page says about itself, the tool, the packet, the price, or you. Cover the negating word with your thumb (not, no, never, without, -free, isn't, won't, instead of, rather than) and read what is left. If what remains is a phrase a competitor could put on an attack page about you ("PRN: a scam," "a sales pitch," "a gamble," "a push," "wants your card"), that phrase is now in her head and you are the one who put it there. Then run the ownership question, which decides whether the word is hers or yours: did she arrive carrying it? It is hers only if it is the symptom she searched, the question she typed, or the thing happening in her house right now. Everything else she met here for the first time. Every "X, not Y" and "X, rather than Y" fails automatically; delete the comma and everything after it and read X alone, and if X cannot hold the sentence up by itself then X was never the point and you were using Y to do the work. Finally, replacement is part of the check, not a later step: for each cut ask "what actually happens instead," and write that in concrete nouns and in order. "No account, no card" becomes what she does and what she gets. If you cannot name the positive fact underneath, the sentence had no content and stays deleted.

**Mechanical check.**

```
Auto-fail regex (case-insensitive): (,\s*(not|rather than|instead of)\b)|(\bno\s+\w+,\s*no\s+\w+)|(\b(it'?s|this|that|we'?re|we|prn)\s+(is\s+|are\s+)?(not|never|no)\b)|(\b\w+-free\b)|(\b(isn'?t|aren'?t|won'?t|don'?t|doesn'?t|can'?t)\b). Flag-for-review regex: \b(not|never|no|without|nothing|nobody)\b — for each hit, check the sentence subject; if the subject is PRN, the tool, the walkthrough, the packet, the price, or "we," it fails. Countable gate: negation-token count must equal 0 in the hero block, every CTA, and any trust or reassurance section.
```

| | |
|---|---|
| **Good** | Ten questions about what you can see. At the end you get a packet with your AC's model, the code on the board, and what you told us. It's yours. You can hand it to whoever you want. |
| **Bad** | It's not a scam, and we're not selling you anything. No account, no card. A walkthrough, not a pitch. |

**Where it does not apply.** Three carve-outs, and the third is the important one.

The rule governs what the page says about itself, not what the page says about her house. Naming the bad thing she is already living inside is her word, not a planted one: "your AC is running but blowing warm" is the phrase she typed into Google, and a walkthrough cannot ask "is it blowing warm?" without saying warm.

A real limit that only stays true in negative form is the second: scope, licensing, what we do not do. "We don't send a tech" is a boundary she needs before she spends ten minutes, and rewriting it positive would be a lie. State that kind of negative once, flat, as a fact about the world, never in a spot where it is doing reassurance work.

**The deliberate contrast is the third, and it is a different move entirely.** A negative aimed at a market behaviour the reader ALREADY recognises is not planting, it is naming. "Forty articles were written for somebody else's house" works because she has just read four of them. "A blog for a different unit. A Reddit thread from 2019." works for the same reason. The line between planting and contrasting is ownership: **did she arrive carrying this thought, or did she meet it here?** If she arrived with it, you are putting words to something she already feels, and that reads as perception. If she met it here, you introduced it, and now the page has to climb back out of a hole it dug.

So the test is one question, not a ban. Before any negative, ask: *would she have nodded at this before she landed on the page?* Yes means contrast, and contrast against a recognised alternative is some of the strongest copy PRN has. No means you are the one who said it first, and it goes.

<details><summary>Melissa's own words</summary>

> Remove  A comparison, not a push. (NEVER say what you arent doing!!!! Psychologically you add the suggestion to their brains when it wasnt there then have to either leave the negative or spend time undoing what you planted. BAD [[Psychology|psychology]] writing)
>
> Remove: Away is a setting, not a gamble.
>
> Remove "It's not a scam. "
>
> remove No account, no card.

</details>


## 2. Write every heading, eyebrow, card title, button and tagline as something the reader gains, and if a line only names what the section is or how the tool works, replace it with the benefit or cut it.

**Corrected 10 times.**

**Why.** Headings are not read the way body copy is read. A [[Homeowner|homeowner]] sweating at 9pm scans the bold lines and votes stay-or-leave at each one, so every heading is a fresh sales moment, not a filing label. Two mechanisms do the work: self-referential encoding means a line about her AC and her money is processed and held far better than a line about our process, and construal level theory says stress and [[Urgency|urgency]] pull people into concrete near-term thinking, where an abstract label like "observations worth gathering" does not register as anything worth stopping for. We write mechanism labels anyway because of the curse of knowledge: we know why the step matters, so naming the step feels to us like naming the benefit. It is not, and she will not do that translation for us while her house is hot and she is deciding whether we are about to take her money.

**How to find more.** Run the SKELETON PASS. Strip the page to its skeleton: every heading, eyebrow, card title, button, tagline, step label and image caption, in page order, nothing else. Read only that list, then run four tests on it. (1) The "and?" test. Read each line in the homeowner's voice and answer "and?" If a truthful answer exists and is more interesting than the line, that answer is your heading. "5 observations worth gathering." And? "And nobody can charge you to find what you already found." That is the heading; the original is demoted or deleted. (2) The head-noun test. Underline the main noun. Did the reader want that noun before she landed on the page? Homeowners arrive wanting cool air tonight, a fair price, and not being talked down to. Nobody arrives wanting observations, steps, packets, walkthroughs, sections, features, or overviews. A head noun taken from our machinery means the line is naming our machinery. (3) The cover test. Cover the body copy under the line. Does the line alone give her a reason to uncover it? If she has to read the paragraph to learn why the heading matters, the heading is a container label, and the real heading is already sitting in that paragraph, usually as a subordinate clause. Find the sentence she would read out loud to whoever else is in the house and put that on top. (4) The skeleton-as-argument test. Read the whole skeleton end to end as if it were the only copy on the page. Does it argue, by itself, for using PRN? Any line that adds nothing to that argument gets rewritten as a [[Hook|hook]] or deleted, and deletion is right more often than rewriting, because the value inside a mechanism section is usually already carried by a [[Hook|hook]] elsewhere on the page.

**Mechanical check.**

```
Two gates, both run on the built HTML.

GATE 1 (hard fail) - mechanism language anywhere in a heading, eyebrow, card title or button:
grep -inE '(how it works|what (this|we|the tool|happens)|our (process|approach|method)|the process|overview|introduction|summary|what you.?ll (find|see)|things? (to|worth) (gather|collect)|observations?|walkthrough|section (below|above))' page.html
Any hit inside <h1>-<h6>, .eyebrow, .card-title or <button> is a violation.

GATE 2 (countable) - the reader must be present in the skeleton. At least 2 of every 3 headings must contain "you"/"your", a dollar figure, or a time word:
perl -0777 -ne 'while(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gs){$t=$1;$t=~s/<[^>]*>//g;$t=~s/\s+/ /g;print "$t\n" if length($t)>2}' page.html > h.txt
t=$(wc -l < h.txt); k=$(grep -icE '\byou(r|rs)?\b|\$[0-9]|tonight|today|minute|hour' h.txt); echo "$k of $t"
Calibration: her approved AC Problem Page LIVE v6 scores 14 of 21 (67%). Below 65% the page is talking about itself. Re-run the same two gates with the h-tag pattern swapped for your card-title and eyebrow class names.
```

| | |
|---|---|
| **Good** | Know what is wrong before anyone knocks  Five things you can check tonight. Each one is a thing nobody can charge you to find. |
| **Bad** | The five observations we collect before your appointment  This section explains what the walkthrough asks and how each answer is used. |

**Where it does not apply.** Two places where a hook makes the copy worse, and one that only looks like a violation. First, inside the walkthrough once she is mid task: labels there should be flat and hers, like "Your thermostat, exactly as it reads." She already said yes, and selling to someone who is trying to do a task adds load and starts to read as nagging. Second, trust disclosures and limits: "Cost ranges are published regional figures, not quotes" has to stay plain. Dress a limit up as a benefit and it reads as spin, and this page's whole job is to be the one thing on her screen that is not spin. Third, the SEO H1 has to carry the words she typed into Google. "AC running but blowing warm air" looks like a description, but seeing her own words is the hook, so leave it alone.

<details><summary>Melissa's own words</summary>

> Same symptom, different equipment, different next question. These are the decisions the tool actually works on, and the ones it cannot settle without a technician. NOT strong enough- remove text if it isn’t marketing hook and going back to the VALUE and why we are SO specific and to their unique live issue.
>
> 5 observations worth gathering before anyone comes out (STRONGER TITLE TELL THEM WHY IT would be worth gathering the BENEFIT to them should be stupid clear direct and in the headline or wasted words
>
> Main issue with the flyer is I need it rewritten and FOCUSED around BENEFITS to him.
>
> keep where the whitespace is in the flyer but label it differently as benefit wording to him

</details>


## 3. Sell whose facts go in, not what comes out: name the reader's own address, yard, shed, and equipment with real counts and sizes, and put one block high on every page that says out loud why this is their answer and not general advice.

**Corrected 9 times.**

**Why.** At 9pm in a hot house the reader is in the most concrete mental state a person gets into: near, urgent, "what is wrong with mine." Construal level theory is the mechanism here. Abstract, category-level copy lands with people planning something distant and slides right off people deciding something now, which is why "understand how cooling systems work" reads as a waste of her time. Self-referential encoding does the rest: "your 12 year old unit on the south side" gets read and held, "the unit" gets skimmed past. And general is not a neutral word to this reader, it is the thing that already failed her tonight in three articles that did not match her house, so any sentence that could have been written before we knew anything about her confirms she is in the wrong place again.

**How to find more.** Run these four passes over the page. They find new instances, not just banned words.

1. THE SWAP TEST. Take each sentence in the top block and ask: would this still be true and still make sense if the reader lived in a completely different house with completely different stuff? If yes, it is general copy. Your best lines should BREAK when you swap the house. A page whose hero survives the swap intact has no hook.

2. WHOSE THING IS THE SUBJECT. For every headline, subhead, button, and first line of every block, name the subject as one of three things: (a) the reader's specific thing, your shed, your slab, your 3 ton condenser, (b) our container, the checklist, the packet, the report, the PDF, the 6 steps, the walkthrough, (c) the category, homeowners, AC systems, storage needs. (a) can stay high. (b) and (c) get rewritten or pushed below the fold. (b) is the sneaky one and the one she flags most: the page starts bragging about the artifact instead of about whose facts are inside it. The checklist is the receipt, not the reason.

3. THE FREE BLOG TEST. For every promise on the page, ask whether a free article could truthfully make the same promise. "Know what to ask." "Avoid getting overcharged." "Understand what is wrong." All of those are things a blog already claims, so none of them is a reason to use the tool. Only promises that are impossible without the reader's own inputs earn a spot up top.

4. THE MISSING CONTRAST. Ask: if a skeptical reader wanted the answer to "why not just google this," could she find it in five seconds, high on the page, stated as a direct comparison? If the contrast is only implied, it does not exist. Every page needs the general-versus-yours block written out, and it should name the general thing it is beating.

One more catch that falls out of pass 2: never let a generalizing word describe our own output. If the copy says our answer is the general pattern, the typical case, what most systems do, we have volunteered the exact objection we are supposed to be killing.

**Mechanical check.**

```
Run on the hero, H1, H2, and tagline only.

1) Self-describing generality, 0 allowed:
   /\b(general|generic|typical|standard|common|usually|in most cases|overview|the basics|101|most homeowners|most systems|most sheds)\b/i

2) Container without an owner. Any sentence matching
   /\b(checklist|packet|report|pdf|worksheet|calculator|quiz|summary|walkthrough|steps?)\b/i
   must also match /\byour\b/i in that same sentence, or it fails.

3) Density floor, first 400 characters of body copy:
   count of /\byour\b/gi  >= 3
   AND at least one match of /\d+\s?(x|by|ft|feet|foot|in|inch|"|ton|year|yr|sq)\b/i
   or a live data slot such as {{city}}, {{make}}, {{shed_size}}, {{address}}.

4) Required block. Page must contain an element matching
   /id="why-specific"|class="[^"]*why-specific/
   OR a heading matching /not general|general .* your|vs\.?\s+(a\s+)?(blog|article|calculator|guide)/i.
   Missing = fail the build.
```

| | |
|---|---|
| **Good** | A blog can tell you what a frozen coil looks like. It cannot tell you that your 12 year old unit on the south side has been running since 2pm on a filter you last changed in June. We ask what you can see from where you are standing, we use your address and your setup, and we write it down. You hand that to whoever comes out. |
| **Bad** | Our guided walkthrough helps homeowners understand common AC problems. At the end you get a handy checklist you can take to the phone. This page gives you the general pattern most systems follow. |

**Where it does not apply.** The top of a [[Door page|door page]], before the reader has told you anything. You do not know her brand, her slab size, or her filter date yet, and inventing them to hit the specificity bar is worse than being general, because a wrong guess about her house at 9pm reads as a sales script and burns the trust the whole page is for. Up there, promise the specificity and name the categories of facts you will actually use, your address, your yard, what you can see from the porch, then deliver the real numbers once she gives them to you. Two smaller exemptions: safety and legal lines stay flat and absolute, if you smell gas you leave and call 911, no conditions and no personalization, and do not stuff five measurements into every clause, a hot tired reader can only carry two or three concrete details at a time, so spend them on the claim that has to land.

<details><summary>Melissa's own words</summary>

> with the taglines again focusing on your specific home/city not general | * A checklist at the end you can take to the phone --> should be a hook about your specific answers (NOT checklist is not the selling point although we can say and that is the end product) its that it is for their address, their shed, their yard.
>
> Is General AC advice vs. your actual AC as SPECIFIC of why this TOOL is SO MUCH MORE valuable to the homeowner then reading a general blog??? I want this SUPER SUPER STRONG
>
> we need an equivelent box high up that draws out for the perosn and the AI the VALUE of the tool not being a random calculator but MATCHIGN THIER EXACT specific storage, life needs based on their exact data unique not general etc
>
> Remove: This page gives you the general pattern.

</details>


## 4. Every time the page claims to be better or more specific, name the actual thing the reader would otherwise be doing (a YouTube video, a Reddit thread, a blog article, an AI summary, calling around) and beat it with their own AC, their own house, tonight.

Corrected 4 times.

**Why.** People cannot evaluate a claim in isolation; they score it against whatever comparison is already in their head, which is Hsee's evaluability problem — "specific to your situation" has no yardstick attached, so at 9pm it reads as marketing noise. "A video is somebody else's unit, filmed once, in good light" hands the reader a yardstick they already own, and construal level theory says a near, now, hot-house decision responds to concrete detail, not to abstract category words. Naming what she was doing five minutes before she landed here also does the trust work: it proves you know her actual night, which is most of what a stranger has to establish before she believes anything he says about money.

**How to find more.** Run two passes. Pass one, over what is written: mark every sentence where the page says it is better, different, more specific, or more useful, and ask "better than what, named?" If the answer is a category — general information, generic advice, the internet, other tools, guesswork — it fails, because a category is not a competitor, it is a shrug. Pass two, the one that finds instances nobody has flagged: before writing, list what the reader actually did in the two hours before she landed here. Searched the symptom. Read a thread from 2019. Watched two videos. Asked an AI. Called one company and got "we'd have to come out." Every line on that list is a live competitor, and if the page names none of them it is arguing with nobody. Then check both halves of each contrast. Losing half: could the owner of that alternative read your sentence and agree it is a fair description of what they do? If not, you are strawmanning and the reader can feel it. Winning half: could a rival tool truthfully write the exact same sentence? If yes, you named the competition but did not beat it — the winning half has to contain something only a live look at her AC tonight could produce.

**Mechanical check.**

```
Fail if present: (?i)\b(general(ized)? information|generic (advice|answers|information|results)|the internet|online advice|other (sites|tools|options|apps)|guesswork|one[- ]size[- ]fits[- ]all|random advice)\b — count must be 0. Fail if absent: every sentence matching (?i)(instead of|unlike|rather than|versus|\bvs\.?\b|better than|choosing between|most (sites|tools|advice)) must also contain, in that same sentence, a match for (?i)(YouTube|video|Reddit|thread|forum|blog|article|AI summary|ChatGPT|Google|calling around|neighbor|Facebook group|Nextdoor|comment section|manual). Countable gate for a door page: named alternatives >= 1, vague stand-ins == 0.
```

| | |
|---|---|
| **Good** | By now you have probably read a thread and watched two videos. The video is somebody else's AC, filmed once, in good light, by a guy who already knew what was wrong. The thread is somebody else's house in 2019. We look at yours, tonight, in whatever state it is in, and write down what you can actually see. |
| **Bad** | Most advice you find online is too general to be useful. We give you answers that are specific to your situation, not one-size-fits-all information. |

**Where it does not apply.** Stop naming alternatives once she has started the walkthrough. The comparison belongs where the choice is still live, at the top of a [[Door page|door page]] or in the "what you're actually choosing between" section; raising YouTube again on the results page hands back a decision she already made and reads as insecure. And name formats and behaviors, not businesses you compete with by brand — "a Reddit thread" describes a thing, a rival's company name starts a fight and makes the page look defensive. Same restraint if her alternative is genuinely good, like a neighbor who does [[HVAC]]: name it, do not sneer at it, and say what you add to it.

<details><summary>Melissa's own words</summary>

> call out the other options we are trying to replace and create more value directly (redit? What things is google using to answer this problem right now that we would be able to rank higher for if the ai knew what our tool could do for the SPECIFIC issue the homeowner has?
>
> yes on these! but update the What you are actually choosing between table too (A video is somebody else's unit, filmed once, in good light.
> → We look at yours, in whatever state it is in at 9pm tonight.
>
> **Name the competition** The generic-vs-specific comparison must name what the reader would otherwise be doing: **a blog article, a Reddit thread, a YouTube video, an AI summary, calling around**. "General information" is too vague to persuade anyone.
>
> we need another reason we are different from youtube .

</details>


## 5. Every helpful block must hand the reader back to the intake before it ends, with a centred line naming what the information alone cannot do for them, and the intake box must be the highest-contrast thing on the page.

Corrected 4 times.

**Why.** A homeowner in a hot house at 9pm is running on [[Urgency|urgency]], and urgency is the fuel that makes them act. A good checklist quietly spends that fuel: reading it feels like progress, the uncertainty drops, and the intention to get help decays before it ever becomes an action. That is the intention-action gap, and the fix is always the same, which is to put the next step at the exact moment and place where the intention peaks instead of at the bottom of the page. The hierarchy half is plain perception rather than persuasion: the eye lands first on whatever is most isolated and highest in contrast (the isolation effect), so if a headline or a photo out-shouts the intake box, the page is telling a frightened skimmer that reading is the thing to do here.

**How to find more.** Three passes, any of which a careful reader can run on a page nobody has flagged. (1) EXIT AUDIT. Read the page one section at a time and after each one pretend the reader closes the tab right there. Ask two questions: "could they act on this without us?" and "if they wanted us this second, is the way back inside this section?" A yes followed by a no is a leak. Then count content sections and count routes back to the intake; the numbers should match, and each route must live inside its own section, because "there's a form further down" is not a route. (2) PAYOFF TEST. For every helpful block, point at the one sentence that names what the information alone cannot do (a thermostat photo is notes, the walkthrough turns it into a packet). If you cannot quote that sentence, the block is teaching them to leave, and the sentence belongs immediately before the hand-back. (3) FIRST GLANCE TEST. Blur or grayscale a full-page screenshot, or shrink it to thumbnail size, and note what your eye hits first. If that is a headline, a photo, a stat block, or a section card rather than the intake box, the hierarchy is wrong and the thing to change is the box, not the copy. Cross check by showing the top of the page to someone who has never seen it for two seconds and asking where they would type; hesitation is a fail.

**Mechanical check.**

```
# 1. every content section must carry its own route back to the intake
awk 'BEGIN{RS="</section>"} /<h2/ && !/#intake/ {print "LEAK: section "NR" has an h2 and no #intake link"}' page.html
# 2. count check: routes back >= content sections that are not the intake itself
grep -c 'href="#intake"' page.html
# 3. the intake box treatment must be unique on the page (this count must equal 1)
grep -c 'box-shadow:0 2px 0 rgba(18,22,26,.05),0 30px 64px -34px' page.html
```

| | |
|---|---|
| **Good** | On its own, a photo of your thermostat is just a photo. In the walkthrough it starts ruling things out.  ↑ We can walk you through all 5 of these, in your house, tonight. [ Start with MY AC ] |
| **Bad** | That is everything you need to check your AC yourself. Good luck out there. If you get stuck, our form is at the bottom of the page. |

**Where it does not apply.** Safety blocks are the honest exception. "Stop and call someone now if you smell burning" sends them to the breaker and to a real person, with no hook, no arrow, no button. Routing a danger warning back to the form is the one place this rule costs more trust than it earns, and the same goes for the sources list and the legal footer. Second exception: do not stack hooks. Two short sections back to back share one, or the third reads as nagging and collides with the rule about repeating a hook shape.

<details><summary>Melissa's own words</summary>

> Ten minutes, no tools section important to link that section with marketing type hooks - put it in the form above aand we cna help walk you through it  (or somethign there is no link to us and on its own the thermostat doesnt save them a service call - our tool with that info does.
>
> Before the 8 things that make an ac blow warm we need a centered in pink headline that says with an wrrow or something pointing up. We can walk you through how to check these in your house easy (or something) to direct attention back to the form. We want them filling the form out so design the page liek that.
>
> I need the [[Tell us what happened|tell us what happened]] box to have more contrast to psychologically be what they see first
>
> design so it is what the cusotmers attention is drawn to FIRST.

</details>


## 6. Attach the reason to every ask in the same sentence, name the exact part, give a way out, bundle whatever one look can answer, and turn any spend into priced options laid side by side.

Corrected 3 times.

**Why.** A bare instruction from a stranger at 9pm reads as being ordered around, and reactance makes a stressed reader either push back or quietly close the tab. Langer's "because" work is blunt about the fix: the identical request gets complied with far more often when the reason rides in the same breath, and the escape hatch ("or just tell us") is the but-you-are-free-to move that keeps the choice hers, which is the whole difference between being guided and being handled. Bundling what one look answers is effort cost rather than theory: every extra trip into the dark is another chance to quit, and each ask she does complete raises her commitment to finishing the rest. Priced options side by side work on ambiguity aversion, because "you may need a repair" is an open-ended threat to her wallet while "$12 for two fuses, worst case you keep them" is a bounded bet, and showing her the cheap path next to the expensive one is the strongest evidence on the page that we have no stake in which one she picks.

**How to find more.** Highlight every sentence in the walkthrough that asks the reader to look, move, open, find, photograph, type, or spend. That is your ask list. Run five tests on each one, in order.

1. THE BECAUSE TEST. Read the ask alone, with no memory of the sentence before it. Can the reader say what a yes or a no rules in or out? If the reason sits in an earlier sentence, in a tooltip, behind a "why we ask" link, or nowhere, it fails. Move the reason into the ask sentence.

2. THE POINTING TEST. Could two homeowners point at two different objects and both believe they obeyed? Read it as somebody who has never looked closely at their own AC. "The unit", "the panel", "the filter" all fail. Name it by where it is and what it looks like.

3. THE DEAD END TEST. Assume she cannot do it. The panel is screwed shut, it is raining, she is on crutches, the phone is at 3 percent. Does the copy hand her a second door, photograph it or just tell us? A step that only works for the able and equipped reader fails.

4. THE ONE TRIP TEST. Walk the ask list in order and write beside each one where her body has to be: thermostat, outside, attic, breaker panel. Any two asks in the same place that sit in different steps are a wasted trip. Merge them, and say out loud what the second one buys her.

5. THE PRICE TEST. Anywhere the copy touches money, repair, replacement, diagnosis, or "you may need", count the priced paths visible on screen. Fewer than two is a pitch wearing a walkthrough's clothes. Every named path needs a number, the cheapest path needs its worst case stated ("you are out $12 and you keep the spares"), and no path should stand alone.

If there is time for only one test, use this: read each ask on its own and ask whether it tells her what it is for, exactly what to look at, and what to do if she cannot. Three yeses, or rewrite it.

**Mechanical check.**

```
Treat each walkthrough step as one block. (1) Reason present: any sentence matching /\b(look at|check|open|find|photograph|snap|take a photo|go out|read|feel|listen|tell us|type)\b/i must ALSO match /\b(because|since|as a|so we|so you|that tells|that shows|which rules|which means|so that)\b/i in the SAME sentence. (2) Vague nouns: /\bthe (unit|system|panel|device|area|component|part|box|equipment)\b/i must return zero hits ("your AC", never "the unit"). (3) Escape hatch: every step block must match /(or just tell us|or type|if you can'?t|if you'?d rather|no camera|skip this)/i at least once. (4) Money: any block matching /(repair|replace|diagnos|service call|technician|quote|estimate|cost)/i must contain two or more distinct /\$\s?\d/ matches. (5) Trips: tag each block with its location word (outside|outdoor|thermostat|attic|breaker|basement|filter); more than one separate block per location is a wasted trip, merge them.
```

| | |
|---|---|
| **Good** | Head out to your AC. Take one photo from the side and one from the top. The side shows us the label so we know which parts fit. The top shows us whether the fan is turning, which is the next thing we were going to ask. If the phone is being difficult, just tell us what you hear out there.  So your decision is this. A diagnosis visit runs about $89 and tells you whether it is a $12 fuse or a $400 motor. Or you grab two fuses for $12 and try those first. Guess wrong and you are out $12, and you keep the spares for next time. |
| **Bad** | Locate the unit and inspect the filter. Then go outside and photograph the condenser. In the next step we will need a photo of the fan. Depending on what we find, a repair may be required. |

**Where it does not apply.** Safety stops. When the honest answer is stop and step away, the shape flips: no escape hatch, no bundling, no priced options. "You smell burning, or you see scorch marks by the breaker. Stop. Do not open it." A hedged, reasoned, optional version of that sentence gets somebody hurt, and laying prices beside a hazard makes it look negotiable. This is the "imperatives very sparingly" exception, and sparingly means here.

The second limit is on the price rule. Never invent a second option to satisfy the pattern. If there is genuinely one path, name it and say why it is the only one. A decoy option reads as a sales trick and costs more trust than the single honest price ever would.

<details><summary>Melissa's own words</summary>

> first lets look at the air filter as a dirty or clogged one can cause this.
>
> snap picture and see if you cna include a picture form the sides AND the top as that will let me chekc if the fan is running which is the next thing. 2 knocked out with one go
>
> so your actual decision is A) $x to rent  b) $x diagnosis visit to figiure out if $ fuse or $ motor...or some people like to gable and the difference is large enough that the gamle might be worth going to grab 2 fuses even without testing...if not the fuses only out $12 max and you'll have them for a later date if needed.

</details>


## 7. Make every hook on the page answer a different worry, keep any single worry under about a third of the page, and when a hook drifts into its neighbour, replace it with a new worry instead of rewording it.

Corrected 2 times.

**Why.** A homeowner at 9pm in a hot house is not reading, she is scanning for the catch. Persuasion knowledge is the mechanism: the moment copy starts sounding like a script, her attention moves off what is being said and onto what is being sold, and three versions of one claim is exactly what a script sounds like. Underneath that is plain coverage craft. Different homeowners arrive scared of different things (the bill, being lied to, not knowing what to ask, being stuck alone until morning), and a hook only catches the person it was aimed at, so two hooks aimed at the same fear catch one person and let the rest walk. A page that leans hard on one angle also quietly tells her that angle is all you do.

**How to find more.** Run the objection column. Beside every hook on the page, write in five words or fewer the worry it removes, phrased as the reader's fear and not the hook's topic: "I'll get overcharged," "I won't know what to ask," "nobody's coming tonight," "I can't tell if this is an emergency," "I'm about to be talked down to." Ignore the wording completely, since two hooks that share no words can still share a fear. Then read the column, not the page. (a) Two identical entries means one hook is redundant, and the fix is a fear that isn't in the column yet, not a rewrite of the loser. (b) If one fear or one family of fears owns more than a third of the column, the page is over-weighted on that angle; cut or convert until it isn't. (c) Any hook you cannot fill in an entry for is doing no job at all and should go. Two backstops when the column feels ambiguous: swap two hooks' positions and if the page reads exactly the same, they are one hook wearing two outfits; and cover everything except the hooks, then ask a stranger what business this is. If the answer comes back narrower than the truth, one angle is dominating.

**Mechanical check.**

```
Extract the page's hooks (H1, H2, and any card or section heading). 1) Stem, drop stopwords and the obvious product nouns, then compare every pair: Jaccard overlap >= 0.34 on remaining content words, or 2+ shared content words in hooks under twelve words, flags a likely duplicate move for human review. 2) Count root families across all hooks (repair/repairs/repairing, tech/technician, fix/fixed, quote/price/pricing, trust/trusted): any family appearing in more than one third of the hooks flags a dominating angle. 3) Strongest version: require a one-word angle tag per hook in the page source (money, vocabulary, timing, trust, control) and fail the build on any duplicate tag or any tag exceeding one third.
```

| | |
|---|---|
| **Good** | Find out what your AC is actually doing before anyone gives you a number.  Hand a tech your notes instead of trying to describe the noise.  It's 9pm and nobody's coming tonight. Here's what you can check right now. |
| **Bad** | You don't need a tech. You need a guy people you already trust, trust.  Anyone can call themselves a pro. You want the one your neighbors actually call. |

**Where it does not apply.** The close is allowed to repeat. A final CTA that restates the page's strongest promise is a callback, not a second hook, and neither is a line inside the walkthrough that keeps one thread running step to step. This rule governs entry points competing for the same scan, not body copy, which should stay on one thread on purpose. The other honest exception: never manufacture an angle just to fill a slot. If the page truthfully has three real moves and the layout wants five hooks, run three hooks. Three true angles beat six where two were invented to pass a variety check.

<details><summary>Melissa's own words</summary>

> "You don't need "a tech." You need "a guy" people you already trust, trust." lets reword this. Seems to close to the middle one now. Can we get another hook?
>
> This is too heavy on chasing the repair. That is ALL good but only one part of it.

</details>


## 8. Write the homeowner's problem as not knowing which provider to pick, what it should cost, whether the work will be any good, and whether saying yes also costs a day of work; never as whether anyone will show up.

Corrected 2 times.

**Why.** At 9pm she can already get a body in the door, so availability is not what is keeping her on the page. What she cannot do is judge them, and unknown odds sit worse than known bad odds: that is ambiguity aversion, and it is why she stalls instead of calling. She is also bracing for two losses stacked, the repair bill plus an unpaid day off spent waiting in an 8-to-4 window, so copy that names only the bill misses half of what she is afraid of. Naming a pain she does not have is worse than naming none, because "we'll get someone out to you" tells her the page was written by someone who has not stood where she is standing.

**How to find more.** Quick test on any single line: if she had one button, would she press "send someone" or "tell me which one"? If the sentence promises the first button, it is on the wrong pain. Full page, two passes. PASS ONE, the 90-second test: underline every sentence that states the reader's problem, then ask of each, could she solve this tonight with Google and a phone? Getting someone to come is already solved, three companies answer at 9pm. So any pain sentence built on availability, response time, dispatch, or someone being on the way is describing a problem she does not have, and it goes. PASS TWO, the four-axis check on what survives: every remaining pain sentence must land on at least one of (1) which [[Provider|provider]] is the right one, (2) what this should cost, (3) whether the work will actually be good, (4) whether saying yes costs her a day of work on top of the bill. A pain sentence touching none of the four is decoration; rewrite until it touches one. Then check the page as a whole names axis 4 at least once, because that is the axis writers drop. To find candidates fast, mark every arrival verb on the page (show up, come out, get someone here, on the way, respond, dispatch, availability, same day). Each one is a candidate. Keep it only where the sentence reports what happens after she has chosen, never where it states what she is afraid of before.

**Mechanical check.**

```
Candidates: rg -in "shows? up|show up|comes? out|coming out|get(ting)? someone (out|here|there)|on (the|their) way|dispatch|response time|24/7|same.?day|availabilit". Near-certain violation: an arrival term in the same sentence as uncertainty language, rg -in "(no idea|don'?t know|not sure|hoping|hope|worry|worried|stuck)[^.!?]{0,80}(shows? up|comes? out|get someone|on the way|respond|dispatch|availabl)" plus the same pattern with the two halves reversed. Countable gate: a door page must contain at least one match for "day off|take off work|miss(ing)? work|time off work|unpaid day|sit(ting)? home|wait around|8 to 4" in its pain copy; zero matches means the second cost was dropped.
```

| | |
|---|---|
| **Good** | Getting someone out to look at your AC is the easy part. The hard part is knowing which one to call, what this should cost, and whether you have to take a day off work to be there. Nobody helps with that part. |
| **Bad** | It's 9pm, your AC is dead, and you have no idea who's going to show up or when. |

**Where it does not apply.** When availability really is the scarce thing, write to availability. Burst pipe at 2am, no heat in January with a baby in the house, every plumber in the county booked after a storm: there her fear genuinely is that nobody comes, and the four-axis pain reads cold and salesy. Also exempt are status lines after she has already picked someone ("your tech is on the way"), which report facts rather than state her problem, and provider-side pages, where showing up is the product being sold and "providers who show up move up" is a fair line. The rule governs sentences that name the homeowner's problem before she chooses.

<details><summary>Melissa's own words</summary>

> show up ISNT the main issue (store that) its no idea which is the best, lowest cost, highest quality, will be able to fix it while you're at work so its not costing you the repair AND a day of work, etc.
>
> change: "and no idea which one shows up." again this ISNT the main issue- use wording form above

</details>


## 9. Name a cost the reader is already paying and has never counted as work — the third time explaining the same problem, the warranty email nobody can find, the good plumber's number that is gone — and prove each one with an ordinary scene that has a place and an action in it; where no such scene exists, replace the claim with the real burden sitting underneath it.

*Merged in from the GPT [[canon]]. Not yet tested against a live correction.*

**Why.** Readers run a background check on every persuasive line, and the persuasion knowledge model says that the moment a claim overshoots what they have actually lived, the whole page gets reclassified as selling and discounted in one move. A cost she has felt but never put into words does the opposite: it lands as perception rather than pitch, and the thought is "how did they know that," which is the same mechanism that makes a good diagnosis feel trustworthy before any work is done. These repair taxes are also already sunk, so naming one costs nothing in fear and gains everything in recognition, which is why it does not need inflating. Inflating it is not only dishonest, it is worse copy, because she has a real memory to check the claim against and the exaggerated version fails that check in about a second.

**How to find more.** Three passes. (1) SCENE TEST, over what is written: mark every sentence claiming she is frustrated, tired, wasting something, or losing something, and write the ordinary scene that proves it, in one sentence, with a place and an action she took. "You are standing in the hallway telling a third guy the same three sentences about the noise." If you cannot write that scene without inventing a villain or reaching for a worst case, the claim is rhetoric, and it either gets cut or gets swapped for the real burden underneath it. (2) UNPAID CHORE LIST, the pass that finds instances nobody has flagged: before writing, list what the reader has to do that nobody pays her for and nobody counts as work. The search she has already redone twice. Explaining the problem to a third person. Hunting the inbox for a warranty. The coordination calls. The tradesperson she liked whose number is on a dead phone. The decision she has to make with no way to check it. Every line is a live tax, and if the page names none of them it is describing a feeling instead of a cost, which is exactly what a reader discounts. (3) NO VILLAIN TEST: ask whether the cost still exists when everybody involved is honest and competent. Re-explaining the problem costs her the same twenty minutes with a good provider as with a bad one, so it is structural. If the pain only appears when somebody is cheating her, it is a villain story, and it will not survive a reader whose last plumber was fine. Then check the volume dial: where the scene is real but the word sitting on top of it is bigger than the scene (nightmare, disaster, drowning), keep the scene and cut the word, because the scene was already doing the work.

**Mechanical check.**

```
Fail if present: (?i)\b(nightmare|horror stor(y|ies)|disaster|drowning|bleeding money|ripped off|scam(med)?|devastat\w*|crisis|epidemic|broken industry|before it'?s too late|don'?t let|every day you wait)\b — count must be 0. Then list every sentence matching (?i)\b(tired of|sick of|frustrat\w+|stress\w+|hassle|waste|wasting|los(e|ing)|over ?pay\w*|again and again|for the (third|fourth|hundredth) time)\b and require, inside the same paragraph, a concrete scene: at least one place or object noun from (hallway|kitchen|driveway|garage|phone|inbox|email|voicemail|search bar|junk drawer|breaker|thermostat|counter|receipt|glovebox) AND one past-tense verb of the reader doing something from (typed|called|explained|searched|scrolled|waited|dug|hunted|wrote|asked|texted|drove). Countable gates per page: pain claims carrying a named scene == pain claims total; pain claims with no scene == 0; distinct taxes named <= 2.
```

| | |
|---|---|
| **Good** | By the third call you are saying the same four sentences again. It started Tuesday. It only does it on cool. Yes, the filter is new. Nobody has written any of it down, so the next person starts from zero. The walkthrough writes it down once, and you hand it to whoever comes. |
| **Bad** | Homeowners are drowning in a broken repair industry. Every day you wait, you risk catastrophic failure and financial devastation. Don't let another contractor take advantage of you and your family. |

**Where it does not apply.** Present pain that is already obvious does not get excavated. The house is hot and there is water on the floor; say that plainly and move, because dressing tonight's heat up as a hidden tax reads as clever and clever is the wrong register at 9pm. Safety copy names the danger, not a cost. On a door page the hero belongs to the symptom she typed, so the tax lands one beat later, in the section about what she is actually choosing between; on [[Home Memory]] and [[Trust Network]] the tax is the product, so it can open. And keep it to one or two per page. Stacking four hidden costs turns perception into a lecture, and a reader who is being shown how hard her life is stops feeling seen and starts feeling handled.


## 10. Open with the sentence that changes how the reader sees her own house, and let PRN, the AI, the platform and every feature name arrive only after that sentence has landed.

*Merged in from the GPT canon. Not yet tested against a live correction.*

**Why.** Curiosity is a gap, not a topic. The information gap works by making her notice something missing she thought she had, so a hook earns attention by opening a hole in what she already believed about her own house. Name PRN, the AI or the tool in that first line and the hole never opens, because the sentence arrives carrying its own answer and she files it as an ad before she has felt the question. Worse, mechanism talk spends the only attention she has at 9pm on how our thing works instead of on what is wrong with hers, and persuasion knowledge finishes the job: the moment a product name leads, she reads for the catch instead of for the fact.

**How to find more.** Run the NAME DELETION TEST on every opening line: the H1, the line under it, the first line of each section, every card hook, every subject line and ad opener. Delete every mention of PRN, AI, the platform, the tool, the app, the dashboard, and every feature name (LIVE Walkthrough Tool, [[Home Memory]], [[Trust Network]], [[Job Packet]], [[SmartQuote]], HouseKeep). Read what is left out loud in her voice. Three outcomes. (a) It still lands a jolt: the hook is doing its own work, ship it. (b) It reads true but flat, like a caption on a photo: the frame change was never there, the name was just covering for it. (c) It collapses into a fragment or nothing at all: the hook was riding the product name and there was no hook. REPAIR MOVE for (b) and (c): stop rewriting the line and finish this sentence instead, out loud, about her house. "You think ___ about your own house. Actually ___." The second half, written with a concrete noun and a number, is your opening line. The product name then goes in the NEXT sentence, in the answer position, where it reads as relief instead of as a pitch. Two backstops when the outcome is arguable. THE OWNERSHIP TEST: the surviving sentence has to be true whether or not PRN exists. If it is only true because we built something, that is mechanism wearing a hook's clothes. THE STRANGER TEST: read the first line to someone who has never heard of us. If they ask a question back, the gap opened. If the honest reply is "okay, and?", it did not.

**Mechanical check.**

```
Pull the openers, then run two gates on them.

# 1) extract opening lines: H1, H2, card titles, eyebrows, first <p> after the H1
perl -0777 -ne 'print "$1\n" while /<h[12][^>]*>(.*?)<\/h[12]>/gs' page.html | sed 's/<[^>]*>//g' | sed 's/  */ /g' > hooks.txt

# 2) GATE ONE (hard fail) - product or mechanism token in the question position
rg -inE '\b(PRN|Property Response Network|LIVE Walkthrough( Tool)?|Job Packet|Home Memory|Trust Network|SmartQuote|HouseKeep|Powered by CHI|our (tool|app|platform|system|software|network)|the (tool|app|platform|dashboard)|AI|A\.I\.|algorithm|automated|smart(er)? way)\b' hooks.txt
# any hit is a violation unless the line is the SEO H1 carrying a searched brand term

# 3) GATE TWO (countable collapse test) - strip the tokens, count what survives
sed -E 's/\b(PRN|Property Response Network|LIVE( Walkthrough)?( Tool)?|Job Packet|Home Memory|Trust Network|SmartQuote|HouseKeep|AI|algorithm|our (tool|app|platform|system)|the (tool|app|platform|dashboard))\b//Ig' hooks.txt | tr -s ' ' | awk 'NF<4 {print "COLLAPSED: " $0}'
# under 4 surviving content words = the name was the hook, rewrite with the repair move

# 4) position gate on the hero: the first product-name match must fall after the first sentence end
awk 'NR==1' hooks.txt | grep -qE '^[^.?!]*\b(PRN|LIVE|Home Memory|Trust Network|Job Packet|SmartQuote|HouseKeep|AI)\b' && echo "FAIL: name before the first period"
```

| | |
|---|---|
| **Good** | Your $400,000 house is an [[Asset with amnesia|asset with amnesia]]. Every part number, every warranty, every guy who did good work lives in your head and nowhere else. Home Memory is where your house starts keeping its own record.  Why is your brain your house's filing cabinet? You are the only backup your furnace has.  It is 9pm and your AC is blowing warm air. Fifteen minutes from now you can know more about it than the person you are about to call. |
| **Bad** | PRN's Home Memory keeps your home [[My Property Record|repair history]] in one place.  Our AI-powered LIVE Walkthrough Tool helps you document your AC problem before you call a technician.  Introducing the [[Job Packet]], a smarter way to talk to contractors.  Welcome to [[Property Response Network]], where homeowners get answers. |

**Where it does not apply.** Three places the name leads and should. The SEO H1 on a door page has to carry the words she typed into Google, so if she typed a brand or a product term, that term goes first and rule 26 outranks this one on the title line. Returning-user surfaces are past the hook entirely: the dashboard, a login, a Job Packet she is coming back to, and every CTA and payoff line, where the name is written exactly as approved under rule 30. Provider decks and partner pages, where the reader arrived already asking what this is, want the mechanism up front and read as evasive without it. One limit that matters more than the exceptions: a frame change is not a tease. If the opening line hides what the page is about and the next two sentences do not pay it off, that is clickbait, and it costs more trust than a boring headline ever did. Open the gap, then close it fast.


## 11. Write the moment instead of the mood: replace any sentence that names how the reader feels with one scene she has actually stood in, named down to the room, the object and the time of day, and pick the detail she could repeat to her husband word for word.

*Merged in from the GPT canon. Not yet tested against a live correction.*

**Why.** Generic empathy is free to say, so it signals nothing. "Home repairs can be stressful" is true, and every competitor she has open in another tab has already said it, which makes it wallpaper rather than evidence that anyone here knows her house. A specific detail works by recognition instead: she matches it against her own memory of standing there, and the match feels like being understood even though nobody claimed to understand anything. Naming the feeling outright also asks her to agree with a stranger's summary of her state at 9pm, exactly when she is braced for strangers to be wrong about her, whereas a scene asks for nothing and lets her supply the feeling herself, and a feeling she supplied is one she trusts. Concrete detail is also the only kind that survives being repeated to a spouse twenty minutes later, and that retelling is how this reaches the second decision-maker in the house.

**How to find more.** Point at every sentence that names a feeling (stressful, frustrating, overwhelming, confusing, a headache, a nightmare, a hassle, and the positive mirrors: peace of mind, relief, confidence) and run four passes on it.

(1) WHAT WAS SHE DOING. Ask what the reader was physically doing in the moment that feeling happened. Scrolling a text thread looking for the guy her neighbour used. Typing "capacitor" into a search bar with one hand still on the thermostat. Standing in the garage with a flashlight because that is where the paperwork went. Write that and delete the feeling word.

(2) PICTURE TEST. Name the room, the object and the time of day the sentence takes place in. If you cannot fill all three, you wrote a mood, not a scene, and it is category-average. Fill them from facts the page already has, not from invention.

(3) SWAP TEST. Put a competitor's name in front of the sentence, then drop the same sentence onto a page about a completely different trade. If it survives both unchanged, it carries no information and she has already read it four times tonight.

(4) RETELL TEST. Imagine her repeating the line to her husband in the kitchen twenty minutes later. "They said something about peace of mind" is the failure. "It keeps the receipt so you're not digging through 4,000 emails" is the pass. If she would have to paraphrase it, it does not travel.

Then two sweeps over the whole page. SOURCE: take scenes from real intake answers, walkthrough transcripts and the phrases people actually type into search, ahead of anything you made up, because invented detail is where you hand her a basement she does not have. DENSITY: one scene per section. Three stacked scenes stop reading as recognition and start reading as a short story.

**Mechanical check.**

```
Candidates: rg -in "\b(stress(ed|ful)?|frustrat(ing|ed|ion)|overwhelm(ing|ed)|confus(ing|ed|ion)|headache|nightmare|hassle|daunting|anxi(ous|ety)|peace of mind|we know how|we get it|we understand|you'?re not alone|no ?(one|body) should have to|can be (a lot|tough|hard|stressful|difficult))". Target count on a door page is 0.

Near-certain violation, a feeling floating with nothing under it: take each line the pattern above returns and test the same sentence against rg -in "\b([0-9]{1,2} ?(am|pm)|midnight|tonight|Saturday|kitchen|hallway|attic|garage|driveway|thermostat|breaker|filter|vent|receipt|invoice|warranty|email|voicemail|text thread|junk drawer|glove box|manual)\b". A sentence that matches the first pattern and not the second is mood with no scene attached, and it gets rewritten.

Countable gate: every block whose job is to show we understand the problem (hero subhead, the pain block, any "we know" section) must return at least 1 match for the second pattern. Zero means the block is interchangeable.

Manual follow-up grep cannot do: the swap test. Paste each empathy sentence under a competitor's logo. Nothing should survive.
```

| | |
|---|---|
| **Good** | Your capacitor was replaced in 2023. The receipt is in an email from a company that has since changed its name, and you have 4,000 other emails. Your future self should not have to go looking for it at 9pm with the AC off. Home Memory keeps it, so the next person who opens your AC starts where the last one stopped. |
| **Bad** | We know home repairs can be stressful. Dealing with contractors is frustrating and confusing, and no homeowner should have to face that alone. PRN takes the headache out of home repair and gives you peace of mind. |

**Where it does not apply.** A scene only works if it is her scene. One door page gets apartments, mobile homes and a 1978 farmhouse in the same hour, so a detail vivid enough to land is also specific enough to be wrong, and "down in your basement" quietly tells everyone on a slab that this page was written for somebody else. Pull the detail from what the page already knows for certain: the symptom that brought her here, the season, the equipment, the words she typed into search. Two other places the feeling word stays. Where it is a fact she is answering rather than a claim we are making, a form label or a filter or a question about herself, "Frustrated with your quote?" is doing work no scene can do. And after a flood, a fire, or a death in the family, a vivid scene is cruel where a short plain sentence is kind; there, name the next step and skip the picture. Last, one scene per section. Stack three and she stops recognising herself and starts reading a story, and she came here to decide something.


## 12. Write every claim, hook and frame so the reader's first silent response is "yes, like when...", and when you predict an "Actually" or an "It depends", replace the universal with a standard she can check against her own history rather than softening the wording.

*Merged in from the GPT canon. Not yet tested against a live correction.*

**Why.** A reader is not moved by your sentence, she is moved by the sentence she says back to herself while reading it, which is cognitive response theory, and evidence she pulls out of her own life arrives carrying the authority of memory instead of the discount she applies to anybody with something to sell. Which sentence she says back is decided entirely by what you asked her to go looking for. A universal about the trade ("contractors always overcharge") sends her hunting for a counterexample, availability guarantees she finds one in about two seconds, and a homeowner at 9pm who has just won a small argument with your page has stopped reading it as help and started reading it as a pitch. A standard she can hold her own history up against ("a referral should not disappear after one job") sends her hunting for a match instead, she finds that just as fast, and the proof now sitting in her head is hers, which is the only kind she cannot dismiss as marketing.

**How to find more.** Run the FIRST RESPONSE test on every hook, claim, stat caption and section opener, and run it before you polish anything, because polish cannot fix this. Read the line once at reading speed, then write down the reader's very next unspoken words, verbatim, in her voice and not yours. Sort on the opening word alone. "Actually", "It depends", "Not always", "Not my guy", "Says who" means the frame handed her the job of arguing with you, and it gets replaced. "Yes, like when", "That happened to me", "I still don't know his name" means it is working. A blank means the line is scenery and belongs to rule 1. Then run THE CONVERSION, which is the part writers skip. In the failing line, find the population claim, the word that speaks for everybody: every, all, always, never, nobody, most, "contractors are", "homeowners don't". Ask what single event you are actually betting she has lived through. Then rewrite it as a standard that got broken or a thing she has lost [[Track|track]] of, never as a fact about a population, because a standard invites her to check her own history while a population claim invites her to find the exception. "Providers always disappear" is arguable. "A referral should not disappear after one job" is not, and she supplies the disappearance herself. Two backstops. RETRIEVAL SPEED: can she name the person, the day, the room or the number in about three seconds? If retrieval takes work, a tired reader will not do it and the line lands as a slogan. HEDGE TELL: if your fix added "often", "many", "can sometimes" or "in most cases", you did not fix the frame, you drained the content and left the same claim quieter. Log the swap on the running list and keep writing.

**Mechanical check.**

```
Candidates: rg -in "\b(every|all|always|never|nobody|no one|everyone|most|any)\b[^.!?]{0,40}\b(contractor|provider|tech|technician|company|homeowner|quote|repair|price)" plus bare universals in headings only, rg -in "^\s*<h[12][^>]*>[^<]*\b(always|never|every time|nobody|everyone|all of them|most people)\b". Hedge tell, a universal that was softened instead of replaced: rg -in "\b(often|frequently|many|some|tend to|typically|usually|in most cases|more often than not|can be)\b" — each hit in a hook or H2 is a frame that lost its content without gaining agreement. Countable gate for a door page: every H1 and H2 must contain at least one retrieval anchor, rg -in "\b(you|your) (last|first|old|previous)\b|the last time|after (one|the) job|the guy who|still (have|remember|don'?t know)|lost track|never heard (from|back)|came out (last|in|two)" ; any heading matching the universals pattern with zero anchor matches fails. Strongest version: require a one-line first-silent-response annotation in the page source beside every hook, and fail the build on any annotation starting with Actually, It depends, Not always, Depends, or Says who.
```

| | |
|---|---|
| **Good** | A referral should not disappear after one job. You told your sister about the guy who fixed your water heater. Two years later nobody can name him, including you.  Your house has had work done on it. Somewhere there is a receipt, a name and a date, and you cannot put your hands on any of the three.  Think about the last person who worked on your AC. Now try to remember what he actually replaced. |
| **Bad** | Contractors always overcharge homeowners who don't know what to ask.  Nobody keeps [[Track|track]] of their home repairs.  Most providers won't give you a straight answer on price, and the ones who will are hard to find. |

**Where it does not apply.** Safety, legal and instruction lines stay universal on purpose. "If you smell gas, leave and call 911" is a sentence you want unarguable, and sending a reader off to check it against the time she smelled gas and was fine is the one place this rule gets somebody hurt. Same for any line reporting a fact instead of making a case: a walkthrough step, a status line, a price you are quoting her. Second, the memory has to exist. A first-time buyer, a new build, or a symptom she has never had has nothing to retrieve, and "remember the last time" reads to her as a page written for somebody else, so borrow a memory she does own from a trade she has used (the mechanic, the dentist, the movers) or drop the frame and hand her a fact. Third, do not manufacture the memory. If her honest recall is "my guy was great and he was cheap", that is a true answer and this frame is simply wrong for her, so pick a different true frame instead of fishing for a bad experience she never had. And stop running memory frames past the intake. On the results page and the Job Packet she is reading her own facts back, so asking her to remember something there is selling after the sale.


## 13. Sell the one next step the reader takes tonight, and rewrite every claim about how many providers, choices or comparisons she gets as the single thing she does next.

*Merged in from the GPT canon. Not yet tested against a live correction.*

**Why.** Choice overload cuts both ways: a longer list lowers the odds she picks anything at all and raises the regret of whoever does pick. Underneath that is the real mechanism, which is that every option we hand her is filtering work moved off our desk onto hers, unpaid, at 9pm, in a hot house. A big number looks like inventory to us and reads as a chore to her, because we are counting what we own and she is counting what she now has to do. She already had hundreds of providers on Google, so advertising the size of the pile sells her back the exact problem she came here to escape.

**How to find more.** Two passes, and the second one catches far more than the first.

1. QUANTITY PASS. Find every number, plural or coverage word describing what we have rather than what she does: hundreds of providers, 12 comparisons, 40 trades, nationwide, every category, all your options, choose from. For each one ask the single question WHO DOES THE WORK THIS NUMBER CREATES. If the answer is her, the number is a chore advertised as a benefit. Replace it with the one thing she gets to do next. If the scale is genuinely load bearing, demote it to a quiet line of proof sitting under the step, never the headline and never the button.

2. MENU PASS. This is the same violation at smaller scale and it is where most pages fail. Look at how every section and every page ENDS. Count the calls to action carrying equal visual weight. Two or more and you have built a menu, which is the same transfer of work in miniature: she now has to rank our options before she can start. Pick the one that moves her forward tonight, make it the only button, and turn the rest into plain text links or cut them. Run the same count on nav rows, feature card grids, and any "pick the one that fits you" block.

Three fast tells inside a single line. (a) The word "or" in any call to action, because "Start the walkthrough or browse providers" is two jobs bolted together. (b) Sorting verbs aimed at her: browse, compare, explore, select from, choose from. Those verbs put her in the chair doing the work. (c) Read the page aloud and count how many decisions she makes before she is DOING something. More than one before the first real action means cut back to one.

**Mechanical check.**

```
GATE 1 (candidates, run the who-does-the-work question on each hit):
grep -inE "\b(hundreds|thousands|dozens|[0-9][0-9,]{2,}) of (providers|pros|contractors|companies|options|choices|quotes)\b|\b(choose from|browse|compare|explore|select from|pick from|sort through|all your options|as many as you (like|want)|unlimited|endless|nationwide|every (trade|category|service|provider))\b" page.html

GATE 2 (hard fail, "or" inside a call to action):
grep -inE "<(a|button)[^>]*>[^<]*\bor\b[^<]*</(a|button)>" page.html

GATE 3 (countable, one primary action per page and per section):
grep -oE 'class="[^"]*\b(btn-primary|cta-primary|primary-action)\b[^"]*"' page.html | wc -l
Must equal the number of content sections that own an action, never more. Then check the page's final block on its own: exactly 1 primary button there.
```

| | |
|---|---|
| **Good** | Start the walkthrough. You answer what you can see from where you are standing, and you finish with one Job Packet. It works on anyone you call. |
| **Bad** | Access hundreds of trusted providers. Compare quotes side by side, browse verified profiles, and choose the pro that is right for you. [Find a Provider] [Start a Walkthrough] [See Home Memory] |

**Where it does not apply.** Three places the rule flips. First, a number that counts work WE did that she now skips: "We check 40 published price sources so you do not have to" leaves the labor on our side, so it stays, though it belongs under the step as proof rather than as the offer. Second, priced options laid side by side for one job, which rule 10 asks for on purpose. That is a decision she arrived wanting to make, not filtering we dumped on her, so cap it at three, make them different in kind and not in degree, and say which one most people take. Third, the provider side. A contractor deciding whether to join wants the size of the homeowner pool, because that number is his income rather than his chore. Scale is a benefit whenever the reader is the one being counted for.


## 14. Frame every capture as saving work she has already done, one repair at a time, and put delivered value plus a plain reason in front of anything that asks her to go and do something new.

*Merged in from the GPT canon. Not yet tested against a live correction.*

**Why.** PRN sells the removal of administrative burden, so an onboarding that asks her to become a better record keeper contradicts the product at the exact moment she is deciding whether to trust it. A project frame also makes her price the whole job before she starts: "catalog all your appliances" gets costed at an evening she does not have, so she closes the tab, while "save this repair" gets costed at ten seconds. Framing capture as preserving work already done flips the ask from a cost into a rescue, because effort she has already spent registers as something she owns, and losing it lands as a loss, which is felt far more sharply than a benefit forgone. And asking for new work before we have handed her anything is a commitment request with nothing behind it, which is the shape of every free trial she has already learned to refuse.

**How to find more.** THE SORT. Take every ask on every surface and put it in one of two piles. Pile one captures something she has ALREADY done: the repair that just happened, the receipt sitting in her email, the provider who already came out, the answer she can give without standing up. Pile one is free. Ask for it anywhere, any time, in any volume, because it costs her a tap and it is finished the moment she taps. Pile two asks her to go and do something new: find the model number in the basement, dig out three years of invoices, photograph every [[Appliance|appliance]], decide a service schedule. Pile two only ships with value already delivered above it and a plain reason attached in the same sentence. If neither is there, cut the ask or move it down behind the value.

THE VERB PASS. Gather, organize, complete, set up, build, catalog, upload, import, track and manage all describe a project with no visible end. Circle every one and replace it with the smallest thing that happens right now: save, keep, add this one, remember. If you cannot name the single thing that happens right now, it is still a project, and it gets cut down until you can name it.

THE SCOPE PASS. Look only at the object of each ask. "All", "every", "your home", "your profile", "everything" mean you are asking for the whole house at once. Make it singular and immediate: this repair, this receipt, the one you just had done.

THE METER PASS. Any progress bar, percentage or checklist scoring how incomplete her house is turns a saved repair into an unfinished chore, and now she is behind on something she never signed up for. Show what is saved, never what is missing.

TWO-MINUTE VERSION. Read the ask out loud and answer honestly: when would I actually do that? If the answer is "this weekend", it is a project and it will never happen. If the answer is "right now, while I am standing here", it ships.

**Mechanical check.**

```
Flag candidates on any capture surface, case-insensitive. Each hit is a candidate, run the sort on it.

(1) Project verbs and containers: \b(complete|finish|build|catalog(u?e[sd]?|ing)?|organi[sz]\w*|gather\w*|collect\w*|compil\w*|upload\w*|import\w*|populate|fill (in|out)|set ?up|onboard\w*|inventory|home (profile|binder|records?|file)|digital (binder|record|file)|maintenance (log|schedule)|get started)\b

(2) Whole-house scope in the object of an ask: \b(all (of )?your|every (appliance|repair|record|room|item|receipt|provider)|your (whole|entire) (home|house)|everything)\b

(3) Countable gates a script can enforce:
  a. Zero pile-two asks above the first thing the page has actually given her. Number the asks in DOM order, mark each already-done or new, fail if a new-work ask appears before the first delivered result.
  b. Completeness indicators must equal 0: no element matching \d+ ?% complete|\d+ of \d+ (complete|done|saved)|steps? remaining, and no unchecked list scored against the house.
  c. Every capture button label is 5 words or fewer with a singular object. A plural noun in a capture CTA is a candidate every time.
  d. On Home Memory, "repair" outnumbers "repairs" across headings and buttons. If it does not, the surface is asking for the pile.
```

| | |
|---|---|
| **Good** | You just had your AC capacitor replaced. Save this repair. The date, the part, what you paid, all in one place. Takes about ten seconds. Next time it quits, you are not hunting through email for a receipt from 2023. One repair at a time. [[The Asset With Amnesia|Your house should remember]], so you only have to tell it once. |
| **Bad** | Complete your home profile. Catalog all your appliances, upload your service records, and build your digital home binder so we can get to know your house. Your profile is 12% complete. |

**Where it does not apply.** Two places this flips. First, when she came for the big thing herself. Someone listing her house, or a landlord with 14 units, arrives wanting the whole record on the table, and "one repair at a time" now reads as a tool that cannot keep up with her. If she asked for the binder, hand her the binder and a bulk way in. This rule governs what we ask for unprompted, not what we allow a willing reader to do. Second, when the new work IS the value. The LIVE Walkthrough asks you to go look at your AC and read a label off the side, and that is not admin, that is the product working, because it pays you back with a Job Packet before you sit down again. So the sharper version of the test is not "already done versus new", it is whether the work pays her back in this sitting. Home Memory pays back months from now, which is exactly why it can only ever ask for what already happened. And the provider side has a different reader: a provider's job history is a business asset she gets paid for, so a completeness meter can motivate there where the same meter insults a homeowner.


---

# Words and phrases


## 15. Delete any word, clause, sentence or section that does not tell the reader a new fact, give them a reason to act, or kill a fear they have right now.

**Corrected 24 times.**

**Why.** The mechanism is the dilution effect: adding non-diagnostic detail measurably weakens the persuasive force of the diagnostic detail sitting next to it. So "You never have to hire through us to use it" does not add reassurance, it drains it out of the sentence it is bolted onto. Her reader is in a hot house at 9pm with stress already narrowing working memory, so every extra clause is load spent on nothing and one more thing standing between them and a decision about money. Short, fluent sentences also read as truer and more competent (processing fluency), which is most of what PRN is selling at the moment a stranger is about to quote a price. Cutting is not tidying, it is [[Concentration risk|concentration]]. Fewer words means the ones left hit harder and stay.

**How to find more.** Run a three-job audit, unit by unit, largest to smallest: section, then sentence, then clause, then word. For each unit ask: which ONE job does this do, tell them a fact they did not have, give them a reason to act, or kill a fear they have right now? Say the job out loud in five words or fewer. If you have to reach, hedge, or say "it sets up the next part", the unit has no job. Cut it and reread the paragraph. Then two follow-up passes: (a) if two units name the same job, keep only the shorter one, (b) "reassure" only counts against a fear the reader already has at that exact point on the page. A line answering an objection nobody has raised yet does not reassure, it plants.

Four places filler hides, in yield order. Check these first on any page you have never seen:
1. The tail after the last comma in a sentence. Trailing add-on clauses are the single highest-yield cut on any page.
2. Any sentence that talks about the copy or the page instead of to the reader ("in one line", "here is what that means", "the short version", "before we start"). Scaffolding. The reader does not need the table of contents, they need the thing.
3. Any sentence whose nouns all appeared in the previous two sentences. That is a restatement wearing a new angle. Keep the sharper one, delete the other.
4. Any single word you can delete without changing what the reader would do next. "even", "actually", "simply", "really". Do not memorize a banned list, run the test, because the list is infinite and new ones show up every draft.

Final check on every line that survived: would you say this sentence, in these words, out loud to a person standing in your kitchen at 9pm? Nobody says "You are not required to read the analysis. Ever." out loud.

**Mechanical check.**

```
Flag candidates (each hit is a candidate, not a verdict, run the three-job test on it):

grep -nEi "\b(even|just|simply|actually|really|truly|very|quite|literally|basically|essentially|of course|in fact|in order to|the fact that|needless to say|it is worth noting|feel free to|please note)\b|(^|\. )(So|In short|Simply put|In other words|Ultimately|At the end of the day|That said|The bottom line|What this means)\b|\b(not required to|never have to|you (do not|don't) have to|no need to)\b" copy.md

Three countable gates a script can enforce: (1) flag any sentence over 18 words, (2) flag any sentence with a comma followed by 5 or more words before the period, that is the trailing add-on clause, (3) flag any sentence whose content nouns all already appear in the previous two sentences, that is a restatement.
```

| | |
|---|---|
| **Good** | You get a Job Packet. Hand it to anyone. It works on them all. |
| **Bad** | At the end of the walkthrough you will receive a comprehensive Job Packet, which you can then share with any provider you like, and it is worth noting that you are never required to hire through us in order to use it. |

**Where it does not apply.** Stop cutting at words doing emotional or accuracy work. Permission words are one job word long and they are load bearing: "You can close the tab" and "Close the tab" are the same length in information and opposite in feeling, one is a gift and one is an order. Same for a qualifier that keeps a claim literally true. If deleting "usually" turns a true sentence into a promise PRN cannot keep every time, that word had a job, because a homeowner who catches one overstatement goes back and re-reads everything else suspiciously. The test still holds, those words reassure. What fails the test is a word that only decorates.

<details><summary>Melissa's own words</summary>

> Remove: You are not required to read the analysis. Ever. (words not needed. More we cut the sharper it is and more it stays with them. Increased stickiness to cut words that dont have a job)
>
> * Setback, in one line (you have this in your rules already DONT add empty words in one line gives us NOTHING) Setback - easy what it is (use for reassurance direct or markting) | "NOT ANY extra word."
>
> Change "doesn't care where the quote came from. You never have to hire through us to use it." to "works on them all" or something short. Remove the rest. Wasted words again
>
> Remove "even" from "Who do I even call at 5 a.m.?"

</details>


## 16. Use only words the homeowner already owns, name the actual thing instead of the category it lives in, and keep every word that came from our database, our trade, or our build off the public page entirely.

**Corrected 9 times.**

**Why.** This keeps happening because of the curse of knowledge: once "problem states" is a column name you look at every day, you can no longer feel the half-second stall it causes in a reader who has never seen it. That stall is expensive, because processing fluency gets misread as truth and competence, and a homeowner at 9pm in a hot house has no working memory to spare, so a word that makes her double back registers as "this page is not for me" and quietly lowers how much she trusts the people behind it. For this reader specifically, jargon is also the exact register of getting overcharged, since the contractor who explains why it is $1,800 is the one using words she does not know, so a page that talks that way breaks its own promise in the medium it is making it. Build language like "publication gates" or "the implementation guide" fails the same way with an insult attached, because it tells her she is standing backstage looking at something nobody bothered to finish for her, right at the moment she is deciding whether we are careful enough to trust with money.

**How to find more.** [[Scale Test|THE TEST]] QUESTION. For every noun and adjective on the page, ask: if a homeowner stopped on this word and said "what does that mean?", would my honest answer describe HER HOUSE or describe OUR SYSTEM? If the answer describes our system, it is our word, not hers. Cut it. Run four passes.

1. ORIGIN PASS. For each noun, ask where you first met the word. If the answer is a database column, a spec, a code file, a spreadsheet header, a permit, an invoice, or a supplier catalog, it is borrowed and it goes. Replace it by walking one level DOWN the ladder toward the physical object, not sideways to a fancier synonym. "Machine" goes to "equipment" goes to "your mower, your snowblower, your ATV." Stop at the level where the reader can picture the thing.

2. UMBRELLA PASS. Any word that covers many different things at once (unit, system, item, asset, component, solution, configuration, equipment, resource) is almost always on the page because one field in our data had to hold many kinds of thing. That is our storage problem, not her sentence. Name the real things.

3. READ-ALOUD STALL PASS. Read the page out loud at normal speed. Mark every spot where you slow down, re-read, or where a smart friend could fairly ask "what do you mean by that here?" The test is NOT "is this word rare." It is "does this word have exactly one obvious meaning at reading speed?" This is the pass that catches ordinary English used strangely, which is the hardest class to see: "sensible," "moves with," "circulation," "clearance." Common words can still cost a double take.

4. BACKSTAGE PASS. For each sentence, ask: does this describe the reader's house, or does it describe how we built this? Anything about our process, our gates, phases, waves, versions, roadmap, data handling, consent flags, placeholder assets, or decisions we have not made yet is backstage. It does not get softened into nicer language. It gets deleted.

TWO-MINUTE VERSION for a page you are skimming: read only the headings and the button labels out loud to someone who does not work here. Every word they repeat back with a question mark in their voice is a hit.

**Mechanical check.**

```
Two regexes and one countable property.

(1) Known leaks, case-insensitive, whole word: \b(problem states?|branch(es|ing|ed)?|footprint|circulation|clearance|sensible|anonymiz\w*|machine[sd]?|moves with|node[s]?|schema|payload|toggle|config\w*|parameter[s]?|threshold[s]?|ingest\w*|render\w*|instrument\w*|telemetry|utiliz\w*|leverag\w*|optimiz\w*|remediat\w*|unit[s]?|asset[s]?|component[s]?|solution[s]?)\b

(2) Backstage language, zero tolerance on anything public: \b(implementation guide|spec(ification)?s?|gate[sd]?|phase \d|wave \d|v\d+(\.\d+)?|TODO|TBD|placeholder|lorem|stub|MVP|backlog|sprint|ticket|acceptance criteria|feature flag|rollout|consented|opt-?in flag|per the (doc|spec)|see (the )?(guide|doc))\b

(3) Countable property a script can gate on: build a word list from our own code identifiers, database column names and internal docs (split camelCase and snake_case into separate words), then intersect it with the distinct words on the public page. Every word in the intersection that is not a plain household object is a leak. Second gate: flag any word on the page outside the top 5,000 most common English words that is not a brand name and not a part a homeowner could find printed on her own equipment.
```

| | |
|---|---|
| **Good** | Other AC problems that start this way  We ask what you can see, one question at a time. Your name and address stay off the report you hand to whoever comes out. |
| **Bad** | Related problem states  Your walkthrough branches on the machine's footprint and clearance. Results are anonymized before the image publication gates in the implementation guide pass. |

**Where it does not apply.** Not every trade word is jargon. If the homeowner has already met the word before she got here, use it. "Capacitor," "breaker," "condenser," "R-410A" are words people type into Google at 9pm because a contractor said them on the phone, or because they are printed on the box in the side yard. Stripping those out hurts twice: it kills the exact search terms the door page exists to catch, and it withholds the vocabulary she needs to not get rolled on price, which is the whole point of PRN. So the rule is not "never use a technical word." It is "never use a word she had no way to meet." When the real word is both unavoidable and useful, use it and define it in the same breath: "the capacitor, a part about the size of a soda can that helps the motor start." Second exception: the Job Packet has a different reader. It gets handed to a pro, so it can carry the pro's terms and part numbers. The public page cannot.

<details><summary>Melissa's own words</summary>

> why does it say Related problem states? that is computer language- related problems --> see if we can modernize this more . it looks like an old section.
>
> “Sensible” is jargon or slang people have to do a double take to try to understand. NEED it simple, easy, low [[Cognitive burden|cognitive load]] throughout- changes is better or depends on
>
> -dont use word machine- i already said that. people cant relate- equipment and spell out actual things mower, snowblower, ATV, etc
>
> we wouldn't want this on the page correct? "Replace or supplement with real consented photos only after the image publication gates in the implementation guide pass."

</details>


## 17. Delete any sentence that announces, counts, or grades the copy itself, and open with the first real thing instead.

**Corrected 6 times.**

**Why.** A meta-line spends the reader's attention on the writing instead of on her house. She is standing in a hot hallway at 9pm with narrowed working memory, and a sentence that only describes the shape of the next four sentences is pure cognitive load: she has to carry a count while she reads, and the count tells her nothing about her AC. The grading version is worse, because "that's the whole product" hands her a conclusion before she has seen any evidence, is almost never literally true, and a homeowner already braced for a sales job meets a premature conclusion with reactance instead of agreement. Trust here gets built by letting her reach the verdict herself, one concrete fact at a time.

**How to find more.** Run four passes over the page. (1) Subject test: for every sentence, ask what it is actually about. If the answer is the copy itself (the list, the section, the product-as-a-whole, how many parts come next) rather than her house, her money, her time, or her next step, flag it. (2) Deletion test: cut the flagged line and read the passage cold. If the only thing now missing is an announcement of what was coming, it was meta. Something real would leave a hole. (3) Number test: a number is a fact when it counts something in her world (three photos, two minutes, one page, $89 diagnostic) and a meta-line when it counts pieces of the writing (four things, three moments, it settles four questions). Ask what the number would still be counting if you deleted the page. (4) Verdict test: could the sentence appear in the writer's own review of his draft? "That's the whole product." "Add it up and it's the same sentence." "It does all of it at once." Those are the writer grading his own work, so cut them and let the items earn the verdict. These cluster in three spots, so check them first: the sentence right before any list or bullet block, the first line of any section, and the closing line of any section.

**Mechanical check.**

```
Regex sweep: (?i)\b(one|two|three|four|five|six)\s+(things?|moments?|reasons?|steps?|parts?|points?|questions?|ways?|pieces?|ideas?)\b|\b(that|this|it)'?s\s+(the\s+)?(whole|entire|complete|point|product|idea|deal)\b|\badd\s+(it|them|that)\s+up\b|\ball\s+(at once|in one)\b|\b(here'?s what|what follows|below you'?ll|in short|to sum)\b — plus two structural gates a script can count: every sentence immediately preceding a <ul>/<ol> or bullet block is a candidate and must be reviewed, and the count of numerals referring to items of copy rather than to things in the reader's world must be zero.
```

| | |
|---|---|
| **Good** | The walkthrough asks what you see, what you hear, when it started, and what you already tried. You hand the answers to any tech on one page. |
| **Bad** | Four things, built to add up to one sentence. What you see. What you hear. When it started. What you tried. Add it up and it's the same sentence. That's the whole product. |

**Where it does not apply.** A number that measures her work instead of your writing stays. "Six questions, about two minutes" ahead of the walkthrough is a labor estimate, and telling her the size of the ask before she starts lowers the cost of starting rather than taxing her. Same for steps she will physically perform: "Take three photos" is an instruction, not an announcement. The rule bans counting the copy, not counting the work, and it does not ban numbered lists.

<details><summary>Melissa's own words</summary>

> Remove- Four things, built to add up to one sentence.
>
> Remove “ three moments”
>
> Remove: Add it up and it's the same sentence: l → make capital L for Less (empty words)
>
> Remove That's the whole product. NEVER say something liek that. Tacky. Never true and wasted words as it isnt telling them anything.

</details>


## 18. Never let the page describe itself as honest, transparent, candid, truthful or clear; state the checkable fact and let it carry the credibility on its own.

Corrected 5 times.

**Why.** This is cheap talk in the signaling-theory sense: a signal only carries information if it costs something to send, and "honest" is free, so the contractor about to overcharge her reader can type the identical word. A homeowner sweating in her kitchen at 9pm is already running a scam filter on every stranger, and these are the exact words that filter is tuned to, because upsell scripts open with them. Worse, saying "honest" introduces the frame of dishonesty to a reader who had not raised it yet, so the phrase spends attention and buys doubt. What actually costs us something, and therefore reads as true, is a number, a limit, or an admission we could have hidden.

**How to find more.** Run two passes. Pass one, the bad-actor test: mark every phrase where the page describes its own character or intent rather than a fact about the reader's AC, the job, or the money. For each mark, ask whether the worst contractor in the state could print that exact phrase on his own site without technically lying. If he could, it carries no information and it goes. Pass two, the deletion test: for every sentence opener that announces the tone of what follows, delete the opener and read the sentence again. If the meaning is unchanged, it was throat-clearing and stays deleted. Then repair, do not just cut: whatever made the writer reach for "honest" is almost always a real fact sitting one layer down, so surface that instead. Every self-description that survives both passes should be something the homeowner can check within the hour.

**Mechanical check.**

```
Case-insensitive grep, expect zero matches outside quoted customer reviews: \b(honest(ly|y)?|transparen(t|cy|tly)|candid(ly)?|truthful(ly)?|frankly|genuinely|authentic(ally)?|unbiased|impartial|real talk|straight talk|truth be told|in all honesty|no (fluff|gimmicks|BS|games|catch|hidden agenda)|to be (clear|blunt|honest|frank|fair)|let (us|me|'?s) be clear|the (reality|truth|fact) is|trust us|we promise)\b
```

| | |
|---|---|
| **Good** | We cannot read your refrigerant level from here. Nobody can without a gauge on the line. Ask the tech for the number he reads, and ask him to write it on the invoice before you approve any work. |
| **Bad** | Let us be clear: this is the honest comparison. Truthfully, we are the only transparent tool that will tell you what your AC really needs. |

**Where it does not apply.** The rule bans claiming the virtue, not teaching it. When the word describes a third party and comes with a test the homeowner can run tonight, keep it: "An honest quote splits parts and labor. If yours is one number, ask him to break it out." That word is working, because it hands her a criterion. Also do not let an over-eager pass strip first-person admissions of limits. "We cannot measure that from here" is the opposite of this error; it costs us something to say, which is why it lands. And never edit the word out of a quoted review. Those are her customer's words, not ours.

<details><summary>Melissa's own words</summary>

> remove: This is the honest comparison against what you would otherwise be doing right now.- Add to wording rules NEVER say honest in this ocntextempty ai word
>
> REMOVE: And what no honest tool can settle without a meter. Both matter.dont put things under these tables
>
> Same family, also banned: "transparent", "candidly", "truthfully", "let us be clear", "the reality is".
>
> Never say honest in this context, empty ai word

</details>


## 19. Cut the filler, the generic adjectives, and the explanation that keeps running after the point has already landed, and leave standing the concrete noun, the contradiction, the consequence, the odd specific number, and the phrase somebody would repeat out loud.

*Merged in from the GPT canon. Not yet tested against a live correction.*

**Why.** Short and distinctive are two different axes, and rule 1 only moves one of them, so a writer applying it hard drifts into lines that are tight and interchangeable. The word carrying the distinctiveness is almost always the unusual one, which is exactly what a length pass reaches for first: sitting next to plain words it looks decorative, and it is also the part memory actually keeps, because the odd item in a set gets recalled while the even ones blur together. This reader is not reading one page, she is four tabs deep at 9pm comparing strangers, so a sentence any competitor could publish verbatim hands her nothing to choose with and costs her nothing to close. A slightly longer line she repeats out loud to whoever else is in the house beats a tight one she has forgotten by the time she scrolls past it.

**How to find more.** Run this pass AFTER rule 1's three-job audit, on the lines that got shorter, never instead of it. Five gates.

1. THE COMPETITOR TEST. Read the surviving line and ask whether a company you have never heard of could paste it on their page tonight, unchanged, and have it fit. If yes, the cut took the wrong thing out. This is the whole rule in one question, and it catches the defect no filler regex will ever see, because the sanded line contains no filler.

2. THE FIX HAS A DIRECTION. Failing the competitor test does not mean add words back. Restore the specific detail, then pay for it out of the filler in the same sentence, so the line lands about the same length and is now unlike anyone else's. If you only lengthen, you have undone the cut instead of aiming it.

3. THE REPEAT TEST. Point at the exact words in the sentence a reader would say out loud to whoever else is in the house. Point at them, do not vaguely gesture. If you cannot find any, the line has been sanded flat, even at nine words.

4. THE SURVIVOR LIST, run before you cut. Mark the five things not allowed to leave: the concrete noun (your capacitor, the $19 part at the hardware store you already drive past), the contradiction (the cheapest fix is the one nobody quotes), the consequence (what tomorrow costs if she does nothing), the odd specific number ($431, 11 minutes, 3 photos), and any phrase with a rhythm to it. Everything else is fair game. A cut that lands on the marked list is a lazy cut, so take that one back and find the words somewhere else.

5. THE ADJECTIVE SWAP. Reverse every adjective still standing. If the sentence still sounds like something PRN would say either way (fast or thorough, simple or complete, trusted or independent), the adjective was generic and it goes. An adjective that breaks the sentence when you flip it is carrying meaning and stays.

6. THE STOPPING POINT. Find the word where the point lands, then read what comes after it. Explanation continuing past the landing is the highest-yield cut on any line, and the distinctive detail almost never lives back there, so that is where the words should come from first.

When you deliberately keep a longer line, write one line on the test-pass list saying what it was protecting, and keep writing.

**Mechanical check.**

```
(1) Generic adjective sweep, each hit is a candidate, not a verdict:

grep -nEi "\b(fast|easy|simple|seamless|smart(er)?|powerful|reliable|professional|quality|comprehensive|effortless|hassle[- ]free|peace of mind|state[- ]of[- ]the[- ]art|cutting[- ]edge|best[- ]in[- ]class|world[- ]class|top[- ]notch|great|amazing|robust|streamlined|innovative|premium)\b" copy.md

(2) Distinctiveness density, countable. For every heading, hero line, card body and button-adjacent sentence, require at least ONE of: a numeral, a "$" figure, an approved product name (LIVE Walkthrough Tool, Job Packet, Home Memory, HouseKeep, Trust Network), or a physical noun from this door's own vocabulary (capacitor, breaker, filter, vent, thermostat, drain pan, blower, condenser, driveway, shed). Fail any line carrying none of them.

(3) Interchangeability, cross-page. Build the set of every sentence of 6 or more words across the batch. Fail any sentence appearing on 3 or more different door pages, and any sentence containing no noun unique to its own page. This is the mechanical form of the competitor test.

(4) Post-cut regression, the highest-value gate. Diff pre-cut against post-cut copy and fail any edit that removed a numeral, a "$" figure, an approved name, or a word that appeared exactly once on the page. Deleting the only instance of a word is the signature of this defect.
```

| | |
|---|---|
| **Good** | 11 minutes, and you never open a panel. You point your phone at the box outside and answer what you can see. Then any provider gets a Job Packet with your model number already on it, so the guessing part of the price conversation is over before anyone pulls into your driveway. |
| **Bad** | Simple, fast, and reliable. Get your report in minutes. Quality service you can trust. |

**Where it does not apply.** Controls are supposed to be interchangeable. A button that says Start, a field labeled Your address, a table header reading Cost, the legal line at the bottom: those work by being the same words everyone else uses, so do not run the competitor test on anything the reader operates rather than reads. Distinctive also does not mean rare. If the unusual word is unusual because it came out of our database or our trade, rule 2 still takes it, since a word earns its place by being specific to her house, not by being uncommon. And a distinctive line stops being distinctive once it is on 40 [[door pages]]. When your best phrase is on every page in the batch it has turned into furniture, rule 24 wants it gone, and it goes back on the list of things that can be cut.


---

# Voice and person


## 20. Write every heading, button, label and value line in second person and name the reader's own concrete thing — your AC, your shed, my lot — never "it", never "your equipment", never a line that would fit unchanged on any other page.

**Corrected 12 times.**

**Why.** Two mechanisms stack. Self-referential encoding: text tied to the reader and her property is processed against her self-schema, so "your AC" lands as a fact about her house while "the unit" lands as background she can skim, and psychological ownership finishes the job by making the walkthrough feel like work on her AC rather than a form about air conditioners. At 9pm in a hot house, deciding whether a stranger deserves her money, specificity is the only evidence of attention she can get for free: a page that names her thing was clearly built for her problem, while "your equipment" is the exact tell of a generic script that would say the same words to anybody. Vague nouns also charge her a translation step — she has to convert "equipment" into the box outside her back door — and at that hour she has no spare attention to spend. This is not decoration; it is the whole differentiator, because the promise of the product is that it works on her specific situation and the copy has to prove that in the first line she reads.

**How to find more.** Run three passes over every heading, subhead, button, tab, form label, tooltip and value line. PASS 1, the transplant test: could this exact string be pasted onto a page about a completely different problem — a leaking water heater, a [[Garage Door|garage door]] off its track — and still make sense? "Tell us what it is doing" transplants. "What is your AC doing right now?" does not. Anything that transplants names nothing of hers; rewrite until the line only works on this page. PASS 2, the pointing test: for every possessive on the page, ask whether she could walk across the house and put a hand on that noun. "Your AC", "your shed", "your driveway", "your lot" pass. "Your equipment", "your system", "your setup", "your situation", "your needs", "your project" fail — they are categories, not objects — so swap in the object. PASS 3, the pronoun sweep: every "it", "this", "that", and definite "the" standing in for her thing gets the thing's name back. Then one last read of the buttons alone, in a list: each one should sound like something she would say about her own thing ("Show me what my AC is doing") or something said straight to her, never a system announcing a step ("Get Started", "Continue", "See What Applies").

**Mechanical check.**

```
FAIL grep (vague category nouns): (?i)\b(your|the|this|our)\s+(equipment|unit|system|device|appliance|machine|item|product|setup|situation|space|structure|area|needs?|requirements?|project|issue|problem)\b — zero hits allowed. COUNTABLE GATE: extract every heading, button, tab and form-label string; each must match (?i)\b(your|my|you|I)\b AND contain a page-specific concrete noun from that door's subject list (ac, furnace, shed, water heater, lot, driveway, roof). Failures must be 0. BUTTON GREP: (?i)^\s*(get started|start|begin|continue|next|submit|learn more|see|view|check)\b on any button or CTA string is an automatic rewrite.
```

| | |
|---|---|
| **Good** | What is your AC doing right now? [ Show me what my AC is doing ] You walk in with a packet about your AC. Not a printout about air conditioners. |
| **Bad** | Tell us what it is doing. [ Get Started ] See which options apply to your equipment. |

**Where it does not apply.** Drop the possessive when the sentence would assert something about her thing that PRN has not seen. "Your AC has a refrigerant leak" is a diagnosis the walkthrough cannot make, and naming her unit there turns a helpful pattern into a false promise she can catch us on. In those lines the general form is the honest one: "A unit that ices over like this usually has..." Keep "your" in the question and in what she is handed; let the explanation stay general. Second exception, rhythm: in body copy, four "your"s stacked in one short paragraph starts to read like a sales letter, so name her thing once in the paragraph and let pronouns carry the rest. The rule is absolute for headings, buttons, labels and value lines; body copy only has to keep the ownership clear.

<details><summary>Melissa's own words</summary>

> All CTA buttons need wording updated to sticky hoooks that reinforce in YOUR Home, YOUR AC (dont say your equiment as that is vauge)
>
> Tell us what it is doing --> WEAK Tell us what YOUR SPECIFIC AC is doing (or something like that)
>
> * The titles need ownership - example What do you want your shed to sit on? | * not see what applies but show me what applies to my shed
>
> IS the TOP ESPECIALLY but ALL through EMPHASIZING the SPECIFIC storage needs equipment etc NOT general that is the MAIN differentiator and I dont see it strong enough.

</details>


## 21. Hand the reader the choice instead of the order — write "you can," not "do this" — and spend a bare command only where the reader has already said yes.

**Corrected 6 times.**

**Why.** The mechanism is reactance: when someone's sense of control is already under threat, an instruction provokes a push back against being instructed, separate from whether the advice is good. Her reader at 9pm is being told what to do by everyone else in the story — the tech who wants to replace the whole system tonight, the quote with a deadline printed on it — so a page that also gives orders gets sorted into that same pile of people who want something from her. "You can close the tab" does the opposite work: a page that says it is fine to leave is giving up something to say it, and that costliness is what reads as proof it is not trying to trap her. It is also plain load relief — an imperative adds one more task to a person already holding too many, while "you can" adds an option she is free to ignore.

**How to find more.** Run a you-sentence pass over the page. Mark every sentence that is about the reader, in three forms: bare-verb sentences with an implied "you" ("Close the tab," "Be home"); explicit obligation ("you must," "you need to," "make sure you"); and — the one people miss — any label, default, toggle, or heading that assigns the reader a state or a behavior rather than offering one ("Away by default," "Homeowner present"). For each mark, ask two questions. First: could the reader do the opposite and still be fine with us? If yes, the sentence is quietly taking away a choice that actually exists, so hand it back — "you can," "if you want," "the options are yours," "or not, up to you." Second: read it aloud in the voice of the salesman standing in the driveway who wants the job signed tonight. If it sounds natural in his mouth, it is a demand no matter how warm the wording. Then count what survives outside of button labels: one or two bare imperatives per page, and they belong at the moment the reader has already committed. Three or more and the page has turned into a manual. Headings and settings labels count in that tally — an order in bigger type is still an order.

**Mechanical check.**

```
grep -nEi "(^|[.!?\"”)]\s+)(Go|Stop|Close|Open|Call|Click|Tap|Take|Snap|Make|Check|Try|Start|Stay|Be|Do|Don't|Keep|Send|Ask|Give|Grab|Read|Turn|Use|Wait|Look|Add|Pick|Choose|Set|Save|Leave|Show|Tell|Find|Skip|Hold|Put|Remember|Just|Never)\b|\byou (must|need to|have to|should)\b|\b(make sure you|be sure to|don't forget to|by default)\b" page.html — Gate: excluding text inside <button> and link labels, total matches must be <= 2 per page, AND the permission count from grep -cEi "you can|you're free to|if you want|up to you|no need to|the (choice|options) (is|are) yours" must be >= the imperative count. Any "by default" hit is a manual-review flag, not an auto-fail.
```

| | |
|---|---|
| **Good** | You can stop here and come back after dinner. Nothing you typed goes anywhere until you say so. If you already have three photos of your AC, great. If not, that's fine too. |
| **Bad** | Don't stop now. Snap three photos of your AC and finish the walkthrough. Make sure you do this before you close the page. |

**Where it does not apply.** Inside the live walkthrough, once the reader has said yes and is standing in front of their AC with a phone in hand, short commands are the kind form: "Open the panel. Read the number off the sticker." Softening a physical step into "you can open the panel if you'd like" makes them stop and work out whether it is optional, which is exactly the work the tool exists to remove. Two other exemptions: button and link labels ("Start," "Send it") are names for an action the reader already chose, not orders — never pad those with "you can" — and real danger earns a real command, so "If you smell gas, get out and call the gas company" stays as written. The test is consent: has the reader already opted in to being told what to do, for this step, right now.

<details><summary>Melissa's own words</summary>

> Close the tab. Go live your life. Change to → You can close the tab. And go live your life. (ba careful wording thins that are demands like that. Use VERY sparingly.)
>
> Be home.change to "Go for it." The options are yours.
>
> remove: stop reading and
>
> Option to not be there or something instead of "Away by default"

</details>


## 22. Blame the process, never the person: turn every "you can't" into "you don't want to," and use a trade term only on the page that explains it on the spot.

Corrected 5 times.

**Why.** "A page you can't read" is a face threat. It names a deficiency in the reader at the exact moment they are already afraid of being taken for a fool by a stranger with a truck, and people defend against face threats by rejecting the source, so the line meant to prove you are on their side proves the opposite and they close the tab. Move the deficiency onto the document, the quote, or the hour of the night, and the same fact stays true while you and the homeowner end up on the same side of it, against something that was built badly. Unexplained trade words do the identical damage silently: that is the curse of knowledge, and the woman who stalls on "allowance" at 9pm in a hot house does not conclude the page is unclear, she concludes she is not smart enough to be doing this, and stops.

**How to find more.** Three passes over the page.

1. SUBJECT PASS. Highlight every clause whose subject is the reader: "you," "your," "homeowners," "most people," "customers." For each one ask: is this sentence only true if the reader is lacking something (knowledge, ability, attention, nerve, time)? If yes, keep the fact and move the blame onto the document, the quote, the trade, or the clock. Then test the swap: if "you don't want to" is also true, use it, because it is truer. Nobody wants to read fourteen pages at 9pm. That is a preference, not a defect.

2. KITCHEN TEST. Read each of those highlighted lines out loud as if the homeowner is standing across the counter from you. Anything you would soften, laugh off, or apologize for in person is the line to fix. "You can't read this" fails. "Nobody writes these to be read" passes.

3. STRANGER-NOUN PASS. Circle every noun a neighbor would not say out loud: allowance, scope, keys, packet, load calc, delta T, tonnage. For each, find the words on THIS page, within one sentence of first use, that tell a first-timer what it is and why it matters to them. A link, a later section, a tooltip, or a different page does not count. No gloss on this page means define it in plain words right there or cut the word. Then reread the page start to finish as someone who has never heard of PRN and mark every spot where you would have to ask "what does that mean?" or "what are you asking me to do?" That count has to be zero before the page ships.

**Mechanical check.**

```
Two checks.

Incapacity regex, case-insensitive, flag every hit for human review:
\b(you|your|they|homeowners?|customers?|most people|folks)\b[^.?!\n]{0,60}\b(can'?t|cannot|can not|unable|not able|don'?t know|doesn'?t know|wouldn'?t know|no idea|don'?t understand|won'?t understand|don'?t realize|too (complicated|technical|confusing|much) for|over your head|in over your head|get(s)? confused|confus\w+|overwhelm\w+|struggl\w+|fail to|forget to|miss(es)? it)\b

Glossary gate, countable: keep a project term list (allowance, scope, keys, packet, load calc, delta T, line set, capacitor, tonnage, SEER). For each term appearing on a page, the FIRST occurrence must have a gloss within 120 characters on the same page, matched by /(is|means|that's|that is|\(|,\s*which)/ following it. Count of unglossed first occurrences must equal 0.
```

| | |
|---|---|
| **Good** | You are about to approve a page you never asked to read. It was written for the office, not for your kitchen table. Here it is in plain words, so you can set two quotes side by side and see what is actually different. |
| **Bad** | You are about to approve a page you can't read. Most homeowners don't know what an allowance is, so they just sign it and hope. |

**Where it does not apply.** When the limit belongs to the equipment, the law, or the clock instead of the reader, say it straight. "You can't see the coil without pulling the panel" is a fact about your AC, and "that capacitor holds a charge even with the power off" is a fact that keeps someone from getting hurt. Softening those into "you may not want to" is vague where vague is dangerous. Attach the hard "can't" to the thing, never to the person. The flip side is just as real: this rule bans unexplained terms, not terms. On the page whose whole job is teaching what an allowance is, teach it properly, and do not pad every other line with reassurance a busy reader has to wade through. Busy, not stupid, cuts both directions.

<details><summary>Melissa's own words</summary>

> We can't say this although i like the point as its sort of derogatory… You're about to approve a page you can't read….maybe you dont want to read and apples to apples point?
>
> What do you mean by "allowance" if i dont understand the ocnnection is too difficult to come at a dime for sometone- change on this page. You explain it enough it is great on quote page but NOT here
>
> [[Do not position the customer as incapable]]; [[Do not position the customer as incapable|position the process as poorly designed]] for a real life.
>
> for the keys I dont understand what that is or what implication/what you are asking

</details>


## 23. Put the count right behind every congratulation — the equipment identified, the photos captured, the causes ruled out, the packet built — and where nothing countable can follow, drop the praise and lead with the count on its own.

*Merged in from the GPT canon. Not yet tested against a live correction.*

**Why.** Praise with nothing behind it is a mood-management move, and a capable adult at 9pm can tell the difference between being helped and being handled; it costs trust at the exact moment she is deciding whether this tool is worth handing a stranger money over. Competence is felt from evidence, not applause, so an itemised account of what she just produced does the job the cheerleading was aiming at, and does it in her own facts. The list also turns effort into a visible balance: 4 photos and 2 ruled-out causes are something she now owns and would lose by closing the tab, which is what carries her into the next screen instead of out of it. And it quietly answers the question she has not asked out loud, which is whether this thing actually did anything, the hardest sale on the page.

**How to find more.** Run three passes over every surface, not just the walkthrough: headings, toasts, step transitions, progress bars, buttons, empty states, confirmation screens, email subject lines.

1. THE NEXT-LINE PASS. Find every congratulatory or encouraging phrase and read only the line after it. Point at the countable thing sitting there: a number, a list of named items, a file that now exists. If you cannot point at one within a line, the praise is unearned. Attach the count, or delete the praise and open with the count instead.

2. THE THUMB PASS. Cover the praise and read what is left. If the remaining line still tells her what she has, the praise was decoration and comes out. If covering it leaves nothing, the screen had no content, only encouragement, and the fix is to go find what she actually produced and say that.

3. THE SELF-REASSURANCE PASS. Same test on anything the page says to comfort her about itself: "you're in good hands", "we've got you", "this only takes a minute", "almost there". Each needs a countable thing within a line — questions left, minutes measured, providers who read a packet last month — or it comes out too.

New instances arrive as tone rather than as banned words: an exclamation mark in a heading, a checkmark animation over a bare "Done", a percentage bar labelled "You're crushing it", a step counter that celebrates the step instead of naming what the step captured. Any line whose only job is to make her feel good about herself is a candidate. A line that makes her feel good by telling her what she now has is the repair.

**Mechanical check.**

```
Case-insensitive flag-for-review regex: \b(great|nice|good|awesome|amazing|fantastic|excellent)\s+(job|work|going)\b|\bwell done\b|\bnicely done\b|\bway to go\b|\bkeep (it up|going)\b|\byou'?(ve)?\s*got this\b|\byou'?re (doing great|crushing it|a (rock ?)?star|all set|in good hands)\b|\bwe'?ve got (you|this)\b|\balmost there\b|\bhigh ?five\b|\bcongrats?\b|\bcongratulations\b|\bhooray\b|\bwoo ?hoo\b|\bsuccess!|\bdone!|\bperfect!|\ball set!  — plus any exclamation mark inside an h1, h2, toast or button label.

Countable gate: for each match, the match's own line plus the next line must contain a digit or one of the artefact nouns (photo|photos|model|serial|make|plate|cause|causes|answer|answers|step|steps|question|questions|packet|record|minute|minutes|provider|providers). Matches failing that gate must be zero before publish. Digits of 0 do not satisfy the gate: /\b0\s+(photo|answer|step|cause|question)/ fails, because an empty tally is not proof of anything.
```

| | |
|---|---|
| **Good** | End of walkthrough: "You did it. Your model and serial are off the plate, 4 photos are attached including the iced line, 2 causes are ruled out, and your Job Packet is ready to send." Mid walkthrough: "3 of 7 answered. Your outdoor unit is identified and your filter photo is in." Home Memory: "That is repair number 6 on file for your house. Anyone you call can see the last two visits without you digging for a receipt." |
| **Bad** | "Great job! You're crushing it." "43% complete. Nice work so far!" "Almost there, you've got this!" "Your walkthrough is complete. Way to go!" "You're in good hands." (Five screens of applause and not one thing she can point at. She has no idea what she made, and neither, apparently, does the tool.) |

**Where it does not apply.** Three places the count is wrong. First, a bad ending. When the walkthrough lands on a gas smell, carbon monoxide, or a number she cannot afford, a tally of her photos next to "get out of the house and call from outside" is ghoulish and softens the one instruction that matters; there the line is plain and short, and the count waits until after the safety step. Second, empathy about the situation is not praise and needs nothing attached. "That is a miserable hour to be dealing with this" is aimed at her night, not at her performance, so the rule does not touch it; the test only fires when the page is congratulating her on something she did. Third, an empty or barely started screen. Do not manufacture a tally to satisfy the gate, because "0 photos captured" reads as a scolding; on a first screen say what one photo will do for her instead, and start counting once there is something to count.


## 24. Locate the problem in the structure she is standing in: information scattered across ten places, the same research redone for every quote, trust she already built thrown away, every provider starting her house at zero, the whole history of the house living in her head; then check each value line by asking whether the homeowner who has replaced her own capacitor nods harder at it, not less.

*Merged in from the GPT canon. Not yet tested against a live correction.*

**Why.** A pitch built on her not knowing is a face threat landing at the worst possible moment, because she is already braced to be treated as the mark by a stranger with a truck, so she defends her competence by rejecting the source and the page that meant to help gets sorted onto the pile with the salesman. The structural version does the opposite work: it is an attribution shift, and she has spent years quietly blaming herself for a coordination failure nobody ever built a system for, so hearing the burden named out loud lands as recognition and relief instead of diagnosis. It also sets the ceiling on the business, because value premised on ignorance evaporates the second she learns something, which caps the market at novices and makes every customer worth less the longer she stays, while a fragmented record is still fragmented for an expert and a discarded history is still discarded. And the capable homeowner is the one who gets asked for the referral, so a message she cannot repeat to a neighbour without insulting herself never leaves the page.

**How to find more.** Four passes, run on the pitch rather than on the manners. Note first that this is not the same rule as blame-the-process: a page can be perfectly courteous, never say "you can't", and still rest its entire reason for existing on her not knowing things. PASS 1, THE PREMISE PASS. Underline every sentence that says why PRN exists or why this beats what she is doing now: the hero subhead, the "why this is your answer" block, every "that's why we built", every section lead. For each one, finish this sentence out loud: "This line only works if she..." If the completion is about what she does not know, cannot judge, would not think to ask, or is not qualified to decide, the value is sitting in her head and the line has to move. PASS 2, THE SOPHISTICATION TEST. Hand the line to the homeowner who replaced her own capacitor last summer, keeps every receipt in a folder, and can read her own model number. Does she nod harder, or shrug and think "that's not me"? Nodding harder means the burden is real and structural. Any line that gets weaker as the reader gets smarter is a weak category narrative, and it is unrepeatable by exactly the neighbour whose recommendation we want. PASS 3, THE CONVERSION MOVE. Do not delete a flagged line, relocate it. Ask one question: if she knew exactly what was wrong, what would still be broken? The answer is always structural, and the answer is the new line. Three places to look. (a) UNPAID WORK: she is doing the coordinating, the retelling and the record keeping for free, and knowing the diagnosis does not make one minute of that go away. (b) SCATTERED INFORMATION: the history of her AC lives in her head, a drawer, and a phone number that stopped working, so nobody she calls has read it. (c) DISCARDED TRUST: every provider starts her house at zero, every quote starts her at zero, and the four hours she spent last August bought her nothing this August. Choice overload and reset-to-zero service belong in the same family. Worked swap: "You don't know what a fair price looks like" becomes "You can find out what a fair price is. You just have to do it again for every quote, and nobody keeps the answer for you." PASS 4, THE OVERCORRECTION CHECK. Do not flip into flattery. "You already know what's wrong, you just need us" is its own lie and reads as buttering her up. The finished line assumes she is capable and still names something real that being capable does not fix.

**Mechanical check.**

```
Competence-premise regex, every hit is a rewrite candidate: (?i)\b(you|your|she|they|homeowners?|customers?|most people|folks)\b[^.!?\n]{0,70}\b(shouldn'?t have to (know|understand|learn|be)|don'?t (know|understand|realise|realize)|no idea|not qualified|aren'?t an expert|without (being|having to be) an? (expert|pro|technician)|expert decisions?|before (you|they) (even )?know what|not supposed to know|over your head|out of (your|their) depth|know what to ask|speak the language|too (technical|complicated) for)\b — then run it again with the two halves reversed. NEAR-CERTAIN VIOLATION, count must be 0: any hit inside an h1, h2, hero subhead, or a sentence containing "that's why", "which is why", "we built", or "PRN exists". COUNTABLE GATE for the other half of the rule: the page's value copy must contain at least one match for a named structural burden — (?i)\b(again|every time|twice|three times|start(s|ing)? (over|from zero|at zero)|from scratch|scattered|spread across|no record|nowhere|lives in your head|in a drawer|retell|repeat(ing)? (it|yourself)|explain(ing)? it again|keep(ing)? track|coordinat|line them up|carr(y|ies) over|nobody kept)\b — zero matches means the burden was never named anywhere, and a page that never names the burden is almost always leaning on her head instead.
```

| | |
|---|---|
| **Good** | You could know exactly what is wrong with your AC and still be stuck. You still have to explain it four times to four strangers, and hope the fourth one writes it down. Your AC has a history. It just lives in your head, and nobody you call has read it. Walk through it once and you hand them the packet instead. |
| **Bad** | Homeowners are forced to make expert decisions before they know what the problem is. You shouldn't have to understand complicated systems just to get help. Most people have no idea what a fair price looks like, so they sign and hope. |

**Where it does not apply.** Say it straight when information is being withheld rather than missing from her, because that names the document or the hardware, not her. "The allowance number is not printed on your quote" and "you cannot see the coil without pulling the panel" are facts about what she has been handed, and softening them helps nobody. Teaching pages get the same pass: define allowance, define tonnage, hand the knowledge over freely and in full. The tell is whether missing knowledge is being given away as a gift or sold as the reason to buy. Provider-side copy has its own structural version, so "you show up not knowing what is behind the door" is fair, because the gap is in what got passed along, not in the tech. And when a homeowner says outright that this is her first time and she is lost, meet her there in plain words; the ban is on building the pitch on ignorance, not on ever explaining anything to anyone.


---

# Claims, numbers and safety


## 25. State every result, saving, or piece of bad news as something that may, can, or helps rather than something that will, and never say what a dealer, provider, or city does, only what to ask them.

**Corrected 12 times.**

**Why.** Your reader at 9pm has already been told something certain today by someone who wanted her money, and she is scanning your page to work out whether you are the same kind of person. Under the persuasion knowledge model, the moment a line reads as a sales promise she discounts the whole page, not just that line, while a hedge works as a credibility signal: someone willing to write "may" is not the person on the doorstep quoting a flat fix-it price. The other half is plain craft, not [[Psychology|psychology]]. A hedged sentence is still true tomorrow when the dealer does not level the shed, and an absolute one becomes the sentence she reads back to you, angry, with the page open. Overshooting bad news fails the same way: fear that is too absolute reads as a scare tactic and she leaves instead of buying.

**How to find more.** Three passes over the page, one sentence at a time.

PASS 1, THE ONE COUNTEREXAMPLE TEST. For every sentence that states a result, ask: can I picture one real homeowner, one real dealer, one real city where this comes out false? One is enough. If you can picture one, the sentence needs may, can, helps, often, or increases the chance. Run this on numbers too. A dollar figure, a percentage, or an hour saved is a result with a decimal point in it.

PASS 2, THE SUBJECT TEST. Underline who each sentence is about. If the subject is anyone PRN does not employ or pay (a dealer, a provider, a contractor, an inspector, a manufacturer, a utility, "most companies"), you are making a promise on behalf of someone who never made it, and who probably could not answer the question off hand. Rewrite until the subject is the homeowner, PRN, or a question she can ask. "Ask whether leveling is included" is always safe. "Leveling is included" almost never is, and adding "generally" does not rescue it, because the problem is who the sentence speaks for, not how strongly it speaks.

PASS 3, THE QUOTE-BACK TEST. Read the sentence out loud in the voice of a homeowner who did what you said and got the other outcome. "Your page said delivery includes leveling." "Your page said this would save me the trip fee." If it lands as a broken promise, it was one.

Run all three on warnings, not just benefits. A risk stated as certain fails the counterexample test exactly like a benefit does, and it talks her out of buying.

**Mechanical check.**

```
Split visible text into sentences, then two gates (flag for human read, not hard fail).

Gate 1, unhedged outcome:
ABSOLUTE = /\b(will|always|never|every|all|guarantee[ds]?|ensures?|eliminat(e|es)|prevents?|stops|includes?|saves?|means|gets you)\b/i
HEDGE = /\b(may|might|can|could|often|usually|generally|typically|likely|helps?|tends to|in most cases|increases? (the chance|your)|some|most)\b/i
Flag any sentence where ABSOLUTE matches and HEDGE does not.

Gate 2, speaking for someone else:
THIRD_PARTY = /\b(dealer|dealers|provider|providers|contractor|contractors|compan(y|ies)|installer|technician|inspector|city|county|municipality|HOA|manufacturer|utility)s?\b/i
Flag any sentence where THIRD_PARTY matches and the sentence is neither a question nor contains /\bask\b/i. A hedge does not clear this gate.

Same file style as the banned-word gate in _validate-door-page.js.
```

| | |
|---|---|
| **Good** | A complete packet helps the person you hire see what you see before they pull in the driveway. Less time diagnosing can mean less on your bill. Ask whether delivery includes leveling. Not every dealer does it, and the person answering the phone may not know. |
| **Bad** | Your Job Packet saves you the $150 diagnostic fee. Delivery includes placement and leveling. Skip this step and your shed gets rejected after you have already paid for it. |

**Where it does not apply.** Do not hedge your own promises or a checkable fact. "The walkthrough is free." "We never ask for your card." "You can close the tab." Those are things PRN controls, and softening them into "may be free" reads as a dodge and costs you the trust the hedges were buying everywhere else. Same for anything a reader can verify on the spot, like what a page shows or what a photo captures. And one hedge per sentence, never two. "May sometimes help to potentially lower" is weasel, not care.

<details><summary>Melissa's own words</summary>

> a complete profile, ....HELPS put you in that box -look through all of this and be careful not making claims we cant back up. dont go overboard but adding helps or may or increases your likelhood or increase the chance etc
>
> * too absolute and too harsh- we WANT them to buy not talk them out of it "and it is the one that stops sheds after they have already been bought." try soemthign like "and it can cause issues sometimes. "
>
> * you cant say this. remove:  Delivery generally includes placement and leveling. | ah no we have to think outside the box as the dealers wont actually know off hand probably and they do NOT make the calls .
>
> Job Packet benefits are stated as may / can, never guaranteed.

</details>


## 26. Publish a number only when you can say out loud who published it, for where, over what window, and out of how many, and only in wording the source itself would sign.

**Corrected 10 times.**

**Why.** A precise figure is the most believable thing on the page and the only thing on it that can be proven false, because specificity reads as evidence: your reader at 9pm is already hunting for the tell that she is about to be overcharged, so a number does more work than any adjective. That makes the downside asymmetric. Trust here accumulates slowly across a page and collapses in one line, so a figure she can check and catch does not just lose that sentence, it retroactively converts every honest thing above it into sales talk. There is also an internal version of the risk: an invented number gets copied across [[door pages]] until the team repeats it with real confidence, which is the illusory truth effect operating on the writers rather than the reader. And a plain non-psychological half worth stating: the FTC expects substantiation to exist before a claim runs, so an unsourced figure is legal exposure as well as a copy problem.

**How to find more.** Run four passes over the page.

PASS 1, CIRCLE. Mark every digit, then mark every word doing a digit's job: most, many, majority, average, typical, usually, often, up to, as much as, nearly, hundreds, half, since, top-rated, star, review, updated, fastest, #1. Quantity words are numbers wearing a coat and are fully in scope.

PASS 2, SAY THE FOUR. For each mark, answer out loud: who published it, for what geography, over what time window, out of how many. If you cannot answer all four from a document you could open right now, you do not have a number, you have a feeling. Two legal outcomes only: delete it, or replace it with the thing you actually do know. There is no third.

The [[Provenance|provenance]] ladder decides pass 2. Only two things publish: a document you have open with a publisher, date and denominator, or a page you visited and could link. Something you remember reading, something a model told you, and something a search engine's AI summary asserted are research notes, not evidence. The summary is never the source. If you did not open the thing it was pointing at, you do not have it.

PASS 3, THE PUBLISHER TEST, for figures that survive pass 2. Read your sentence and the source line side by side and ask whether the people who published that number would say "that is not what we said." Five ways a sentence quietly outruns a real number: a national figure written as local ("in your area"), a range written as a point ("costs $312" out of "$150 to $600"), an old figure written as current ("today", "right now"), a subset written as everyone ("homeowners" out of "homeowners who called a pro"), and a survey of opinion written as fact ("most people wait too long").

PASS 4, THE EMPTY-FIELD SWEEP. This is where fabrication actually enters, and it never looks like lying. Look at every value a template, schema or database field wanted rather than a writer chose: publish date, updated date, review count, star rating, years in business, "X homeowners near you", ratings markup. For each one ask who typed it and why. If the answer is "the form needed something there," the correct value is no field at all, not today's date.

**Mechanical check.**

```
Two gates. (1) Find the candidates: rg -nP '\b\d[\d,.]*\b|\b(most|many|majority|average|typical(ly)?|usually|often|up to|as much as|nearly|hundreds|thousands|half|top-rated|star|stars|reviews?|rated|since \d{4}|updated)\b' over customer-facing copy, allowlisting step numbers, times, phone numbers and street addresses. (2) Gate on a countable property: every surviving numeric or quantity token in body copy must sit in a block carrying a citation object with all four fields populated (publisher, geography, window, n), and the build fails if any field is empty. Hard-fail separately, with no allowlist, on any datePublished, dateModified, reviewCount, ratingValue or aggregateRating that is not traced to a real stored record, so no schema field can ever be auto-filled to satisfy a validator.
```

| | |
|---|---|
| **Good** | Capacitor replacement in Ohio ran $150 to $400 last year. That's [publisher]'s 2025 statewide cost survey, so your quote can land outside it and still be fair.  And where we don't have a number: we're not going to guess what this costs on your street tonight. Your packet will name the part. A named part is harder to overcharge. |
| **Bad** | Most homeowners in your area pay around $312 for this repair. Over 400 five-star reviews. Updated today. |

**Where it does not apply.** Two honest exceptions. First, the reader's own numbers. Anything she told you or the tool recorded is not a claim about the world and needs no outside source: "your thermostat reads 84", "you said it started Tuesday", and arithmetic on her own inputs are reported, not researched. Sourcing those would read like a legal filing and would break the warmth. Second, clearly marked hypotheticals. "Say your quote comes back at $431" is an illustration, and picking that figure for how it lands is a different rule doing its job. The requirement is only that the frame is unmistakable ("say", "suppose", "if"), never a bare figure a skimmer could read as a market rate. Also worth knowing: the citation goes next to the number in the same breath. A paragraph of caveats hung off one figure sounds defensive and costs more trust than it buys.

<details><summary>Melissa's own words</summary>

> **Never invent a number.** No fabricated counts, local figures, review dates or sample sizes. Cost figures are typical published ranges for the region, labelled as such.
>
> we never invent publication dates just because a database field wants one.
>
> -3 can you cite the prices?
>
> [[Decision frame|the decision frame]] has no dollar figures — [[Canon forbids invented prices|canon forbids invented prices]]

</details>


## 27. Ask only for what she can catch in one photo, notice from where she is already standing, or answer off the top of her head; never for something needing a tool, an opened panel, or a judgement she cannot be sure she got right.

Corrected 5 times.

**Why.** At 9pm in a hot house, every question in the walkthrough is secretly a question about her: am I the kind of person who can do this? Asking her to open a panel, or to decide whether a capacitor looks swollen, answers it for her, and the answer is no. That is self-efficacy collapsing at the exact moment she is deciding whether to trust us with money, and it is nearly always curse of knowledge on our side, since the writer knows what a copper line is and forgets that to her it reads as a competence test she just failed. There is a second, non-psychological cost worth naming plainly: an unanswerable field does not get skipped, it gets guessed, and a guess in the Job Packet is worse than a blank because a provider will act on it.

**How to find more.** Run the doorway pass. Put the reader in her hallway holding a phone, then take every question, field label, placeholder and checklist item on the page one at a time and run four checks in order. (1) VERB. Circle the verb. Look, listen, smell, point and snap, and "tell me" all pass. Open, remove, unscrew, pull, lift, reset, test, measure, feel, reach, climb and crawl all fail. (2) NOUN. Circle the thing being asked about. If she would have to search the name to find the object, it fails. Part names are the giveaway: copper line, coil, capacitor, float switch, drain pan. (3) JUDGEMENT. Could she answer confidently and still be wrong without knowing it? "Is it clogged?" fails. Any ask with a correct answer she cannot verify herself fails. (4) ALREADY KNOWN. Could she answer from the couch without getting up? How old the house is, when it was last serviced, whether it has done this before. Those pass automatically, so ask freely and ask more of them. Anything failing 1, 2 or 3 gets exactly one of three fixes: cut it, convert it to a picture or video request so the reading is our job and not hers, or demote it to optional with a stated out. Never leave a failing ask as a required field. If you only get one pass over the page, use the fast version: read each ask aloud and listen for her saying "I wouldn't know how to do that" or "how would I know?" If either one fits, rewrite it.

**Mechanical check.**

```
Regex over every question, label, placeholder and helper string, case-insensitive: \b(open|unscrew|remove|detach|disconnect|unplug|access|pry|pull off|take off|lift|test|measure|meter|reset|flip|toggle|hold down|feel|touch|climb|crawl|reach)\b|\b(copper|line ?set|suction line|coil|condenser|evaporator|capacitor|contactor|compressor|refrigerant|freon|psi|voltage|amps?|breaker panel|service panel|drain pan|float switch|flue|heat exchanger|anode|expansion tank|p-?trap|shut-?off valve|attic|crawl ?space|roof)\b — every hit is reviewed by hand, not auto-cut. Countable gate alongside it: each required intake field must be free text, a photo or video upload, or a choice list containing an "I'm not sure" or "can't tell" option. Count required fields with no such escape. Target is zero.
```

| | |
|---|---|
| **Good** | That big metal box outside your house. If the fan on top is spinning, that is useful to know. If it is sitting still, that is useful too. A picture works if it beats typing. |
| **Bad** | Open your breaker panel and check whether the AC breaker has tripped. While you are in there, tell us if the capacitor looks swollen. |

**Where it does not apply.** The ceiling is set by the reader, not by a fixed list, so it moves when she moves it. If she has already typed "I swapped the capacitor and it still won't start," continuing to ask her only for pictures is condescending, and it trips the other rule about never implying the reader is incapable. Once she shows her hand, meet her there and ask the real question. Second carve-out: this governs asks, not tells. "If you smell gas, leave the house and call the gas company from outside" is an instruction, not an information request, and it should stay blunt and urgent. Do not soften a safety line to make it feel easier.

<details><summary>Melissa's own words</summary>

> remove: Ice on the copper line? Tell us now. It changes what you should do in the next five minutes. in rules explain we dont put things that owuld be daunting to check only the pictures or easily observable thigns and you can use tongu in cheek humor on these too
>
> the intake is suppose to have photo upload and video upload fields with prompt to snap pictures of the problem, model numbers and names, etc (ie try to get as much info suggested up front as possible ot decrease follow up but make it not seem overwhelming or required up fornt for the perosn who just wants to voice text issue in.
>
> obvious things to check safely
>
> snap a picture of it or tell me if it looks clogged or dirty

</details>


## 28. Aim every negative at the situation or a named competitor, never at a dealer, provider or partner, and never hand the reader a cheaper alternative or a price for work we do not sell; a partner's miss is written as our regret and the business they could have had.

Corrected 4 times.

**Why.** Two mechanisms stack on the homeowner side. Naming a cheaper option or a part cost sets an anchor, so once she has read "only $40" or "probably cheaper," every real quote gets measured against a number we invented, a fair price starts to feel like a ripoff, and at 9pm in a hot house that turns into stalling instead of booking. Trust in a middleman is also transitive: she is deciding whether to trust a stranger, and a page that runs down the people it sends her to is evidence that this whole world is untrustworthy, us included, while negativity bias makes that one suspicious clause outlive the whole page. On the partner side, telling a dealer he failed triggers defensiveness and he argues with the message instead of acting on it; the same fact framed as our regret plus the sale he could have had leaves his face intact and points loss aversion at the upside rather than at us.

**How to find more.** Run three passes over the page. (1) VILLAIN PASS: every hook has an implied villain, so underline it in each sentence that has one. If the villain is a person or company who could plausibly be a PRN partner someday (a dealer, a tech, a local shop, "them", "most places", "the industry"), re-aim it at the situation instead: the heat, the hour, the guessing, the not knowing, the second trip. Situations are safe villains. People who fund us are not. (2) SUSPICION PASS: after each sentence ask, does the homeowner now carry a doubt, a number, or an alternative she did not walk in with? If yes, we did not inform her, we armed her, and she will spend it on the person we sent. Cut it, or convert it into something we do for her. (3) OVER-THE-SHOULDER PASS: reread the page as the dealer whose money funds it, reading over her shoulder. Anything that would make him want to explain himself gets rewritten. In partner-facing copy, check the subject and verb: if the subject is "you" and the verb is a failure or an absence, flip the subject to "we" and the verb to a wish, then give him the upside still available. New instances almost always arrive disguised as a reader benefit, in the shapes "so you don't get...", "without the...", "instead of...". Any benefit phrased as escaping something is a trigger to go find out who the something is.

**Mechanical check.**

```
Case-insensitive flag-for-review regex: \b(cheaper|cheapest|overcharg|gouge|rip[- ]?off|ripped off|mark(ed)? ?up|upsell|runaround|run.?around|twenty questions|20 questions|haggl|pushy|shady|sketchy|middleman|hassle|instead of|without the|so you don'?t)\b — plus \b(only|just) ?\$ and any $ figure that is not a price PRN itself charges. In partner-facing copy also flag \byou (weren'?t|aren'?t|didn'?t|don'?t|missed|failed|lost)\b. Countable gate: outside copy about a named competitor, the number of sentences whose object is a provider noun (dealer|contractor|tech|installer|shop|provider|company|them) carrying a negative verb or adjective must be zero.
```

| | |
|---|---|
| **Good** | Homeowner: "Tell us what your AC is doing. We turn it into one page your tech can read in ten seconds, so the visit goes to the fix instead of the guessing." Dealer: "We wish this one had been yours. She picked her siding color on a Tuesday night and the order went in Wednesday." |
| **Bad** | Homeowner: "Get a real price up front instead of twenty questions from a tech who can probably do it cheaper. That part is only $40." Dealer: "You weren't on the list we showed them, so they went with someone else." |

**Where it does not apply.** The rule governs copy that persuades, not the product's record of facts. A Job Packet, a timeline, or a dispute record stays accurate even when it makes a provider look bad, because sanding that down destroys the exact thing PRN sells. Standard how-a-good-job-works norms are also fine ("get it in writing before work starts"), as long as they describe the norm and never warn her about the person coming to her house, and never carry a number that prices his work.

<details><summary>Melissa's own words</summary>

> so the first reply is a real price instead of twenty questions. → change to something more hook marketing please (again not a negative for dealers as they fund the platform- and we DONT say negatives unless competition) so they can help you find your perfect colors and style or something
>
> You weren't on the list we showed them--> change to We wish we could have had you be the local delaer they sent their info to or the inventory they chose...
>
> remove: who can probably do it cheaper.
>
> remove: , it is only $40.

</details>


## 29. Give each stat card a different one of the reader's three questions (how likely it is simple, how urgent it is, what it could cost) and cut any number that would not change what she does tonight.

Corrected 3 times.

**Why.** At 9pm in a hot house your reader is holding three unknowns and nothing else: can I fix this myself, do I have to do something right now, and how badly is this going to hurt. A number only has value of information if a different number would have changed her next move, so "88% of homes have AC" spends one of three scarce slots and buys her nothing. Three cards on one topic feel like coverage while two of her questions stay open, and it is unresolved ambiguity, not missing detail, that keeps her sitting there refreshing instead of starting the walkthrough. Filler trivia also costs trust at the worst possible moment: padding is what content mills publish, and she is deciding right then whether this page is worth handing a stranger money over.

**How to find more.** Run four passes over the stat block. Any card that fails one comes out, no matter how well sourced it is.

1. THE SWAP TEST. Replace the number with a plausible opposite. "1 in 2" becomes "1 in 50". "$200 to $1,500" becomes "$40 to $60". "0 minutes" becomes "a few hours". Now read the page again and ask what the reader does differently tonight. If her next move is identical either way, the number carries no information and the card is decoration.

2. THE LABEL TEST. Write out the question each card answers in the reader's own words, not its topic. Only three labels are legal: "Is this probably something I can fix myself?", "Do I have to act right this minute?", "What is this going to cost me?" Two cards with the same label means one goes, even when the numbers come from different sources and look different on screen. A label with no card means the set is incomplete and she leaves with that question open.

3. THE TRANSPLANT TEST. Could this exact card sit unchanged on a page about a completely different symptom? If it could, it is a fact about the category, not about the problem she searched for. "Check your filter monthly" fits every [[HVAC]] page, which is why it belongs on none of them.

4. THE WRONG-HOUSE TEST. Read the card as the least typical person who will land here: another state, a smaller unit, older equipment, a different fuel. If the number could be false or unknowable for her, it does not belong on a page everyone lands on. A stat may be tied to the space, the size, or the equipment type. It may not be tied to a place, unless the page is itself about that place and the card says so.

**Mechanical check.**

```
Gate the stat section in the page validator: (1) exactly three cards, `(html.match(/class="stat"/g)||[]).length === 3`; (2) each card carries `data-question="simple|urgent|cost"` and the three values are distinct, `new Set(cards.map(c=>(c.match(/data-question="(\w+)"/)||[])[1])).size === 3`; (3) every card has a numeral and a source, `/<b>[^<]*\d/` and `/href="#src-\d/`; (4) no card text matches the misplaced-place regex `/\b(Ohio|Michigan|Illinois|Indiana|Alabama|Texas|Florida|Arizona|Midwest|Northeast|Southeast|Southwest|nationwide|national average|in your (state|area|region)|[A-Z][a-z]+ (County|Metro))\b/`. Fails on 1, 2 or 4 block publish. Soft flag for human review, almost always inert trivia: `/\d+\s*%\s+of\s+(US |U\.S\. |American |all )?(homes|households|homeowners|Americans)/i`.
```

| | |
|---|---|
| **Good** | ≈ 1 in 2 warm-air calls trace back to something you can check yourself before anyone comes out.  0 minutes of extra cooling once you see ice on the line. Switch cooling off, leave the fan running.  $200 to $1,500 is the published repair range, depending on which cause it turns out to be. |
| **Bad** | $200 to $1,500 is the typical AC repair.  A compressor replacement runs $1,300 to $2,500.  88% of US homes have air conditioning.  (Two prices saying the same thing, and one true fact that changes nothing. She still does not know whether this is simple, or whether she should shut something off tonight.) |

**Where it does not apply.** Local numbers are not banned, misplaced ones are. On a page every region lands on, a state or metro figure is wrong for most readers and checkable by none. On a page that is itself about that metro, or on a Repair Record card that carries its own scope chip and sample size, the local number is the point and a national average is the weaker card. Second exception: when one question swallows the whole decision, do not manufacture a third card to fill the grid. On a gas smell or carbon monoxide page the answer is get out and call, and a price range next to that reads as ghoulish and softens the one instruction that matters. Two cards, or none, beats three that dilute it.

<details><summary>Melissa's own words</summary>

> That is why these three are much better than stats such as:
> > 88% of homes have AC
> or:
> > check your filter monthly.
> Those things may be true, but they don't help the person make a **decision about the problem they searched for**.
>
> remove these stat cards as region specific. stat cards should be things that apply to the space only that we can say for all regions or any shed of that size or equimpent type things.
>
> Do not publish three cards that all answer the same question.

</details>


---

# Structure and layout


## 30. Draw the meaning instead of typing it: every claim that an icon box, diagram, coloured band or single number could carry gets drawn, and the prose left over has to be short enough to read standing up.

**Corrected 9 times.**

**Why.** Her reader is depleted before he arrives: hot house, 9pm, money on the line. Long prose adds extraneous cognitive load exactly when he has none left, so he skims, misses the promise, and leaves. A picture plus four words beats a sentence twice over here — the picture superiority effect makes it stick, and the ease of reading it (processing fluency) gets misread as the claim being true and the company being competent. A page that has clearly been designed also signals a company that has done this a thousand times, which is the actual question he is asking: can I trust these people with my money.

**How to find more.** Run the two-pass squint on any page or result screen. PASS ONE, the cover test: put your hand over every sentence of body text and read only what survives — headings, icons, boxes, numbers, pictures, colour bands. Write down what the page still promises you. Any promise you are paid for that vanished under your hand has been typed, not designed; it must become a box, an icon row, a diagram or a number. PASS TWO, the hidden-list test: read each remaining paragraph and ask "is this three or more parallel things?" — three steps, three benefits, three comparisons, anything strung together with "and ... and ... which means". Parallel structure inside prose is always a diagram in hiding; break it into boxes. Then the scroll test: scroll one phone screen at a time and count screens that contain no picture, icon, diagram or coloured box. Any screen that is words only is a failing screen, whether or not the words are good.

**Mechanical check.**

```
Two gates a script can run on the HTML. (1) No long paragraphs: `grep -oE '<(p|li)[^>]*>[^<]{220,}'` must return zero hits (220 chars is roughly 35 words). (2) Visual density: count visual elements (`<svg`, `<img`, `<figure`, and elements whose class matches `icon|card|box|band|stat`) against total body word count; require at least one visual per 120 words, and no run of more than 120 consecutive words of body copy with no visual between them.
```

| | |
|---|---|
| **Good** | **Your Job Packet, in four parts**  [clipboard] What you saw, in your words [camera] Photos of your AC, with the date on them [stopwatch] Less time diagnosing. You pay for fewer hours. [open hand] Hand it to any provider you want  (four boxes, lots of air around them, the stopwatch box in brand colour) |
| **Bad** | Your Job Packet is a comprehensive document that captures the details of what you observed, including photographs, timestamps and your answers to our guided questions, which can help reduce the amount of diagnostic time a provider needs to spend at your home and may therefore lower your total repair cost, and which you are free to share with any provider you choose. |

**Where it does not apply.** The answer layer stays in sentences. Safety lines, price disclosures and legal text lose meaning as icons — "If you smell gas, leave the house and call from outside" must be a sentence, not a pictogram, and the Job Packet's actual content is words a provider has to read exactly. Door pages also need real indexable text near the top: search engines and AI answer engines read words, not pictures, so an all-graphics page ranks for nothing. And decoration is not design — an icon that carries no meaning adds load instead of removing it, so if you cannot draw the idea, write one clean sentence instead of parking a shrug icon beside it.

<details><summary>Melissa's own words</summary>

> MAKE it MORE FLYER llike MORE PICTURES/GRAPHIC PLEASE | * what are other ways we oculd have the output be designed? not as text heavy like a flyer look?? lots of graphics and icons
>
> MUCH more PICTURES, GRAPHICS , ARCHITECULAR drawings, icons etc to paint the vision, MUCH less text heavy
>
> use color and use icons with BOXES to show in pictures!! Job packet (reduce diagnositc time- which could save you money on the repair hours...)
>
> I want design, use hooks to sell it not words, more whitespace

</details>


## 31. Make items in a set the same length and weight, line up the edges of anything sitting side by side, and always leave more space between blocks than inside them.

Corrected 4 times.

**Why.** The reader is scanning shapes before she reads a single word, and Gestalt grouping does the sorting for her: things that look alike read as equals, things that sit close read as one thing. So four trust items of wildly different lengths stop being four reasons and become one important reason plus three afterthoughts, and a box shoved against the cards above gets swallowed into them instead of landing as its own point. On top of that, processing fluency means layout that takes extra effort to parse feels less true and less safe, and the reader blames the company, not the design. A ragged edge or a box with all its air at the top reads as "nobody checked this," which is exactly the guess a homeowner at 9pm is making about whether anyone checks the invoice.

**How to find more.** Run three passes on the page before reading it for meaning. PASS 1, the set test: find every place the page makes a set (cards in a row, bullets under one heading, numbered steps, icon-and-label items) and count the words in each item. If the longest is more than about one and a half times the shortest, or if one item wraps to two lines while its siblings hold one, the set is broken. The question to ask is not "is this well written" but "would a stranger guess these are equals, or would she guess one of them is the real one?" Whichever item is longest is the one she will treat as the point, whether you meant that or not. PASS 2, the edge test: for anything side by side, ask whether the bottoms land on the same line and the tops start on the same line. Then look inside each box and ask whether the air above the text equals the air below it. If a box is next to cards, its bottom edge belongs on their bottom edge. PASS 3, the blur test: shrink the page to 25 percent, or squint, or scroll past it fast on a phone. Now count the sections without reading. If you cannot say where one ends and the next begins, or if two neighbors merge into one grey slab, they need different treatment or more air between them, not more words. The clean version of that: for every block, compare the gap above it to the biggest gap inside it. The outside gap must win. When it does not, the block reads as part of whatever is above it.

**Mechanical check.**

```
Copy gate, per parallel set: count words per sibling item; fail if max ÷ min > 1.5, or if any item's character count is more than 25% off the set's median. Layout gate, in a browser (Playwright): for siblings in a row, compare `el.getBoundingClientRect().bottom` and `.top` and fail on any difference over 4px. Box gate: computed `padding-top` must equal `padding-bottom`. Spacing gate: a section's outer `margin-top` must be greater than the largest gap between elements inside it; also flag any `margin-top: 0` or `margin-top` under 32px on a section that directly follows a card grid.
```

| | |
|---|---|
| **Good** | See every price before you agree. Read what other homeowners paid. Same answer at 9pm as at noon. Providers with complaints come off the list. (Four items, one line each, five to seven words. The packet example box ends on the same line as the cards beside it, with equal air top and bottom.) |
| **Bad** | See every price before you agree. Reviews. We maintain a rigorous, continuously updated vetting process, and any provider who accumulates verified complaints from homeowners in your area is flagged for internal review or removed from the network entirely. Trust. (One item carries the whole section, two are stubs, and the packet box below is smashed against the cards with all its white space at the top.) |

**Where it does not apply.** Never pad an item to hit the length. If a point cannot be said in the set's shortest form without adding words that do no job, shorten the other items or cut that one, because filler added for symmetry is worse than a ragged set. And the rule is "peers look like peers," not "everything looks the same." When one card genuinely is the main move, the recommended path, the primary button, the one step where the money is at risk, it should be visibly heavier. Make that difference big and obviously deliberate, a badge or its own row or real size, not a 30 percent length drift that just reads as sloppy.

<details><summary>Melissa's own words</summary>

> Trust follows add" Those with issues are flagged or removed" or something to the end. To make wording size similar to other 3
>
> What you walk away with section is very uneven bits of text
>
> job packet example section the example is visually off and needs moved down so the bottom of that box is the same as the bottom of the cards quotes you compare and free. This section needs help visually. it all blurs together. Icons larger?
>
> spacing issues on page 5 on the page and in the code is smashed against the cards above and the text in the problem and what we do and result is not centered more white space in top of box then bottom

</details>


## 32. End the section at the table's bottom border: nothing underneath it, and any caveat, footnote or summary goes into a column, a cell, or the single line above.

Corrected 3 times.

**Why.** A table is a closed shape, and a reader who is scanning rather than reading leaves at the bottom border, so text placed under it lands in the one spot they have already quit. It also takes the recency slot, the last thing the section leaves them holding, so the serial position effect turns whatever sits there into the takeaway. The same words change meaning with position: inside a cell or a column header a limit reads as precision, and underneath the table it reads as the writer walking back what they just showed. At 9pm in a hot house, deciding whether to trust a stranger with money, nerve is exactly what the reader is measuring, and a hedge in the last slot is the one thing they will remember.

**How to find more.** Run the bottom-border sweep, then the pincer. SWEEP: find every closed visual block on the page, not just tables. Comparison grids, price boxes, checklists, numbered step lists, bordered cards. For each one, look at the gap between its bottom edge and the next heading, block or button. Every sentence in that gap is a suspect, including one-liners, italics, small print, asterisk notes and anything starting with Note, Of course, Keep in mind, Both, or Remember. PINCER, run on each suspect: "If the reader closed the page without ever seeing this line, would they make a worse decision?" If no, it is decoration, cut it. If yes, it is too important to sit where nobody reads, so it has to move up. Then a three-way sort decides where: (1) it repeats something already in a cell, cut it; (2) it qualifies, limits or hedges what the table claims, move it into a column header or the cell it applies to, so the limit is data instead of an apology; (3) it introduces new information the reader will act on, it was never a footnote, give it its own heading or put it in the line above the table. Keep sweeping until the gap under every block holds nothing but a heading, another block, or the reader's next step. Second pass, because she cuts these too: read the line directly above the table and ask whether the table would still make sense without it. If yes, that line is also wasted.

**Mechanical check.**

```
HTML flag: /<\/table>\s*(?:<\/(?:div|figure|section)>\s*)*<(?:p|ul|ol|small|em|i|blockquote|span)\b/i  — Markdown flag: after the last line matching /^\s*\|/, the next non-blank line must match /^(#{1,6}\s|\||<table|<h[1-6]|!?\[[^\]]*\]\([^)]*\)\s*$)/ ; anything else fails. Countable gate for CI: zero text characters between a table's close and the next heading, next block, or next call to action link.
```

| | |
|---|---|
| **Good** | Here is what warm air usually means, and what only a meter can settle.  \| What you see \| Usually means \| Meter needed \| \| Warm air, outside fan spinning \| Low refrigerant \| Yes \| \| Warm air, outside unit silent \| Power or contactor \| No \|  ## What to hand your tech |
| **Bad** | \| What you see \| Usually means \| \| Warm air, outside fan spinning \| Low refrigerant \| \| Warm air, outside unit silent \| Power or contactor \|  And what no honest tool can settle without a meter. Both matter. Your tech will confirm the reading on site. |

**Where it does not apply.** The slot under a table is not banned, it is reserved. One thing may take it: the reader's next move, as a button or link. That is the strongest place on the page for it, because the reader is already at the bottom with the answer in hand. A dated source stamp under a price table is the other allowance, for example "Prices checked March 2026", because it is data about the table, not an explanation of it, and it buys trust rather than spending it. The guard against both becoming a loophole: if the line has a verb and explains, softens or summarizes the table, it is prose and it goes. If it is a next step or a stamp, it stays and it stays to one line.

<details><summary>Melissa's own words</summary>

> REMOVE: And what no honest tool can settle without a meter. Both matter.dont put things under these tables
>
> Dont put things under these tables
>
> Remove the paragraph above and below table. Wasted words this is not benefit to him VERY low low on benefits not needed

</details>


## 33. Let each page's real content set its own counts, stats, images and section order, so no two pages in a batch share a skeleton and only the trust furniture repeats.

Corrected 3 times.

**Why.** Effort is the trust proxy she can actually see. A homeowner at 9pm cannot judge whether your diagnosis is right, so she judges the page in front of her, and a page that visibly cost nothing to build suggests a company whose promises cost nothing either. Repeated counts are the tell: "six things to check" on every page says the box wanted six, not that six things are true, so one glance at a sibling page turns your specifics into filler. The second cost is plain memory interference. Pages built on one skeleton blur together, so with three tabs open she cannot tell which one she already read, and untangling them is effort she spends instead of spending it on trusting you.

**How to find more.** The test question, run on every number, image and section: did this come from this subject, or from the template's slot? Anything that would be identical on the sibling page came from the slot.

To run it, never review one of these pages alone. Pull two siblings from the same batch and lay three side by side.

1. Blackout test. Cover every proper noun and every symptom word. If you cannot tell the three pages apart in five seconds, they are one page with the nouns swapped.
2. Number ledger. Write down every number each page shows about itself: items in each list, cards, steps, FAQs, stats, percentages, dollar figures, minutes, ratings. Line the three ledgers up. Any number sitting in the same slot on all three is a template default, not a fact. Then test each one: "if I found one more true item, would it go on the page?" If the answer is no because the row holds six, the six was a quota.
3. Shape ledger. Write only the shapes and ignore the words: section order, block types, image count, card grid. The same string three times means the same page.
4. World check. Icons, photo treatment, color, card shape, the hero. Two product lines should not be able to trade images without anyone noticing.

The fix is not a random number generator. Variation has to come from the subject, so vary because your AC page genuinely has four things worth checking and your roof page has nine. Shuffling counts to look varied pads some lists and truncates others, and she can smell both.

**Mechanical check.**

```
Gate on a batch, not a page. In any batch of 10, no list-length value and no stat value may appear on more than 3 pages, and no two pages may share a structure fingerprint.

# 1. list lengths across the batch (fail if one value covers more than a third)
grep -c '<li' pages/*.html | cut -d: -f2 | sort | uniq -c | sort -rn

# 2. repeated stats, the "23% on every page" case
grep -hoE '\$?[0-9][0-9.,]*\s*(%|percent|minutes|hours|days|out of [0-9]+)' pages/*.html | sort | uniq -c | sort -rn

# 3. structure fingerprint, tags only, no words
for f in pages/*.html; do printf '%s %s\n' "$(grep -oE '<(h2|h3|section|img|li|div class="card")' "$f" | tr '\n' ' ' | md5sum | cut -c1-8)" "$f"; done | sort
# any two pages sharing the first column fail
```

| | |
|---|---|
| **Good** | AC page: Four things you can check from the hallway. Four cards, because four is what there is. One photo of a frozen line.  Water heater page: Seven things, a rusted drip pan, and a drain diagram the AC page never needed.  Both pages: the same blue Job Packet button in the same spot. That is the only thing they share. |
| **Bad** | AC page: 6 things to check before you call anyone. Six cards, three stats, "homeowners cut the first quote by 23%."  Water heater page: 6 things to check before you call anyone. Six cards, three stats, "homeowners cut the first quote by 23%."  Same icons, same order. Only the noun moved. |

**Where it does not apply.** Trust furniture is the exception and it must not vary at all. The Job Packet button, the price talk, the safety warning, the line about what you do with her information, the phone number: same words, same place, every page. A homeowner who learned where the safety line lives should find it there again, and a warning reworded for the sake of variety reads as sloppy or as a different promise. Second rider: do not fake variety. If two pages honestly have six real steps each, leave them both at six and vary something that is actually different.

<details><summary>Melissa's own words</summary>

> Add in variability please so the NUMBERs chosen of things aren't all the same. right now outputting 8 and 6 over and over and that is less vlauable and looks formulaic.
>
> These are good starts but they look too similar. The customer flipping form one to the other is going to be in mental overload to tell the difference anyway.
>
> the cards stats are to change with each page - these didnt

</details>


## 34. Put legal, privacy and disclaimer text last, small and italic and muted, pulled from one shared block: never in the hero, never in brand color or bold, never in a warning box, and never as a list of what we are not claiming.

Corrected 3 times.

**Why.** Bold, brand color and boxes are the page's "look here" signal, and a homeowner scanning at 9pm spends her attention on whatever is loudest first. Point that signal at legal text and the first thing she learns is that we are braced for a complaint, which is a strange opening from someone she was about to trust with her house and her money. Negation makes it worse: to understand "we are not diagnosing your AC" she has to picture us diagnosing her AC and then tag that picture false, and the tag fades faster than the picture, so a "what we're not claiming" block plants doubts she did not arrive with. Small, italic and last is the form legal text takes on every honest site she has ever used, and that familiarity is processed fast and read as routine, so it costs her nothing to skip and costs us nothing in trust.

**How to find more.** Run four passes over the page. (1) Audience pass: for every sentence ask who it protects. If the answer is us, our lawyer, or a future complaint, it is legal text no matter how warmly it is written. All of it belongs in one block after the last thing the reader came for, so on a results screen the disclaimer sits under the answer, never above or beside it. Flag anything that appears earlier. (2) Squint pass: blur your eyes and list the first six things that pull the eye, brand color, bold, a box, a left border, an icon, a colored band, all caps. Any item on that list that is legal text is misplaced emphasis. Restyle it quiet or move it down. (3) Negation pass: find every sentence saying what we are not, cannot, or do not do. Read it cold and ask whether the reader had that worry ten seconds earlier. If not, the sentence created the worry, so cut it, or if it is legally required, demote it into the foot block in the same flat voice as the rest. (4) Duplication pass: every promise about her data, her privacy, or what happens to her information should exist in exactly one wording across the whole site. Open a second page and look for the identical sentence. If the wording differs, this page invented its own and it must come from the shared component instead.

**Mechanical check.**

```
Hard fail: grep -ci "not claiming" must return 0. Placement gate: every line matching grep -nEi "not a (diagnosis|guarantee|warranty|substitute)|no guarantee|we (do not|don't|cannot|can't|never) |disclaimer|privacy notice|terms of (use|service)" must fall in the last 10 percent of the body's line count. Emphasis gate: none of those matched lines may also match "#C1004F|#FF2E7E|#FF6FA6|font-weight:\s*[6-9]00|<strong|<b>|text-transform:\s*uppercase|class=\"[^\"]*(warn|alert|callout|notice-box|banner|band|card)|border-left|[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]", with one exception allowed for a single <strong> lead-in label. Style gate: the block itself must match font-style:\s*italic and a font-size at or under .8rem in the muted text color, not the brand pink. Count gate: at most one full legal block per page, plus at most one short reassurance line within the form.
```

| | |
|---|---|
| **Good** | Foot of the results, small grey italic: "Informational only. Not a diagnosis, and not a substitute for a licensed tech when your AC needs one. Prices move by home and by state. Terms and Privacy." One plain line under the form button: "Your answers stay with you until you choose to send them." |
| **Bad** | A pink boxed panel above the walkthrough, warning triangle and all: "WHAT WE'RE NOT CLAIMING. We are not diagnosing your AC. We can't guarantee any price on this page. We will not send your information to a provider without asking." |

**Where it does not apply.** Safety is not legal. A real hazard warning is loud, early, and sits exactly where the reader is about to act: "If you smell gas, leave the house and call 911," or a stop line inside the step that asks her to open a panel. Do not bury those in the footer to satisfy this rule. The second exception is the moment of handover. Where she types her address, adds a photo, or hits send, one short plain sentence answering the question she is having right then belongs next to the button, because a footer answer arrives too late. Keep it to one sentence, no box, no brand color, and keep the versioned agreement itself in the shared component.

<details><summary>Melissa's own words</summary>

> * put the legal disclaimer at the end of the results | do not green bold the "We keep a record of the local rules we look up" make that disclaimer italic
>
> change the what were not claiming to the legal disclaimer what you have here isnt relevent as we wont be sending anyting to a provider until we have that system set up and running in which this page goes away this is just in between
>
> Do not have A05 write a fresh privacy disclaimer onto every generated page. There can be a tiny reassuring line around the form, but the actual versioned agreement belongs to [[the shared intake]] component.

</details>


## 35. Put the answers in visible text so a crawler never has to touch the tool: intent keywords in the title and headings, question-shaped H2s answered in the very next sentence, a visible list of 5 to 10 questions the tool can settle with an honest limit on each, and no paragraph that carries no fact.

Corrected 3 times.

**Why.** A door page has two readers and one text. The homeowner can use the walkthrough, but the answer engine that decides whether to recommend it never can, because the tool sits behind a form, so every question the tool can settle exists for that reader only as literal visible words on the page. That half is plain craft, not psychology. For the homeowner at 9pm the same list does different work: she is already carrying one unknown, a stranger with a price, and ambiguity aversion makes her refuse to stack a second unknown on top, so naming what she gets back collapses the guess before she spends any attention. The rows that admit a limit are what make the rest believable, because hedging functions as a credibility signal, and a page claiming it can answer everything gets discounted as marketing in a single glance.

**How to find more.** THE [[the flipper|LOCKED]]-DOOR READ. Cover the form and the tool. Only what stays visible counts, because that is all the answer engine ever sees. Then three passes. (1) Retrieval pass: write down the five things your homeowner would actually type at 9pm, and for each one find the single sentence on the page you would quote back as the answer. No sentence means the page is thin there, and that is a missing content block, not a wording problem. (2) Substitution pass: take each sentence you just found and swap in a competitor's name. If it is still true, it is generic and earns nothing, so it needs a number, a named part, a count with its denominator, or a specific next step. (3) Limit pass: for every capability the page claims, find the sentence beside it saying where that capability stops. A claim with no stated limit reads as a sales claim to both readers. Then run the bloat gate per paragraph: does this paragraph carry one thing your reader could act on or repeat to a provider, meaning a number, a part name, a next step, or a boundary? If not, it is length rather than content, so cut it. Dense means facts per line, never words per page.

**Mechanical check.**

```
node _validate-intent-page.js <page.html> already gates the module: #what-this-tool-can-answer present, 5 to 10 rows, 3+ boundary labels drawn from the enum, and at least one STILL NEEDS TESTING. Three checks worth adding. (1) Every question cell ends in "?" and contains my/your/I; on AC Problem Page LIVE v6 that is 9/9 and 9/9. (2) Every <h2> whose text ends in "?" is followed by a <p> within 300 characters, which enforces answer-first. (3) The intent keyword appears in <title>, in the single <h1>, and in 2+ <h2>, while staying under 2.5% of body words; both halves must pass, since the ceiling is the anti-stuffing gate. Bloat gate: flag any page section over 400 words that has no table, list, or labelled figure.
```

| | |
|---|---|
| **Good** | Is my capacitor definitely bad? Your photos change how likely it is. Confirming it takes a meter on the terminals, so that one still needs testing. |
| **Bad** | Not sure what's wrong with your AC? Our powerful walkthrough asks the right questions and gets you answers fast. Whether it's AC repair, AC service or AC troubleshooting, we've got you covered. |

**Where it does not apply.** Gated surfaces. Past the intake, on the Job Packet, the dashboard, confirmation screens and email, there is no crawler and the reader has already committed. A "questions we can answer" list there is friction that restates what she is already doing, and the keyword discipline is pointless on a page nobody searches for. Second, never pad to hit the count. The variability rule holds: a dead outlet has four plausible causes, so do not stretch it to eight. Vary the row count to what the problem actually warrants, and drop the module entirely from any page with no tool behind it.

<details><summary>Melissa's own words</summary>

> because these are seo pages too i need you to add more actual CONTENT so a few blocks on what to check, common issues, etc for DENSE information
>
> the title of the page needs to have the seo type intent (permits, setbaacks, hoa etc ) and those sprinkled thorughout the why this is different and the page. | we need a section that says what questions the tool can SPECIFICALLY answer for the cusotmer so the ai knows
>
> ok on below but my concern that is GREAT but my concern then is HOW are those questions accessed by the ai- HOW does it know these can be answered with this tool?? it cant use the tool for them up front. So we need immense strategy on HOW to incorporate these and LOADS and lists of questions the tool can answer so it knows?

</details>


---

# Numerals and formatting


## 36. Write every number as a numeral in body copy, headings, stat cards and time claims alike, and spell one out only when a numeral would sit directly above or beside another numeral in a title.

**Corrected 8 times.**

**Why.** A digit is read as a quantity almost immediately; a spelled number has to be decoded from word into amount first. That extra step costs nothing when you are calm and costs real attention at 9pm in a hot house, when working memory is already full of money worry and a stranger who has not called back (cognitive load, and processing fluency: the easier a claim is to process, the more true and more actionable it feels). Digits also survive skimming, because they are the only shapes in a paragraph that stand out on their own, so the number carries the claim even when nobody reads the sentence around it. And digits read as something measured while number-words read as prose, which matters most at the exact moment the reader is deciding whether to believe a number about their own money.

**How to find more.** Run three passes over the page. PASS 1, the squint pass: skim the page letting only digits stand out, the way a stressed reader actually reads it, and write down every fact that survives. Any claim you would want that reader to carry away, and that is not on your list, is a number wearing a word. Counts, minutes, dollars, sizes, steps, degrees, years, percents. PASS 2, the counting test: for every remaining number-word, ask "is this word counting something the reader could verify, act on, or compare?" If yes, it becomes a numeral. If it is idiom and counts nothing ("no one", "one call away", "a second opinion"), leave it alone. PASS 3, the extension nobody flags: vague quantifiers are this same error one step worse, because they hide a number inside a word AND refuse to say which number. "A couple of hours", "a handful of parts", "twice", "half an hour", "a few minutes", "several". Decide the real number and print it: 2 hours, 30 minutes. If you cannot honestly commit to a number, you have a content problem rather than a formatting one, so go get the number. Finally, sweep the places written outside the body flow, because that is where spelled numbers survive edits: headings, sub-heads, stat card values and labels, button text, tooltips, image captions, alt text, meta descriptions and page titles.

**Mechanical check.**

```
Regex sweep (ripgrep, case-insensitive, word-bounded): rg -in "\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|dozen|twice|couple|handful|several|few|half)\b" -g "*.{html,tsx,jsx,md,json}" . Then hand-clear the idiom allowlist: "no one", "one of", "one-time", "second opinion", "second look", "first time", ordinal street or brand names, and anything inside a quote or legal text. Countable gate a script can enforce: every stat-card value and every time claim must start with a digit, $, or #, so /^[\d$#]/ must match; a value starting with a letter fails the build.
```

| | |
|---|---|
| **Good** | Your AC has been blowing warm for 3 hours. Answer 7 questions about what you can see, and you get a page a tech can read in 30 seconds. |
| **Bad** | Your AC has been blowing warm for three hours. Answer seven questions about what you can see, and you get a page a tech can read in half a minute. |

**Where it does not apply.** Two honest exceptions. First, collision in titles: when a numeral would land directly above or beside another numeral, in stacked card titles, a heading sitting over a stat, or two labels side by side, the eye tries to read the pair as one figure or to compare them, and both numbers get weaker. Spell out the less important one there ("Ten minutes" above "4 safe checks"). That is a layout judgment, so make it after the page is laid out, never while drafting, and never in body copy. Second, words that are not counting anything: "no one", "one call away", "a second opinion", "one-time fee". Swapping a digit in there ("a 2nd opinion") makes the line read like a receipt instead of a sentence. Also leave numbers inside direct quotes, legal text, and proper names exactly as they were written.

<details><summary>Melissa's own words</summary>

> * make a rule use numeral for numbers on results NOT words "Your 400 sq ft shed needs two permits in [[Fort Wayne]].
>
> Five → change to 5 (ALWAYS use numbers as easier cognitively)
>
> Your four safe checks, and the two red zones. --> numerals
>
> 9 fix but the ten minutes is right above another number so writing it out in that case as titles should problable stay

</details>


## 37. Pick every example figure for the feeling it creates: the smallest honest, oddly specific number wherever you want her leaning in, a big number only where you want her appalled at the alternative, one rolled-up number instead of a list of fees, and every figure tied to her model, her area, or her hardware store.

Corrected 3 times.

**Why.** Two things happen at once when she hits a number. It anchors the whole page, and she reads the example as the typical case rather than as an illustration, so a $4,000 figure in a neutral moment quietly tells her that only expensive jobs come through here and she is not one of them. Odd figures like $431 read as pulled off a real invoice; round ones like $500 read as invented, and as an opening bid she will be talked up from. And at 9pm in a hot house she has no spare attention for arithmetic: every separate fee is one more line to add up and one more place a stranger could be hiding something, where one rolled-up number is a single decision she can make and be done.

**How to find more.** Read the page once and mark every money figure, including ranges and $X placeholders. Then run five passes over each one. (1) JOB: cover the words, look only at the number, and ask what the reader would assume this whole service costs if that number were the only thing she remembered. Now read the sentence and ask what feeling it was built for. Lean-in moments (what you'd pay, what the part costs, what a visit costs) need the smallest honest number; appall moments (what she gets charged without this, what the wrong repair costs) need the biggest honest one. A mismatch is a defect even when the figure is accurate. (2) TYPICAL: assume she treats every example as the normal case, because she does. Ask "if this is what a normal job looks like, do I belong here?" A big figure sitting in a neutral spot is a scope signal telling most homeowners to leave. (3) ROUND: any figure ending in 00 or 50, or written as a wide range, reads as made up. Replace it with an odd figure from a real job, or say where it came from. (4) ADD-UP: count the amounts she must add together to know what she will pay. More than one means roll them into one and delete the components. Any money word that is not the price itself (fee, surcharge, markup, procurement, dispatch, trip charge, admin, processing) is a line she will read as a trap. (5) WHOSE: try to attach "for your model", "in your area", or "at your hardware store" to the figure. If you can't do it without lying, it's an internet average and it reads like one.

**Mechanical check.**

```
List every figure with `\$\s?[\dXx][\d,]*(\.\d{2})?`, then gate: (1) fail any round figure `\$[\d,]*(00|50)\b` inside a sentence about what the reader pays; (2) fail `(fee|surcharge|markup|procurement|dispatch|trip charge|admin|processing)` occurring within 60 characters of a `$`; (3) count `$` figures inside any block describing the reader's own cost, fail if more than 1; (4) fail any figure of $1,000 or more (`\$([1-9],\d{3}|\d{4,})`) whose paragraph does not also contain one of `(without|instead|replace|whole system|they'd charge|full system)`; (5) flag any `$` figure whose sentence contains no "your".
```

| | |
|---|---|
| **Good** | Most of these come back around $431. If they open it up and find something worse, it's $118 for each extra hour plus any parts. A capacitor for your model is about $19 at the hardware store you already drive past. A blower motor is closer to $640, which is why it's worth knowing which one you have before anyone quotes you. |
| **Bad** | Repairs arranged through PRN typically run $2,500 to $5,000. Your total includes a $95 dispatch fee, a 15% equipment procurement fee, and labor at prevailing market rates. Contact us for pricing specific to your situation. |

**Where it does not apply.** Small only works if it's true. On a door where the real fix is a compressor, $431 isn't inviting, it's bait, and the reader who gets quoted $6,200 an hour later stops believing anything else on the page. Take the smallest honest figure inside the real range, never a nicer invented one. Precision has to be earned the same way: for a number nobody can actually know, like a regional average, "$89" sounds computed and "usually $80 to $100 around here" sounds honest. And the one-number rule covers what she will be charged, not comparisons. When you're showing the $19 part against the $640 part, or with a packet against without one, both numbers have to sit side by side or there's nothing to compare.

<details><summary>Melissa's own words</summary>

> Example here should be small amount $431 or something on things we want them to feel drawn to like this. We want it to not set off internal /unconscious warning bells its going to be REALLY expensive or that only the high ticket jobs should come through us.for things we want them unconsciously appalled by you'd keep the high price.
>
> we can say something like IF they find complications they charge X per extraa hour work (include the equipment procurement fee in first hour without explain or saying that so cusotmer sees one easy number) plus equipment cost if needed to replace damaged parts.
>
> (usually around $x say $6 at your hardware store you could go grab now) versus a new motor (~$X say $600 for your model). Or a this might be wher eyou want a service tech to come tell you quick- avg diagnosis visits are $x for your area

</details>


---

# Brand and emphasis


## 38. Paint only from the live palette, and give every color exactly one job: red for what genuinely must be done, green for what can be skipped or what you want pressed, pink for the homeowner's side, blue for the provider's side, and never a third accent.

Corrected 5 times.

**Why.** Red and green are read before words are — approach-avoidance motivation means red pushes a stressed reader away from a thing and green pulls them toward it, so a red "email yourself a copy" button quietly tells a scared homeowner not to press it, and a red badge on something optional teaches them that our red does not mean anything. Every extra hue on the page is a question the reader has to answer ("what does the teal box mean?"), and at 9pm in a hot house their working memory is already spent on the money and the stranger; consistent color lets them skim without decoding, which is processing fluency doing the work that copy would otherwise have to do. The brand half is plainer craft than psychology: a page whose colors all belong together looks like a company, and a page with one borrowed wine heading or one off-palette icon set looks like a template somebody half-edited, which is exactly the smell a person checks for when deciding whether to hand over money.

**How to find more.** Run three passes over the rendered page, not the code.

1. INVENTORY AND NAME. List every distinct color you can see: text, backgrounds, borders, badges, buttons, icons, emoji, illustration strokes, chart fills, hover and focus states, link colors. For each one answer two questions in order. (a) Which palette token is this? If you cannot name the token, it is off-palette — map it to one or delete it. (b) What does this color mean, in one sentence a homeowner would say out loud? If two colors give the same answer, merge them. If one color gives two different answers anywhere on the page, it has stopped meaning anything — split it or demote one use to plain text.

2. ASK WHERE IT CAME FROM. This is the pass that catches new instances. Off-palette color is almost never a decision someone made; it arrives attached to something borrowed. For every element that was not hand-built for this page — an icon set, an emoji, a stock illustration, an AI image, a chart library, a component copied from another page, a "warning" or "info" box inherited from a template — check its color before it lands. If the answer to "where did this color come from?" is "it came with the thing," treat it as off-palette until proven otherwise. Also check color conventions carried over from older pages of ours; being used before is not the same as being in the palette.

3. INTERROGATE EVERY RED AND EVERY GREEN. For each red thing ask: will something actually go wrong if the reader skips this? If no, it is not red. For each green thing ask: do we want them to do this, or is it safe to skip? If neither, it is not green. Then flip it and check for gaps: find the one or two things on the page that truly must be done and confirm they are the strongest red on the page, and find the main action we want taken and confirm it is green. A page where the required thing and the newsletter signup are the same color has failed even if every hex is legal.

Then two closing checks. Whose screen is this? Homeowner surfaces are pink, provider surfaces are blue; a pink accent inside a provider view is misfiled even though pink is on-palette. And color is never the only carrier — every red or green must also say its meaning in a word, because some readers will not see the difference.

**Mechanical check.**

```
Two gates, both countable.

(1) No color literal may exist outside the token block. List every color value in the file:
grep -oiE '#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|\b(crimson|maroon|teal|purple|violet|orange|gold|olive|navy|salmon|coral|brown|wine)\b' page.html | sort -u
Every value returned must also appear inside the ':root{...}' declaration block. Count of distinct values not found in :root must be 0.

(2) Nothing paints itself inline. Anything this returns is a candidate off-palette element:
grep -nE '(background|background-color|color|fill|stroke|border[a-z-]*)\s*:\s*(#|rgb|hsl)' page.html | grep -v ':root'
Should be 0 lines. Also count distinct hex values in the file: it must be less than or equal to the number of tokens declared in :root.

Manual follow-up the script cannot do: SVG and emoji carry color that these regexes miss when it is baked into a path or a glyph, so grep -c '<svg' and eyeball each one.
```

| | |
|---|---|
| **Good** | "Call 811 before you dig. It's free, and it's required." That tag is the deepest red on the page, because you can get hurt skipping it. "Email yourself a copy" sits on green. You want them to press it. Everything else is black, white, and your pink. |
| **Bad** | "Call 811 before you dig" in soft orange, under a wine-colored heading, with green question marks beside every field and a teal "Pro tip" box halfway down. |

**Where it does not apply.** Color that is real-world information, or that belongs to somebody else, keeps its true color. Utility locate paint is standardized — red is electric, yellow is gas, blue is water — so a page teaching a homeowner to read the marks on their lawn shows the real colors even though yellow is nowhere in our palette. Same for a photo of a scorched wire, a partner logo, or a certification mark: recolor those to fit the brand and you destroy the thing that made them useful, and in the case of a logo you are misrepresenting someone. Keep them inside a bordered figure so they read as content rather than as a new accent, and never let a real-world color also be a button. One smaller exception: if a palette token fails contrast on a given background, reach for the darker or lighter token in the same family rather than shipping something unreadable — readable beats exact.

<details><summary>Melissa's own words</summary>

> no on the wine color. Use black and [[the pink]] you already ahve
>
> * the free required tag for digging should be the deepest RED as it MUST be done | * Email should be a green backgorund you WANT them psychologicaally to do it not red danger vibes
>
> one note we need to match shed.store pallet better then the previous blogs have been doing. they've been using a deek green but look up sheds.store and it has some orange a lighter /white backgorund and a lighter green i think.
>
> green question marks dont match our colors

</details>


## 39. Set LIVE in capitals wherever it does differentiator work, call the product the LIVE Walkthrough Tool by name, and write every approved name — Home Memory, HouseKeep, Trust Network, Job Packet, Powered by CHI™ — exactly, never paraphrased.

Corrected 4 times.

**Why.** Two different mechanisms sit under one rule. Calling a thing the same thing every time buys processing fluency and rides the illusory truth effect: a product with one stable name reads as a real object that exists in the world, while the same product called three slightly different things reads as a description someone invented while typing, and a homeowner at 9pm deciding whether to trust a stranger is scanning for exactly that tell. Paraphrasing into an industry term is worse than vague, because it is schema assignment: "shared lead" hands the reader a folder they already own, and that folder is labeled "my number gets sold and four trucks call me," so the sentence does the distrusting for them. The capitals are craft rather than psychology — LIVE is the one word on the page a static form, a chatbot, or a callback cannot honestly copy, and caps are what make it survive a skim by someone who is hot, tired, and reading three lines out of thirty.

**How to find more.** Run three passes over the page, including subheads, buttons, alt text, FAQ answers, and the meta description.

PASS A, referent sweep. Write down every noun phrase that names something PRN made or gives — anything the homeowner could receive, open, use, join, or be enrolled in. Group them by what they actually point to. Any referent carrying two surface forms on one page is a defect: the approved name wins in all of them. A shortened repeat mention is allowed only when it drops the branded word entirely ("the walkthrough"), never when it lowercases it ("live walkthrough").

PASS B, the borrowed-folder test. For each of those phrases ask: could a competitor's page contain this exact phrase and mean their own thing? Lead, shared lead, quote request, estimate, service call, consultation, trusted pros, our network of contractors — if the answer is yes, it is an industry category word, not our name, and it files us inside a folder the reader already distrusts. Swap in the approved name.

PASS C, the LIVE test. Find every instance of "live" and ask of each sentence: could a static form, a chatbot, or a scheduled callback do this same thing? If no — if "live" is the word that makes the sentence untrue of them — it is doing differentiator work and gets capitals. If the sentence stays fully true with the word deleted, delete it instead of capitalizing it. If it is the ordinary word ("go live your life", "where you live"), leave it lowercase.

**Mechanical check.**

```
Case-drift gate (exact count must equal case-insensitive count for every approved name):

for n in "LIVE Walkthrough Tool" "Home Memory" "HouseKeep" "Trust Network" "Job Packet" "Powered by CHI™"; do a=$(grep -oF "$n" page.html | wc -l); b=$(grep -oiF "$n" page.html | wc -l); [ "$a" = "$b" ] || echo "NAME DRIFT: $n ($a exact of $b)"; done

Paraphrase sweep, every hit hand-checked:
grep -nEi "live walkthrough|shared lead|\blead\b|quote request|trusted (pros|partners|network)|home.?memory|house.?keep|walkthrough tool" page.html

Trademark check:
grep -n "Powered by CHI" page.html | grep -v "CHI™"

Caps-density check (ties to the edge case): grep -o "LIVE" page.html | wc -l should be 3 or fewer per page and at most 1 per section.
```

| | |
|---|---|
| **Good** | Your AC is running and the air is warm. We walk you through yours, LIVE, and you end up with a Job Packet you can hand to any company you want. |
| **Bad** | Our live walkthrough turns your answers into a shared lead, so trusted pros in our network can reach out with a quote. |

**Where it does not apply.** Capitals are a scarce resource. LIVE only reads as a differentiator while it is rare; four LIVEs in three paragraphs reads as an infomercial and costs trust with the exact reader who is already scanning for hype. So cap it where it earns the contrast — the banner, the product name on the intake form, the button — and in ordinary body copy drop the word rather than repeat the caps: "the walkthrough takes about ten minutes" is right. Ordinary-sense live stays lowercase, always: "You can close the tab and go live your life." And in alt text and aria-labels, write the name in normal case, because some screen readers spell all-caps words out letter by letter.

<details><summary>Melissa's own words</summary>

> banner "e walk you through yours, live, " LIVE should be all caps
>
> LIVE Walkthrough Tool . not just live walkthrough. Put that under the Tell us what your AC is doing. on the intake form as a title for the tool
>
> Only HouseKeep or Home Memory as the memory product line.
>
> A Job Packet is never a "shared lead"

</details>


---

# Humour


## 40. Make the joke dry and tongue in cheek, aimed at the situation, the internet, or PRN itself, never at the homeowner, and list every new joke in a numbered list for Melissa to approve before it ships.

Corrected 5 times.

**Why.** A joke is a status move: it puts the teller above whatever it targets. A homeowner sweating at 9pm, already worried they are about to look stupid in front of a contractor, will read a joke pointed anywhere near their own competence as confirmation that they are the mark. Point it at the situation, at YouTube, or at us, and the same joke becomes an in-group signal: we both know this is ridiculous, and I am standing next to you, not across from you. Self-directed humour is also the pratfall effect at work, a small admitted flaw makes a competent stranger more likeable and easier to trust with money. The numbered-list approval rule exists because humour has no middle setting, a joke that misses does more damage than no joke at all, and the failure is invisible to the writer who wrote it.

**How to find more.** Run these three passes over every line that is trying to be funny. PASS 1, name the target. Say out loud "this joke is at the expense of ___". If the blank is the reader, anything the reader did, or anything the reader failed to know, cut it or flip the target. The disguised version is the dangerous one, jokes about "the guy who tries to fix it himself with a YouTube video and a butter knife" ARE reader jokes, because that guy is the reader. Ask, would a homeowner reading this see themselves in the punchline, or see something they are up against? Only the second one ships. PASS 2, the 9pm read-aloud test. Read the line in the voice of a stressed person who is not in the mood. If it lands as chirpy, pleased with itself, or like a brand doing a bit, cut it. Dry means the sentence would still be a true, useful sentence with the humour removed, the joke rides on top of real information rather than replacing it. Anything that only exists to be funny is filler. PASS 3, the count and the list. Humour is seasoning, one dry line per screen, and it belongs on the low-stakes surfaces, headline, safety note, "why not YouTube", never inside a price explanation, a warning about gas or [[Electrical|electrical]] danger, or the moment someone is deciding to trust us. Then, before shipping, gather every new or changed joke into a numbered list in chat with the surrounding sentence for context, and wait for Melissa's yes or no per number. New copy with zero jokes needs no list. New copy with a joke ALWAYS needs the list, even one.

**Mechanical check.**

```
Flag for human review any line matching /\b(you probably|let's be honest|admit it|we've all|bless|good luck with that|amateur|DIY hero|silly|dumb|stupid|clueless|oops|yikes)\b/i, plus any second-person sentence containing "you" within 8 words of /\b(think|thought|assume|figure|hope)\b.*\b(but|actually|turns out)\b/i, which catches the "you thought X, actually Y" gotcha shape. Countable gates: no more than 1 flagged-humour line per 150 words; 0 humour lines inside any block tagged price, safety, gas, electrical, or emergency. Shipping gate: if the diff adds or changes any line the writer marked as humour, the turn must contain a numbered list of those lines and an explicit approval reply before merge.
```

| | |
|---|---|
| **Good** | Turn the power off at the breaker first. Free advice, and it beats the alternative. YouTube will show you a repair. It will not show you your AC, at 9pm, making that exact noise. |
| **Bad** | Before you grab the duct tape and become a weekend HVAC hero, maybe let the grown-ups take a look. We've all been there, buddy. |

**Where it does not apply.** Do not run the joke pass on the parts of the page where someone is scared or spending money. Gas smell, burning smell, water rising, sparking panel, and the price and payment lines all get plain sentences with no wink at all, because humour there reads as not taking the danger seriously and quietly costs you the trust the rest of the page earned. The approval-list rule also has a limit, it applies to NEW or CHANGED jokes only. A line Melissa already approved that is just moving to another page does not go back on the list, re-approving settled copy wastes her attention and slows shipping for nothing.

<details><summary>Melissa's own words</summary>

> can you list suggested humor inserts or changes in the chat for me to approve or not in a  numbered list? humor is powerful
>
> we need another reason we are different from youtube . also list the safty thing but use humor like so you dont fry yourslef
>
> Humour targets the situation, the internet or us, never the reader.
>
> make it tongue in cheek, hook, market type

</details>


---

# Surface-specific


## 41. Write Trust Network as a decision that is already finished somewhere else: give the reader one name, the person it came from, the reason attached, and one next action, and keep the friend's entire part to a single tap that needs no account, no comparing, and no explanation of what PRN is.

*Merged in from the GPT canon. Not yet tested against a live correction.*

**Why.** Word of mouth works because the expensive part is already done. Somebody with skin in the game paid the money, watched the work, and reached a verdict, so the reader inherits a conclusion instead of a dataset. Turn that conclusion into stars, scores, or a browsable set of neighbour profiles and you hand the decision straight back to her, which is the exact labour PRN exists to remove, and at 9pm in a hot house she has no attention left to re-decide what her neighbour already decided for her. A rating also destroys the only thing carrying the trust, which is who said it: "Renee next door used them twice" is evidence about a person she knows, and 4.6 is evidence about strangers she does not. On the other side of the ask, the friend giving the referral has to feel they are doing a small favour, not picking up a task, because a favour gets done in the moment and a task gets postponed until it never happens.

**How to find more.** Two passes, and run the friend's one first because it is the one everybody skips. PASS 1, walk the friend's side. List every single thing the copy asks of the person giving the referral, in order, starting the second they get the message. Creating an account, downloading anything, learning what PRN is before they can help, picking a category, comparing two providers, or typing more than a name all count as steps. If the list is longer than one tap, the referral will not travel, and no amount of warmth in the wording will fix it, because favours are paid in seconds. Collapse it until the friend's whole part is "here is who I'd call" and PRN carries the rest. Then read that step aloud as a text message from a real person. If it sounds like a chore being assigned, rewrite it as a sentence they would actually send. PASS 2, sweep the customer's side for research verbs and research nouns: compare, browse, search, filter, sort, shortlist, rate, review, score, rank, top-rated, best match, profile, listing, directory, and any star. Every hit is a closed decision that the copy has reopened. Replace each one with the three pieces that make research unnecessary: one name, who vouched and why, one next action. Finish with a count. One trust block holds exactly one provider name and exactly one button. Two names is a comparison, and a comparison is research.

**Mechanical check.**

```
FAIL grep on all customer-facing Trust Network copy: (?i)\b(compare|browse|search through|filter|sort by|shortlist|reviews?|rate|rating|ranked?|ranking|scores?|stars?|out of 5|top[- ]rated|best match|profiles?|listings?|directory)\b — zero hits allowed outside the backstop block. FRIEND-SIDE GATE: extract every action the copy asks of the referring friend; count must be <= 1, and that one step must produce zero hits on (?i)(sign up|create (an )?account|register|download|log ?in|set up|your profile|rate|review|compare|fill (in|out)|enter your). NAME GATE: within each trust block, the number of distinct provider names must equal 1 and the number of buttons or CTAs must equal 1. VOUCH GATE: every provider name shown to the customer must sit within 120 characters of a named human source matching (?i)(your |my )?(neighbor|dad|mom|sister|brother|coach|coworker|friend|next door|two houses|on your street) — a name with no person attached is a listing, not a referral.
```

| | |
|---|---|
| **Good** | [[Ask Your People|Ask your people. Keep the answer.]] / Renee next door used Vance Water Heater twice. She would call them again. [ Send Vance my walkthrough ] / Helping back is one tap. Your neighbor gets the name and the reason you gave it. Nothing else of yours goes with it. / You already paid to learn who actually shows up. One name, and somebody's 2am gets a lot shorter. / Your people first. Our network when you need it. |
| **Bad** | Browse trusted providers in your network. Compare neighbor ratings, filter by service type, and read reviews before you decide. / Vance Water Heater, 4.6 stars, 31 reviews, ranked #2 in your area. / Invite your friends to join PRN, create a profile, and rate the pros they have used. Earn a badge for every provider you review. |

**Where it does not apply.** Two places this loosens. The backstop [[Tier|tier]] is the real one: when nobody in her map has a name, the copy has to sell a stranger, and there checkable fact is the honest currency. Licensed in [[Allen County]]. Did this exact repair three streets over last month. We sent them and we stand behind it. That is evidence, not a rating, and it is allowed to run as a short list, because at that point she genuinely does have a choice to make and pretending otherwise is worse. Keep it visibly second so the order still reads as your people first, our network when you need it. The other is the provider side, where a provider looking at their own standing and measuring it against the market is the entire job of that page, and softening it into a warm single name would make it useless to them. One thing that looks like an exception and is not: asking the customer, after the job, whether they would call that provider again. Keep asking it. It is one tap, it is a finished judgement, and it is what feeds the whole thing. The rule stops that answer from becoming a public number on a profile, it does not stop us collecting it.


## 42. Write every provider line about what the business is taking from their skilled hours and their life, and name the exact hour it hands back (tonight, Saturday morning, the hour of phone tag before a job) instead of asking them to work harder, grow faster, or chase more leads.

*Merged in from the GPT canon. Not yet tested against a live correction.*

**Why.** A tradesperson reading this already worked eleven hours today, so a line about hustle reads as a diagnosis, and the diagnosis is that their problem is effort. That is wrong, and being wrong about the job in the first sentence tells them the writer has never been in a van, which means nothing further down the page is worth their ten minutes. The real constraint is structural: the unpaid hours wrapped around the paid ones, the quoting at 10pm, the four calls to find out what the homeowner is actually looking at. Naming that structure is the competence signal that buys the read, and for someone already at capacity a gain framed as getting something back lands where "more" cannot, because there is no room left in the day for more.

**How to find more.** Run five passes over anything a provider will read: headlines, buttons, card titles, emails, the recruiting page, the onboarding screens.

1. MORE OR BACK. Cover the page, read one line alone, and ask which direction it points. Does the reader end up doing something extra, or getting something returned? "More" is the wrong arrow even when the sentence is friendly, and even when the extra thing is easy. Rewrite until the reader is the one receiving.

2. WHOSE VERB. Underline the subject of every verb in the block. If the provider is the subject of most of them, you have written a to-do list and handed it to a man who already has one. The provider should be the subject of trade verbs only (fix, replace, diagnose, wire, finish). PRN takes the admin verbs (schedule, collect, chase, quote, remind, file, follow up).

3. WHERE THE PROBLEM LIVES. Ask what the copy blames. If it points at his effort, his ambition, his mindset, his systems, or his marketing, it fails, because all five are polite ways of saying he isn't trying hard enough. If it points at the unpaid work stuck to the outside of the paid work, it passes.

4. NAME THE HOUR. Any line resting on "time", "freedom", "work-life balance", or "hours back" is a placeholder. Replace it with an hour that has a clock or a calendar on it: this evening, Saturday morning, the forty minutes on hold with the parts counter, the Sunday night you spend writing quotes, the drive back out because nobody said which unit. If you cannot name the hour, you do not yet know what you are selling him.

5. READ IT OUT LOUD TO A GUY WITH A TRUCK. Every line has to survive being said to a man in a driveway at the end of a long day. If he would answer "no kidding, thanks", it is out. This pass catches the ones that are technically about the structure but still sound like a seminar.

**Mechanical check.**

```
Four gates on any provider-facing file.

(1) Hustle register. Must return 0 lines:
grep -niE '\b(hustle|grind|scale (your|up|the)|scaling|grow (your|the) (business|revenue)|next level|10x|work smarter|maximi[sz]e|optimi[sz]e your (day|business|workflow)|unlock (your|the)|your potential|crush it|level up|leaving money on the table|more leads|lead gen|empire|boss|entrepreneur|side hustle)\b' page.html

(2) Effort imperatives aimed at the reader. Must return 0 lines:
grep -niE '\b(work|push|hustle|grind|do|sell|close|book) (harder|more|faster|smarter)\b|\bmore (jobs|leads|calls|customers|clients|hours|work)\b' page.html

(3) Direction count. "more" must not outnumber the give-back words:
grep -oiE '\bmore\b' page.html | wc -l
grep -oiE '\b(back|home|evening|tonight|Saturday|Sunday|dinner|done|off the clock|already)\b' page.html | wc -l
The first number must be less than or equal to the second.

(4) Vague time. Every hit here must have a named hour, day or task within 120 characters, or it fails:
grep -niE '\b(time|freedom|work.life balance|hours back|your life back)\b' page.html
```

| | |
|---|---|
| **Good** | Your business should give you money AND time. [[Marketing Phrase Bank|You fix the thing. We run the business around the fix.]] The job reaches you already diagnosed, with photos, the model number, and what the homeowner already agreed to, so the hour of phone tag is spent before you pull in. Every job leaves your company smarter, because the house remembers what you did and so does your file. Finish the last job. Park the truck. Go home. Be done. |
| **Bad** | Ready to scale? PRN helps ambitious pros work smarter, not harder. Unlock your potential with more leads, more jobs, and the tools to take your business to the next level. Stop leaving money on the table. Grow faster, close more, and maximise every hour of your day. |

**Where it does not apply.** Growth is allowed when it is his growth and he said so first. A provider hiring a second tech or putting a second van on the road wants that named, and refusing to say it reads as evasive. Say it as capacity the business absorbs for him: "a second truck without a second office day", not "scale to a fleet". The word "more" is also fine when what increases is money or the paid share of hours he is already standing there for. "Get your life back AND more billable hours" passes, because the extra hours are ones he was working unpaid; the test is whether he has to spend anything additional to collect them. Volume facts on a recruiting page are facts, so "eleven prepared jobs a week in your zip" stays, since it describes supply rather than demanding effort. And do not overcorrect into a promise of an easy life. "Never work another Saturday" is a claim you cannot keep, and a man who has worked twenty of them will price it as a lie and stop reading. Give back one hour you can actually name.


## 43. Judge a name on whether people can repeat it and build meaning onto it: score memorability, tension, symbolism, sound, distinctiveness in a crowded category, and the vocabulary it grows, and treat accurate description as the floor every candidate has already cleared rather than the reason to pick one.

*Merged in from the GPT canon. Not yet tested against a live correction.*

**Why.** A name has to survive being said out loud by somebody who is not selling anything. Accuracy is the most crowded part of the naming space, because every competitor derived their name from the same function, so an accurate name gets stored as the category rather than as us and the listener files it in a folder they already own. A name with tension, metaphor, or an odd bit of sound is distinctive enough to be stored on its own, and it leaves the listener something to hang their own meaning on, which is the difference between a label they read once and a word they actually use. And a name that spawns vocabulary earns compound interest: every time somebody says a word derived from it, they say the brand for free, while a descriptive name pays back nothing after the first read.

**How to find more.** Four passes over the candidate list, before any of them reaches a page.

PASS 1, the spoken sentence. Write the sentence a homeowner would say to her neighbour over the fence, with the name in it. "I ran my AC through ___ before I called anybody." If the sentence goes awkward, or if you catch yourself writing "that website" instead of the name, it cannot be repeated and it is out. Names die in the mouth long before they die on the page.

PASS 2, grow the vocabulary. Give yourself two minutes and derive five things from the name: a verb for what you do, a noun for what comes out, a word for the people who use it, a button line, and a tagline. "[[Open naming workstream|Collective Home Intuition]]" gives you CHI, an Intuitive Home, what your home knows, and "home intuition without the tuition." If you cannot reach five, the name labels the product instead of owning it, and every piece of copy after it will have to work harder forever.

PASS 3, the explanation-order test. Say the name cold to someone who has never heard of the product. A working name either lands a picture instantly or raises a question they want answered. If they need the product explained before the name means anything, the name is a caption on a picture they cannot see yet and it is doing no work. Second half of the same test: put a competitor behind the name. If it still fits them, you named the category, not us.

PASS 4, keep a dead list. A name Melissa turned down is dead, and a later model recommending it back is not an approval, it is the same crowded part of the naming space being rediscovered by the same method. Draft three fresh candidates instead of re-pitching a dead one. Pick the strongest survivor yourself, write the copy around it, note in the naming doc which one you picked and what it made possible, and keep moving.

**Mechanical check.**

```
Candidate gate. A name is not a candidate until the naming doc shows, for it:
  1 sentence a homeowner would say out loud, name included
  5 derived terms (verb, output noun, user noun, button line, tagline)
  1 thing it means that the product does not literally do
Fewer than 5 derived terms = label, not a name. Cut it and stop scoring it.

Crowding grep over the candidate list, every hit hand-checked:
grep -nEi "\b(smart|easy|simple|quick|instant|pro|expert|trusted|total|complete|solutions?|services?|hub|connect|assist(ant)?|helper|knows?|sense|wise|guru|genie|360)\b" names.md
A hit is category language. It survives only on a reason other than accuracy.

Rejected-name gate:
grep -nEi "house knows" names.md docs/*.md   # rejected stays rejected

Recall check: read the shortlist aloud once to somebody, wait ten minutes,
ask what they remember. Anything nobody can say back is out, however accurate.
Distinctiveness check: search the exact phrase plus "home repair". Three or more
companies using it generically on page one means it is a folder, not a name.
```

| | |
|---|---|
| **Good** | [[Open naming workstream|Collective Home Intuition]]. Turn your house into an Intuitive Home. [[Tell us what happened]] tonight and your house remembers it, and every house that has been through this makes yours a little smarter. Home intuition without the tuition. |
| **Bad** | [[House Knows]]. [[House Knows]] is a home [[My Property Record|repair history]] tool that keeps an accurate record of what was fixed, when it was fixed, and who fixed it, so your home information is always up to date and easy to look up later. |

**Where it does not apply.** This is a rule for the company and the flagship idea, the words people repeat to each other. It stops at the parts. The things a homeowner holds mid-problem get plain, boring, instantly readable names: Job Packet, Trust Network, LIVE Walkthrough Tool. Nobody at 9pm in a hot house should have to decode a clever name for the file she is about to hand a stranger, and a product where every component is evocative makes the reader learn a vocabulary before she can get help. It stops at door pages too: the page title matches the words she typed, "AC blowing warm air," because that is a search match, not a name. Distinctiveness also has a ceiling. A name nobody can spell after hearing it fails PASS 1 exactly like a bland one does, so strange is only worth it while it stays sayable. And a name you cannot legally own is out no matter how well it scores, same as accuracy: a floor, not a reason to pick it.


---

# How we work


## 44. Change only the lines her instruction names, in the smallest span that satisfies it, and revert anything else you touched.

**Corrected 11 times.**

**Why.** Approved lines are hers now: the endowment effect means every word she has signed off on is something she owns, so an unrequested "improvement" registers as a loss rather than a gift, even when the new wording is objectively better. Silent edits also destroy her ability to review cheaply — if any line can move, she has to re-read the whole page instead of the three lines she asked about, so the cost of every request scales with the document instead of the request. That is the same trust math her reader runs at 9pm: a homeowner who spots one line item on the estimate she never asked for stops reading the estimate and starts auditing the contractor. On top of the psychology there is a plain craft reason — approved copy was already tuned against a real reader, so a word swapped for flow is an untested guess replacing a tested line.

**How to find more.** Before handing anything back, diff your version against the approved version line by line and build a change ledger: one row per changed line, each row quoting the words in her instruction that asked for that change. Any row with an empty quote column is a regression — revert that line before you deliver. Run the test question on every edit: "Can I quote her asking for this?" If the honest answer is "she'd probably like it", "it reads better", "for consistency", or "I was in there anyway", it is unrequested and it goes back. Apply the same test inside the lines she did name: change the smallest span that satisfies the instruction, keep the rest of the sentence, and never drop extra words while making a requested swap — "change X to Y" does not approve rewriting the sentence around X. Then check the surfaces that do not show up in a quick skim, because that is where silent edits hide and where she finds them later: headings, nav and button labels, alt text, page titles and meta text, capitalization, punctuation, spacing, section order, and layout. If you believe an untouched line is wrong, do not fix it — list it at the end as a yes/no question she can answer in five seconds.

**Mechanical check.**

```
Save the approved file before editing, then gate on the diff. Changed-line count: `diff -u approved.html edited.html | grep -c '^[+-][^+-]'` (PowerShell: `(Compare-Object (Get-Content approved.html) (Get-Content edited.html)).Count`). That count must be less than or equal to the number of items in her instruction; higher fails and you revert the extras. Second gate, word count: `(Get-Content edited.html | Measure-Object -Word).Words` must not be lower than the approved file's unless she asked for a cut.
```

| | |
|---|---|
| **Good** | Her note: "line 2, say your AC, not HVAC unit." Before: "You can stop guessing. Your HVAC unit is blowing warm air, and you deserve to know why before anyone names a price." After: "You can stop guessing. Your AC is blowing warm air, and you deserve to know why before anyone names a price." One line in the diff, one word touched. |
| **Bad** | Same note. After: "Stop guessing. Your AC is blowing warm. Know why before you get quoted." Three edits she never asked for — a demand, a trim, and a rewritten close — and now she has to re-approve a page she already approved. |

**Where it does not apply.** Two honest exceptions. First, when the requested edit breaks its neighbors — grammar that no longer agrees, a number or link the change made wrong, a duplicated phrase, a heading that now contradicts the body — make the smallest fix that keeps the line true, then say so in one line of your reply so she can veto it. Second, a rule she has already given for a class of wording ("never write it that way again") is permission granted in advance, so apply it wherever it appears and tell her which pages you touched. Neither is a license to polish, and both require you to name the change instead of slipping it in.

<details><summary>Melissa's own words</summary>

> dont change ANY other text as ive approved it
>
> the design changes, and word crops were NOT helpful please revert pages and all instructions you changed with those and then i will give more directed feedback on the design aspect needed
>
> Do not change any other wording except the below as i have checked and approved the rest of it
>
> I LIKE the pages so please DONT change much.

</details>


## 45. Make the call yourself, log it on the running test-pass list, and keep writing; interrupt her only when you genuinely cannot proceed without her answer, never to ask permission and never to raise a risk on a sentence nobody was going to write.

**Corrected 8 times.**

**Why.** Every "do you want me to..." hands the decision back to the person with the least context loaded and the most going on, which is the same move the contractor makes at 9pm when he says "so what do you want to do?" and leaves a hot, tired homeowner to price a job she cannot see. The cost is paid twice, not once: attention residue means she pays to load your question and pays again to get back to what she was doing, and the answer she gives cold is usually worse than the one you would have picked with the page in front of you. Batching the calls into one list she reviews while testing turns twenty small taxes into one pass she can actually run, which is the same promise the product makes the homeowner: carry less in your head. A risk you invented is worse than silence, because signal dilution is real: spend her attention on a fire that is not burning and the next flag, the one that matters, gets skimmed.

**How to find more.** Before you send her anything, or before you stop working, run these four gates over your own outgoing message and over every item you were about to "check with her" on.

1. THE SUBSTITUTE TEST. Highlight every sentence that asks her for something. For each one ask: can I answer this with what is on my screen, plus the rule book, plus thirty seconds of judgment? If yes, it is not a question. Answer it, do it, log it. "Should the short answer sit above the header?" is answerable by asking what gets extracted first. Answer it.

2. THE UNDO TEST. For the ones that survive, ask what the fix costs after she tests it. If the repair is "change the words", "reorder two blocks", "delete a section", or "rename a thing", it is reversible and it is a log item, not a question. It becomes a real blocker only if a wrong guess spends money, goes public, touches a real person, writes data that cannot be unwritten, or commits her to a contract or a legal position. Reversible means decide. Irreversible or expensive means ask.

3. THE WOULD-WE-EVEN-WRITE-IT TEST, for risks. Before flagging any claim, compliance, or promise risk, quote the actual sentence in the actual draft that carries it. If you cannot paste a real line from real copy, the risk is imaginary and the flag gets deleted. If the claim concerns something PRN does not control, first ask whether we were ever going to promise it. Nobody was going to write "providers charge no fees", so there is nothing to raise.

4. THE CAN-SHE-SAY-NO TEST. For anything shaped "do you want me to build or write X", try to picture her saying no. If you cannot construct a plausible world where she declines, it is not a question, it is a status line. Build it, then tell her it exists.

Then the logging half, which is what keeps "decide and keep going" from becoming "decide and hide". Every call that skipped a gate lands on the checklist in one fixed shape: what you decided, the option you did not take, where on the page to look at it, and the one thing that would change your mind. If a decision is not worth a log line, it was not worth a thought.

Weekly sweep: read your last five messages to her and count the ones that delivered work against the ones that asked for something. More than one ask in five and you are leaning on her instead of working.

**Mechanical check.**

```
Run over any drafted message before sending: grep -nEi "\?|\b(should I|shall I|do you want|would you like|want me to|let me know|please confirm|is (it|that) ok|okay if|need (your )?(approval|sign.?off)|which would you|do you prefer|thoughts)" msg.txt — every hit must either be deleted and moved to the checklist, or justified by an irreversibility word in the same message: spend|publish|live|domain|delete|send|email|credential|contract|legal|account. Countable gates: question marks addressed to her per message <= 1, and 0 when no irreversibility word appears; decision-log line count must increase by at least one for every wording or structure call made in the session; any message containing "risk", "we can't claim", or "may not be able to say" must also contain a quoted sentence from the live draft.
```

| | |
|---|---|
| **Good** | Short answer now sits above the header. It puts the answer in the first block, which is what gets pulled and quoted. I cut "Start Here", it was a label doing no work. Both are on the test list under Door Page Layout, lines 4 and 5, with the version I didn't use. Moving on to the packet page. |
| **Bad** | The short answer could go above the header or below it. Above is probably better for AI extraction. Do you want me to move it? Also, should I keep "Start Here"? One more thing: we might not be able to say providers charge no fees, since we don't set their pricing. Let me know and I'll keep going. |

**Where it does not apply.** Two places this rule flips. First, when a wrong guess cannot be undone with an edit: spending her budget, pushing a page to a real domain, emailing a real person, deleting records, naming an account, anything counsel touches. Speed there is not efficiency, it is damage, and she keeps an owner list for exactly those. Second, when the missing piece is a fact only she holds, like what a provider actually charges or what she promised a partner. That is not a judgment call, it is information you do not have, and guessing invents a claim instead of choosing a word. Even then do not stall: write the line with a visible placeholder, keep going, and put the question on the list with everything else. And a claim risk you can quote from live copy gets raised now, not logged, because publishing it is the part that costs.

<details><summary>Melissa's own words</summary>

> Leg A- you DONT need my approval on thing slike this . ASSUME i will be testing the system COMPLETLEY when built and keep an internal record of ALL items you want me to look at and double check wording and action wise checklists for then. but do NOT wait for me now as that is wasting effort and time.
>
> you dont ask if i want that and have me come back to answer yes i do for that as that violates the efficieny rule
>
> i thought the short answer was to be before the header? id remove the start here unless that has value for an ai. DECIDE what is the MOST value for the ai and ranking and do that. no need to ask me.
>
> we dont control the [[Service provider|service providers]] pricing rescope wha tyou think we do... so we wouldnt be claiming things like no fees for providers. that is wasted time for you to bring up to me.

</details>


## 46. Land every correction in the rulebook and the template, never in the one page where she spotted it, then regenerate from there and hand the updated rulebook back before the session ends.

**Corrected 7 times.**

**Why.** This one is craft before psychology: the rulebook and the template are the single source of truth, and a correction typed into one page is a copy that the next regeneration quietly deletes. The psychology that matters here is the reviewer's, not the homeowner's. Every repeat of the same note forces Melissa to stop spot-checking and re-read everything, because one regression proves an approval means nothing, and that verification cost is exactly what makes people pull work back in-house. The homeowner never sees any of this, but they land on exactly one page, and it will be the page that missed the fix, at 9pm, in a hot house, deciding whether these people are careful enough to trust with money.

**How to find more.** Run the proper-noun strip on every correction, including the ones she drops in passing. Take what she said and delete every city, trade, symptom, file name and page name. If what is left still reads as a sentence about how PRN copy should work ("cost figures are labelled as typical published ranges, never a quote"), it is a rule, and the file she pointed at was only where she happened to see it. Then run three checks before calling it done. (1) Coverage: grep the exact offending string across every page in the folder plus the TEMPLATE file; any hits left mean you patched a symptom. (2) Generation: ask what produces that section, and if the answer is "a person typed it", the missing generator is the actual bug she is reporting. (3) Revert test: if the next regeneration would wipe your change, you did not land it, you decorated it. At the end of the session, walk her messages from the top and list every correction she gave; each one must map to a line in the rulebook, and to a check in the validator where it can be mechanised. A correction that exists only in chat has not happened. Four phrases mean you already missed one and should re-run this over the whole session, not just the last message: "again", "I already said", "it reverted", "did it not put those in the directions".

**Mechanical check.**

```
Two gates. Coverage: `grep -RilE "<corrected pattern>" *.html` must return nothing, and the searched set must include the TEMPLATE file, not just the page named in the request. Freshness: at end of session `find . -name "*.html" -newer "SEO DOOR TEMPLATE - build instructions.md"` must return nothing; any page newer than the rulebook is a page edited without the rule being written down. Countable property: rules in the rulebook >= distinct corrections in the session log, and every mechanisable rule adds one assertion to _validate-door-page.js.
```

| | |
|---|---|
| **Good** | Fixed it in the template and wrote the rule down, so the other pages and the next one get it too. [[Fort Wayne]] was just where you saw it. Rulebook is attached, dated today. |
| **Bad** | Updated the Fort Wayne page with the corrected cost line. Let me know if you want the same change made on the other cities. |

**Where it does not apply.** Facts that change with the city or the symptom are page data, not rules. A local permit requirement, a regional price range, one photo, a typo in a single H1: push those upstream and you make forty pages wrong. Test: if the sentence stops being true when you swap the city or the trade, it stays on the page. The other honest exception is a correction she is still deciding about, a "try it here and let me see". Keep that one local, but log it in the rulebook as pending with the page it is being tried on, so it is not lost either way.

<details><summary>Melissa's own words</summary>

> im getting the same wording issues over and over and after correcting once never should have to correct again.
>
> again ALL fort Wayne edits need reframed as Template edits and how to have that section generate AUTOMATICALLY | it's a TEMPLATE issue that needs fixed so ALL are live and linked.
>
> Go back through this whole chat and create a list of wording type rules and guidelines so the templates and seo pages generated have the correct wording types and copy that matches what we need without needing regenerated. Continually update this with every chat and feedback and give the more current one to download at the end of every chat.
>
> I'm confused because it reverted the color which i specifically said not to and used stats i said were weak (see below). did it not put those things in the directions?

</details>


## 47. Trace every element on the page to a named prompt or a named dealer field, write the prompt so a weaker model gets it right cold, and fix bad output in the prompt, never on the page.

Corrected 3 times.

**Why.** Two things are happening, and only one is psychology. The operator side is the curse of knowledge: the person writing the template can already see the good version in their head, so they write "make it locally relevant" and never notice they left the actual rule out, and a weaker model fills that gap with filler on every city forever. The reader side is arithmetic, not psychology: the homeowner in the hot house at 9pm sees exactly one page, not your average, so she grades you on your worst page, and a human quietly polishing the first twenty pages raises the average while hiding the floor. The rest is craft. A hand-finished page cannot be audited or repeated, so when a page converts you never learn whether it was the system or the writer, and you cannot ship that win to the next four hundred cities.

**How to find more.** Run a cold build, then two sweeps.

COLD BUILD. Pick a keyword and a city nobody has built yet. Feed the system only the keyword and the dealer fields. Run every prompt. Put the raw, untouched output next to the spec.

SWEEP 1, THE SOURCE SWEEP. Go down the finished page element by element and say each source out loud: H1, every subhead, every body block, every FAQ question, every FAQ answer, image alt text, captions, CTA button text, internal link anchors, meta title, meta description, slug, schema fields, footer lines, the walkthrough entry copy. For each one, name PROMPT-x or FIELD-y. If your answer is "we write that one," "the team fills it in," or you go quiet, that is a leak. Log it and close it by writing the prompt rule or adding the dealer field. Anything on the page with no spec row is also a leak, in the other direction.

SWEEP 2, THE WISH SWEEP. Now read the prompts, not the page. Highlight every instruction that two different writers could obey differently: "as appropriate," "tailor to the city," "natural tone," "make it compelling," "vary the wording," "roughly," "etc.," "use judgment." Those are wishes, not instructions. Replace each with a rule, a closed list to choose from, a number, or a field. Test question for any line in any prompt: could two people follow this and produce different output? If yes, it is not written yet.

THE STOP RULE. The build is finished when you read the raw output and do not reach for the keyboard. Every time your hands move, that movement is the finding. Ask what you knew that the prompt did not say, write that into the prompt, and rebuild the city from scratch. Never edit the page.

REGRESSION TEST. Once a month, rebuild an old city cold from the current prompts. If the new build is worse than the live page, somebody hand-fixed the live page and never fed it back.

**Mechanical check.**

```
Two gates over the spec and prompt files (not the rendered pages).

1) Wish-word grep, expected hits zero:
(?i)\b(as appropriate|where appropriate|if applicable|if relevant|as needed|use (your )?judgment|tailor|customi[sz]e|adjust as|natural[- ]?(sounding )?tone|compelling|engaging|vary the|something like|roughly|etc\.|and so on|TBD|TODO|placeholder|fill in|we('| w)ill write|team will|staff|by hand|manual)\b

2) Source-coverage count: every content slot row in the build spec must carry a source matching ^(PROMPT-[A-Za-z0-9_-]+|FIELD-[A-Za-z0-9_.-]+|CONST-[A-Za-z0-9_-]+)$. Rows failing must equal 0, and the count of rendered slots on a built page must equal the count of spec rows, so nothing appears on the page without a row and no row renders empty.

3) Diff gate: build the same keyword for two cities with no human touch. Every difference between the two outputs must trace to a FIELD. A difference that traces to neither a FIELD nor a documented prompt branch means the prompt is improvising.
```

| | |
|---|---|
| **Good** | H1. Source: PROMPT-01. Print the keyword exactly as typed, then a comma, then FIELD city, then FIELD state. Sentence case. 60 characters or fewer. No exclamation points. If the keyword runs past 45 characters, drop the state and keep the city. In: ac blowing warm air / Tulsa / OK Out: AC blowing warm air, Tulsa OK |
| **Bad** | H1. Write a compelling headline using the keyword. Make it locally relevant and keep the tone natural. Meta description: our team will tune this per city. |

**Where it does not apply.** Safety lines, license numbers, warranty terms, and anything that is a legal claim. You do not want a model writing a fresh gas-smell warning or inventing a license claim for city four hundred. Those get written once by a person, locked as a constant, and inserted identically everywhere. That is one human sentence reused, not a staff-written page. The prompts themselves and the one gold-standard page you write to calibrate them are human work too, by definition. The rule bans per-page labor, not system labor. And when a model cannot hit something safety-critical reliably, the fix is a locked constant or a dealer field, never a hand edit on the live page.

<details><summary>Melissa's own words</summary>

> no on staff written. NOTHING can be staff written. give clear instructions on the prompt. | ALL else if it can autogenerate needs to - like meta tags and slugs- work prompt to do so. anythign that cannot be autogenerated NEEDS a dealer field. no staff. make as self running completely so scalable. | NOTHING we do cna be done manually or we cannot scale
>
> so we need full prompt audit and drafting- think EVERYTHING a lesser model ai would need ot produce the HIGHEST quality and be able to create for each city automatically autonomously
>
> remember when drafting the rules to go BACK in the chat and use ALL the strategies we have discussed and include that are actually in this template- all that gpt said and we built in need designed into the seo page template updated doc you would create so a lesser ai can 100% COMPLETELY and easily create these to the SAME level and quality with different search intents and different SEO long tailed keywords.

</details>


## 48. Treat every line she types in a note or comment as a brief, not as copy: take the angle and the shape, then write the shipped sentence yourself.

Corrected 2 times.

**Why.** Two things are happening, one on each side of the page. On your side it is anchoring with insufficient adjustment: once her typed line is sitting in the draft it becomes the starting point, and every pass makes small tweaks away from her shorthand instead of writing a sentence built for the page, so her thirty-second sketch quietly becomes the ceiling. On the reader's side it is surface credibility: a homeowner in a hot house at 9pm, deciding whether to trust a stranger with a few hundred dollars, judges the finish of the page before he judges the argument, and chat-register hedges, a stray typo, or a phrase that reads like someone talking rather than someone writing get scored as evidence about how carefully these people do everything else. On top of that, half her notes name the thing she is rejecting inside the same sentence as the thing she wants ("see yourself isnt applicable"), so pasting the note back ships the exact phrase she just killed and she has to correct it a second time.

**How to find more.** Run a [[Provenance|provenance]] pass before anything ships. For every sentence of new or changed copy, ask one question: where did these exact words come from? If you can point at a message, comment, ticket, or spec where a human typed them, that sentence has not been written yet. It has only been approved in principle. Cover the source, write the line again from the idea alone, then compare the two and ship the better one.

Then scan for chat residue, which is what a promoted message leaves behind on a page: hedges (something like, along those lines, more polished, kind of, sort of, basically, maybe, I guess), a question mark ending a line that is not asking the reader anything, meta-references to the copy itself (this section, this part, here we say), "etc.", bracketed placeholders, a lowercase i, doubled spaces, a typo. Any one of those means a message got pasted onto a page and nobody rewrote it.

Last, run the negation check. Pull every "not X", "X isn't applicable", "X doesn't work" out of her note and search the page for X. Her rewrite notes name the target and the trap in the same breath, and the trap is the half that gets shipped by accident.

Test question when you cannot tell: would she read this line back and say "yes, that's it," or "that's what I said, but I meant it as an example"?

**Mechanical check.**

```
Two gates. (1) Overlap gate, countable and language-agnostic: for each shipped sentence, compute the longest run of consecutive words it shares with any line in the source thread, brief, or comment; flag any run of 6 or more. (2) Residue regex over page copy, case-insensitive: something (like|along)|along those lines|more polished|kind of|sort of|basically|maybe like|i guess|or whatever|\betc\.|and so on|\btbd\b|\[[^\]]*\]|(?<![A-Za-z'])i(?![A-Za-z'])|[ ]{2,}  — plus flag any line ending in "?" that is not a question addressed to the reader.
```

| | |
|---|---|
| **Good** | Her note: "not this wording but see yourself isnt applicable... something along those lines?" Shipped: "You don't have to get on a ladder to know the price is fair. Your Job Packet says what your AC needs, in plain words, before anyone quotes a number." |
| **Bad** | Her note: "not this wording but see yourself isnt applicable... something along those lines?" Shipped: "See it yourself before you pay. Something along those lines, more polished." |

**Where it does not apply.** The rule flips in two places. First, verbatim language that is itself the asset: the symptom a homeowner types into Google ("AC running but blowing warm air"), a real customer quote, a line copied off an invoice. Polishing those breaks the search match and the ring of truth, so copy them exactly, awkward grammar included. Second, when she says "this is the line" or "ship this" instead of "something like this" or "along those lines." That is an approval, not a sketch, and rewriting it is the same mistake pointed the other way. The tell is the hedge: hedge means brief, no hedge means final. And when you do write it fresh and hers still reads better, keep hers and say so. The rule is write it again, not write it longer.

<details><summary>Melissa's own words</summary>

> more polished but somethign like that
>
> not this wording but see yourself isnt applicable… Something along those lines?

</details>


## 49. Write to her in words she already owns, and when something needs doing on her machine, offer to do it as a plain yes or no.

Added 2026-09-04, from a correction about my own writing rather than page copy.

**Why.** A term she has to come back and ask about costs a full round trip, and the round trip is the whole thing this rulebook exists to stop. She is not technical and does not need to be: her judgement is the scarce thing, not her command line. Her words: *"you used jargon on me. It needs one command from your checkout: I dont know what chekcout is or how to do it which is wsted time me going back to you."* The offer matters as much as the vocabulary, because an instruction she cannot execute is not information, it is homework. *"your i can do it IS helpful."*

**How to find more.** Read anything written for her and mark every noun a competent non-technical person would not use at a dinner table: checkout, branch, merge, push, fast-forward, ref, commit, gate, endpoint, schema, payload, regex, cache. For each mark, ask what it is FOR in that sentence, and write that instead. "Push from your checkout" is really "send the finished code live from your laptop". Then check for the second half: if the sentence asks her to run, open, configure or install anything, it must end with an offer to do it for her, phrased as a question she can answer in one word. The test on the whole message is: could she act on every sentence right now, without opening a search engine and without asking me what something means?

**The deploy shape specifically.** Her instruction, verbatim: *"in deply cases just say Josh has a deploy needed on your laptop may i push it for you? yes. no."* Name who needs it, say it is on her machine, offer, stop. No commands in the message unless she asks to see them. Deploys stay hers by standing rule, so the question is real and the answer can be no, or yes-but-later.

| | |
|---|---|
| **Good** | Josh has a deploy ready that needs to run from your laptop. It fixes a bug where hitting "start over" left people unable to answer anything again. May I push it for you? |
| **Bad** | T1-15 is one push from done. It needs one command from your checkout: `git push origin t1-15-start-over-reset:main`, which will auto-deploy the noindex trial site and close blocker cb388c. |

**Where it does not apply.** A term she has used herself is hers now, and swapping it for a simpler one is condescending. She says vault, page, door page, packet, agent, and those stay. Same for anything with a name she chose. And when she explicitly asks what something is or how it works, answer properly with the real term, define it once, and use it from then on.

---

# Finding rules nobody has written yet

This document will always be incomplete. New copy produces new mistakes. When something feels wrong and no rule above covers it, work it out and keep drafting rather than waiting to be corrected.

## 50. Never congratulate the reader for effort our own flow asked of them; name what they now hold instead.

**Corrected 1 time.**

**Why.** Praise implies difficulty. "You did the hard part" contains no negation, no complaint and no
banned word, so every existing gate passes it — and it still sells against us, because the only task
she just completed was ours. Congratulating someone on surviving a walkthrough retroactively files that
walkthrough under *ordeal*, at the exact moment she is deciding whether to come back. It is the same
failure as rule 5's denials, arriving through the opposite door: rule 5 plants the bad picture by
denying it, this plants it by praising her for enduring it. Warmth is not the problem — misplaced
crediting is. Tell her what she now has, and the good feeling arrives without the implication.

**How to find more.** Not a word test, a relational one. For every line of praise, relief, encouragement
or congratulation on any surface, ask: **whose work is being praised?** If the answer is work our own
product asked her to do — an intake, a walkthrough, a form, an upload, a set of questions — the line
fails, however warm it reads. Three shapes to sweep for: (a) praise verbs aimed at her recent activity
("you did", "you made it", "you got through", "nice work", "well done", "that was the hard part");
(b) completion framing that implies duration or difficulty ("that's over", "all done with the worst of
it", "the rest is easy from here"); (c) relief framing that names the flow itself ("no more questions",
"you can stop now"). Then check the page's other half: any line that describes our own process with an
effort noun — homework, assignment, chore, slog, hassle, the annoying part — is the same violation
stated plainly. **A correction on one surface is global**: the banned headline also sat on the PDF
flyer cover, which the instruction did not mention, and it had to come off both.

**Mechanical check.**

```
Candidate-finder, not a verdict. Case-insensitive over homeowner-facing copy only:
grep -oiE "\b(you (did|made|got|survived|finished|nailed)|nice work|well done|good job|the hard part|that('| i)s over|worst of it|no more (questions|forms)|homework|assignment)\b"
Every hit must then answer the relational question by hand. Praise aimed at something she owns or
did in the world (buying the house, noticing the problem, keeping the receipt) is legal and good.
Praise aimed at completing OUR flow is not.
```

| | |
|---|---|
| **Good** | **Your Job Packet is ready.** Then, immediately, what she now holds and what it does for her. |
| **Bad** | "You did the hard part." / "That was the [[Home repair without the homework assignment|homework assignment]]. It's done, and it doesn't come back." / "[[Home repair without the homework assignment]]." |

**Where it does not apply.** Praise for something she did in her own life, outside our flow, still lands
— "You did the hard part. You bought the house." is approved canon precisely because the credited act
is hers, not ours. Safety compliance is also exempt: telling someone they did the right thing by leaving
the house and calling from outside is confirmation she needs, not marketing.

<details><summary>Melissa's own words</summary>

> you did the hard part should NEVER be in our wording as i explained that makes it seem like part of
> our system was hard. why would we do that??
>
> you dont say that parts over or annoying part - you are introducing negatives into their minds about
> our process that is DESTABILIZZING our value. the WHOLE point of this page and the pdf first parts
> are to give them conratulations (not needed to paint as terrible to do that) and to paint VALUE.

</details>


## 51. A price is forbidden only when you cannot attribute it; publish the sourced number and never the invented one.

**Corrected 1 time.**

**Why.** A blanket "no prices" rule reads as caution but behaves as damage. Rule 6's PRICE TEST already
*requires* priced options — "fewer than two is a pitch wearing a walkthrough's clothes" — because a
homeowner deciding at 9pm needs to know what the paths cost, and a page that withholds that is doing
to her exactly what the industry already does. Meanwhile the real risk was never the presence of a
number, it was a number nobody can trace: an invented price is a claim we cannot defend, it ages
badly, and it is the single easiest thing for a competitor or a regulator to hold up. So the test is
provenance, not silence. Melissa: *"We dont want made up prices without citations unless for a clear
example for marketing text within common sense logic."*

**How to find more.** For every number on any surface that touches money, ask one question in order:
**can I name who published it, for where, over what window, and out of how many?** (This is rule 17's
test, applied to money.) Three outcomes. (a) **Yes** — publish it with the source visible beside it,
as the approved Carrier range on the AC door page already does. (b) **No, and it is presented as
fact** — it is invented. Cut it or source it; there is no third option. (c) **No, but it is an
obvious illustration inside marketing copy** — "you are out $12 and you keep the spares" — that is
legal, because a reader cannot mistake it for a quote. Then check the direction of the error: our own
future price data is a *good* outcome, so a rule written to prevent invention must never be written
in a way that also prevents publication.

**The one artifact where the answer is still no price: the Job Packet.** Not because prices are
wrong, but because that document lands in front of a provider who is about to quote the job, and a
number on it anchors their quote. PRN does not control provider pricing. The packet lists scope
factors; the provider prices them. Scope the rule to the artifact, never to the company.

**Mechanical check.**

```
Find every money token on the surface:
  grep -noE '\$\s?[0-9][0-9,.]*(\s*[-–—]\s*\$?[0-9][0-9,.]*)?|\b[0-9]+\s*(dollars|per hour|an hour|/hr)\b'
Every hit must have a source reference within the same block -- a footnote marker, a cited
publisher, or an explicit "example" framing. Count of unsourced, non-illustrative hits must be 0.
Separately: on the Job Packet only, the count of ALL money tokens must be 0.
NOTE for the code guard: FORBIDDEN_PACKET_COPY_PATTERNS in src/domain/problem/packet-copy.ts
refuses on /\$\s?\d/. That is correct FOR THE PACKET and must not be generalised to page copy.
```

| | |
|---|---|
| **Good** | "$200–$1,500 — Carrier's published repair range for an AC blowing warm air, depending on the cause." Source named, on the card. |
| **Good** | "You are out $12 and you keep the spares." An illustration, unmistakable as a quote. |
| **Bad** | "Most repairs run about $400." Whose figure? Where? When? Out of how many? |
| **Bad** | Any dollar amount on the Job Packet, sourced or not. |

**Where it does not apply.** Safety stops — rule 6's own limit stands: laying prices beside a hazard
makes it look negotiable.

<details><summary>Melissa's own words</summary>

> wherever you got this it ISNT true as I approved what we have an we WILL be adding our own prices
> as well. We dont want made up prices without citations unless for a clear example for marketing
> text within common sense logic.

</details>


## The five questions

Run these on any sentence that feels off. Each is the general form of a whole family of rules above.

**1. Who benefits from this sentence existing?**
If the answer is the writer, the page, or the company's comfort, cut it. If it is the reader standing in a hot house at 9pm, keep it. Meta-lines, throat-clearing, hedging and self-praise all fail here.

**2. Could a bad actor write this exact sentence truthfully?**
If yes, it carries no information. "Honest", "trusted", "transparent", "we care" are free to say, so saying them signals nothing. Replace with the checkable fact underneath.

**3. Cover the negation with your thumb. What is left?**
If what remains is a phrase a competitor would put on an attack page about us, we planted it. Unless she arrived carrying the thought — then it is contrast, and contrast is some of the strongest copy we have.

**4. What does this sentence make the reader do next?**
If nothing, it is scenery. Every unit either hands over a fact, gives a reason to act, or kills a fear she has *at that point on the page*. An objection answered before it is raised is not reassurance, it is planting.

**5. Would you say it out loud, in these words, to somebody in your kitchen?**
Nobody says "you are not required to read the analysis" out loud. Catches formality, legalese and AI cadence in one pass, and it is the fastest of the five.

## Two techniques worth using on every new rule

**Write the near neighbours.** A rule you can only apply by recognising the exact banned words will not stop the next instance. So when you find a new rule, immediately write three sentences that break it *without reusing any of the original wording*. If you cannot, you have found a banned phrase rather than a rule, and it will be dodged by accident within a week. Melissa rejected "homeowners are forced to make expert decisions". The near neighbours are "home repair is too complicated for normal people", "most people have no idea what their system is doing", "you shouldn't have to understand your furnace" — all different words, all the same failure.

**Check the other surfaces.** A correction almost never belongs only to the page where it was spotted. When a rule lands, walk the list: door pages, homepage, provider page, results page, Job Packet, Home Memory, Trust Network, local reports, emails, the SEO page generator prompts, onboarding, naming. The same mistake is usually sitting in three of them.

## What a real rule looks like

The rule, the why, the detection heuristic, a good and a bad example, and the edge case. **Every real rule has an edge case.** If you cannot find the case where it makes copy worse, you have written a preference, and preferences get misapplied.

Then add the mechanical check if one is possible. A rule that can be gated in `_validate-intent-page.js` never has to be remembered by a person again, which is the whole point.

---

# Lines already in play

Not a list to paste from. A record of what has survived, so the voice stays recognisable and nobody rediscovers a weaker version of a line that already works.

**The offer**
- Tell us what happened.
- [[start with what happened|Start with what happened]].
- [[Filter the spam]]. Remove the uncertainty. Get [[One clear next step|one clear next step]].
- [[Spam]] is not the thing you actually needed. It is the substitute that shows up instead.
- Home repair without the homework assignment.

**The house**
- [[The Asset With Amnesia|Your house should remember]].
- Your $400,000 house is an [[Asset with amnesia|asset with amnesia]].
- Why is your brain your house's filing cabinet?
- Tell it once. Let the house remember.
- Every repair should make your house smarter.
- One repair at a time. No Sunday-afternoon home inventory project.
- Your future self should not have to search 4,000 emails for the warranty.
- Your home starts working like one connected asset instead of twenty unrelated problems.
- You stop carrying your home in your head.
- We stop your home from eating your life.

**Trust**
- [[Ask Your People|Ask your people. Keep the answer.]]
- A referral should not disappear after one job.
- One name you can actually do something with.
- Who would you personally call again?
- Your people first. Our network when you need it.

**Providers**
- Get your life back AND more billable hours.
- Your business should give you money AND time.
- Turn [[The skilled-hour leak|skilled hours]] back into [[The skilled-hour leak|skilled hours]].
- Stop buying names. Start accepting prepared jobs.
- [[Marketing Phrase Bank|You fix the thing. We run the business around the fix.]]
- Finish the last job. Park the truck. Go home. Be done.
- [[Company memory|Every job should leave your company smarter]].

**Audience**
- Built for real people. *(not "real families", which narrows the market for no gain — the single-mother origin story is a strong story, not a market boundary)*
- Focus on your life.

**Naming territory, none final**
- Collective Home Intuition
- Turn your house into an Intuitive Home
- Home intuition, without the tuition

---

# Lines that failed, and why

Kept so nobody regenerates them in synonyms. The failure is in the logic, not the wording, so a fresh sentence with the same logic fails the same way.

| Line | Why it failed |
|---|---|
| "Homeowners are forced to make expert decisions before they know what the problem is." | Rests PRN's value on her ignorance. She defends her competence and rejects the source. |
| "Access hundreds of trusted providers." | Advertises filtering work as a benefit. More options is more unpaid labour for her. |
| "Our AI-powered platform empowers homeowners…" | Interchangeable with a thousand companies. Mechanism first, meaning never. |
| "Built for real families." | Narrows the market with nothing gained. |
| "Complete your home profile." | Recreates the exact chore PRN removes. |
| "Rate providers for your neighborhood." | Turns a finished human judgement back into a research task. |
| "This packet pays for the hour you would have paid for." | A savings guarantee we cannot make. |
| "They arrive knowing the right part on the first trip." | Promises provider behaviour we do not control. |
| "House Knows" | Accurate and bland. Accuracy is the floor, not the reason to pick a name. |
| "Great job!" / "You've got this!" | Praise with nothing behind it reads as patronising to a capable adult. |
| "Home repairs can be stressful." | Category-average empathy. Says nothing only we could say. |
| "You are not required to read the analysis. Ever." | Words with no job, and a denial nobody asked for. |

---

# What is deliberately not a rule

Some things stay judgement calls, and pretending otherwise makes the copy worse.

- **How long a section should be.** Depends on what it has to carry.
- **Whether a given joke lands.** Rule 40 sends jokes to Melissa as a numbered list. That is the one approval gate in this document and it is there because she asked for it.
- **Which of two accurate framings is stronger.** Write both, keep the one that survives question 4.
- **When to break a rule.** Every rule has a "where it does not apply" section for exactly this reason. Breaking one on purpose and saying so is fine. Breaking one by accident is what this document exists to stop.

---

---

# How this document keeps itself current

**Corrections become rules automatically.** Melissa's standing instruction, 2026-09-03: *"auto add as i find things in any chat having to do with prn."*

So in **any** PRN conversation, on any surface, when she corrects wording, tone, a claim, a hook, humour, a name, or a framing, it gets written into this file as it happens. Not at the end of the session, not once it has come up twice, and never after asking whether it should be.

The entry has to be a rule, not a note. That means:

1. **The rule**, written as what to do.
2. **Why**, the mechanism. Name it properly where a real one applies, and say plainly when the reason is craft rather than psychology. A rule with no why cannot transfer to a sentence nobody has written yet.
3. **How to find more.** The load-bearing part. A rule that can only be applied by recognising the exact banned words will not catch the next instance, which is the reason the same notes kept coming back in the first place.
4. **A mechanical check** if one is possible. Anything that can be gated in `_validate-intent-page.js` never has to be remembered by a person again.
5. **Good and bad examples**, in her voice.
6. **The edge case.** Every real rule has one. No edge case means it is a preference, and preferences get misapplied.
7. **Her verbatim words**, typos and all. The quote is the evidence and it outranks any paraphrase of it.

Then `crew log` it, and keep both copies of this file identical: the working folder and `Documents/prn-vault/Project/03 Build/SEO Intent Pages/`.

**When the reason is not obvious, write the rule anyway.** Use the best inference available, mark it as inferred, and add a numbered question below. Her offer, verbatim: *"if you dont know psychology or cant figure out why i said what i said to make something stronger you can ask in a numbered table for me to get to when able to train our model and you."*

That table is a queue she works when she has time. It never blocks a draft, and nothing waits on it.

---

# Open questions

18 of them. Answer by number, one line each, in any order. Nothing here is blocking; every rule involved is already written and in use with my assumption baked in. Answering just replaces a guess with the real reason, which is what makes the next draft better than this one.

**Where they come from.** 9 are lines I drew myself, usually a threshold or a hard limit that had to be somewhere and had no correction behind it. 3 are places I guessed at your reasoning, where knowing the actual reason would change how far the rule reaches. 6 are genuine collisions between two rules that a writer will hit on real copy.

### 1. How many hidden costs per page
*Rule 9 · I invented this line, you did not*

**How many of these unpaid chores should one page name — and which one lands hardest with real homeowners?**

I assumed: I capped it at two per page, on the theory that a third stops reading as recognition and starts reading as a lecture about how hard her life is. I lead with re-explaining the same problem to a third person.

Changes: Sets how many pain lines every page gets, and which one opens.

### 2. When PRN's name is allowed in
*Rule 10 · I invented this line, you did not*

**How far in does she get before we are allowed to say PRN, the AI, or a product name — one sentence, the whole hero, or further?**

I assumed: I made the hard line "after the first sentence ends," so the line that changes how she sees her house lands first and the name arrives as the answer.

Changes: Decides the first two lines of every page, ad and email.

### 3. Vivid detail that might be wrong
*Rule 11 · I invented this line, you did not*

**When a scene is vivid but might not be her house — "down in your basement" to someone on a slab — do you want the vivid line or the safe flat one?**

I assumed: I ruled that detail can only come from what the page knows for certain (her symptom, her season, her equipment), so we never hand her a basement she does not have.

Changes: Decides how specific every empathy line can get across a 40-page batch.

### 4. Why we never say 'contractors always'
*Rule 12 · I guessed why you said it*

**Is the reason we never write "contractors always overcharge" that she thinks of her one good guy and stops trusting us, or that it insults the providers we are recruiting?**

I assumed: I wrote it as the first one: she wins a small argument with the page, and a reader who has just beaten you stops reading you as help.

Changes: If it is the provider reason, the ban also has to hold on pages no provider will ever read.

### 5. Whether network size is ever said
*Rule 13 · I invented this line, you did not*

**Does a homeowner ever get told how big the network is, or is that a provider-page fact only?**

I assumed: I allow it only as a small proof line sitting under the button, never as the offer and never on a headline, because counting providers is really counting her work.

Changes: Decides whether coverage numbers appear on the homepage and door pages at all.

### 6. Progress counters on her side
*Rule 14 · I invented this line, you did not*

**Which progress counters can she see — the walkthrough's "3 of 7 answered" but never a "12% complete" profile bar, or none at all?**

I assumed: My line is that counting what she has made is fine and counting what she is missing is not, so the step counter stays and the completeness bar goes.

Changes: Decides whether Home Memory and the walkthrough can show progress anywhere.

### 7. Tight versus distinctive
*Rule 19 · I invented this line, you did not*

**When a line can be tight or distinctive but not both, which one do you take?**

I assumed: I wrote it so the distinctive detail gets paid for out of filler in the same sentence — meaning a line is allowed to become unlike anyone else's, but never allowed to get longer.

Changes: This is the tiebreak between your most-corrected rule and this one, and it fires on nearly every line.

### 8. Whether any praise survives
*Rule 23 · I invented this line, you did not*

**Does a warm opener survive when the count follows it — "You did it. Your model and serial are off the plate, 4 photos are attached" — or do you want the count with no praise at all?**

I assumed: I kept the praise wherever something countable sits right behind it, and cut it only where nothing countable follows.

Changes: Sets the tone of every confirmation screen, toast and finish line in the walkthrough.

### 9. Why ignorance cannot be the pitch
*Rule 24 · I guessed why you said it*

**Is the reason we never build the pitch on her not knowing that it insults her, or that value built on ignorance caps the business at first-timers?**

I assumed: I wrote both, with the insult reason first: she is already braced to be treated as the mark, so she defends herself by rejecting the page.

Changes: If it is the business reason, every page gets written for the capable homeowner rather than merely kept polite for the new one.

### 10. Two neighbours, two names
*Rule 41 · I invented this line, you did not*

**If two of her people vouched for two different plumbers, does she see both names or just the one?**

I assumed: I made it one name and one button, always, because two names is a comparison and a comparison is the research we exist to remove.

Changes: Decides the shape of [[The Trust Network|the Trust Network]] screen, not just its wording.

### 11. Money or the hour, first
*Rule 42 · I guessed why you said it*

**On the provider page, does the money go first or the hour he gets back? Your own line pairs them — "money AND time."**

I assumed: I made the hour lead and the money follow, on the theory that a man already at capacity cannot hear "more" of anything.

Changes: Sets the first line of the recruiting page and every provider email.

### 12. Which names get to be clever
*Rule 43 · I invented this line, you did not*

**Is the plain-name rule for everything she touches mid-problem, or is one of Job Packet, Trust Network or LIVE Walkthrough Tool open to something stronger?**

I assumed: I drew the line at the company and the flagship idea getting an evocative name, with every component she holds at 9pm staying plain and instantly readable.

Changes: Decides whether the product names are frozen or still live for the naming work.

### 13. Hedges inside benefit headlines
*Rule 2 + 25 vs 12 · Two rules disagree*

**A headline that promises money has to be hedged under rule 25 — "Less time diagnosing can mean less on your bill" — but rule 12 says a hedge in a headline means the line lost its content. Do money claims stay out of headlines entirely, or do headlines get to hedge?**

I assumed: Headlines carry what she does or gets ("Hand a tech your notes instead of describing the noise"), and anything about savings or cost moves down into body copy where a hedge does not weaken a scan line.

Changes: Sets what every headline on every door page is allowed to promise.

### 14. Odd example prices vs sourced ranges
*Rule 26 vs 37 · Two rules disagree*

**Rule 37 wants the small oddly-specific figure — "a capacitor for your model is about $19 at the hardware store you already drive past" — and rule 26 says publish only what a source would sign, like "$150 to $400, statewide 2025 survey." Which one carries the money moment on a door page?**

I assumed: The sourced range goes anywhere a skimmer could read the number as a market rate; odd figures like $431 or $19 only appear inside a line clearly framed as an example ("say your quote comes back at...").

Changes: Decides whether door-page money copy reads like a real invoice or like research.

### 15. Saying out loud what we cannot do
*Rule 1 vs 18 and 35 · Two rules disagree*

**"We cannot read your refrigerant level from here" is rule 18's good line, and rule 35 wants a stated limit on all 5 to 10 tool questions — but rule 1 says a negative about ourselves doing trust work is planting. Is an admitted limit a planted negative or a checkable fact?**

I assumed: A limit about what the tool can physically measure is a fact, not a planted negative, so I write it flat ("that one still needs a meter") as many times as the question list needs.

Changes: Decides whether the tool-questions list keeps its limit column or loses it.

### 16. Whether the walkthrough opens anything
*Rule 21 vs 27 · Unclear how far it reaches*

**Rule 21 holds up "Open the panel. Read the number off the sticker" as the right voice mid-walkthrough, and rule 27 says never ask for an opened panel at all. Where is the real line — nothing ever opens, or nothing [[Electrical|electrical]] opens?**

I assumed: Nothing that needs a screwdriver or has power behind it, ever; anything she can read or photograph from outside the box is fair to ask for.

Changes: Decides whether the walkthrough can ever get a model number off an access plate instead of a photo.

### 17. Is the hand-back line furniture
*Rule 5 vs 19 and 33 · Unclear how far it reaches*

**The centred pink line pointing back to the form — "We can walk you through these, in your house, tonight" — has to appear in every section of all 40 pages. Same words every time like the safety line, or written fresh for each section?**

I assumed: Same words every time, treated as trust furniture like the safety line and the Job Packet button, so she learns where the way back lives.

Changes: Decides whether 40 pages share one hand-back line or need a new one written per section.

### 18. Rebuilding pages you already approved
*Rule 44 vs 46 and 47 · Two rules disagree*

**A correction lands in the template today. Rules 46 and 47 say rebuild the pages from there; the approved pages are frozen word for word. Do approved pages get rebuilt and re-approved, or does a new rule only apply to pages not built yet?**

I assumed: Approved pages stay frozen, the new rule applies to everything unbuilt, and I keep a list of approved pages the rule would change so you can release them in one batch when you are testing.

Changes: Decides whether fixes reach live pages the same day or wait for a re-approval pass.

---

*Answered questions get folded into the rule they belong to, and the question is deleted. New ones get added to the bottom as they come up.*

*Companion documents in this folder: `DESIGN.md` (visual system), `PRODUCT.md` (what the pages are for), `_validate-intent-page.js` (mechanical gates), `_textdiff.js` (text-identity gate for approved copy).*

## 52. Put something in front of her only when something is actually blocked today; everything else gets built and filed on the section checklist.

Added 2026-09-11.

**Why.** A list of things needing her attention is only useful if every row on it is true. Pad it with items that merely *involve* her and she has to audit the list before she can work it, which is the same round trip the rulebook exists to remove, plus a quiet tax on trust in every future list. Her words: *"if it doesnt actually need us now then it shouldnt be on the list and you give instructions to write in that sections checklist but keep building to best of the ais ability."*

**How to find more.** For every item you are about to put in front of her, ask what is physically stopping RIGHT NOW if she does not answer this week. Not what it gates on paper, what stalls in practice. Three tests, and an item has to fail all three to earn a place on her list.

1. **Is the thing it blocks being built?** An approval for work nobody has started blocks nothing. Check whether the downstream item is in progress, not whether a dependency arrow exists.
2. **Can the ruling even be applied?** If there is no mechanism to carry her answer into the product yet, her answer has nowhere to go and the mechanism is the real bottleneck. Build that instead.
3. **Is any part of it genuinely hers alone?** Account access, spending, a legal basis, a design she has to look at. Split that part off. It is usually much smaller than the item, and often it is not a decision at all but a three-minute action.

Then write the item as what remains. Most collapse to nothing, a checklist entry, or one small physical act.

**Mechanical check.** Every row on a list handed to her needs a one-line answer to "what stops today without this". If the honest answer is "nothing until X", the row is not a row, it is a trigger to watch.

| | |
|---|---|
| **Good** | Nothing needs you this week. One thing does: the account is yours, it is paid, and it has no spending limit. Three minutes at openrouter.ai, Settings, Limits. |
| **Bad** | T1-32 needs you and Josh: decide which AI capabilities go live and on which model. Unlocks 0 items. |

**Where it does not apply.** Something irreversible in flight outranks this. If a decision is about to be made by default because nobody ruled, that default IS the decision and she should see it before it lands, even if no task is blocked. The same goes for anything already running that she has not seen: the customer-data block being lifted on a branch without her countersign belonged in front of her the day it happened, not when something started waiting on it.


## 53. Put the actual wording or figure she is ruling on in front of her, and cut everything that is not a decision.

Added 2026-09-11, after a brief she could not read.

**Why.** A decision document is not an explanation. She is not deciding whether to believe you, she is deciding between concrete things, and she can only do that if the concrete things are on the page. Describing a gap makes her imagine the sentence that would fill it; drafting the sentence lets her tick it or edit it in ten seconds. Background, history, what changed since last time, what you got wrong before: none of it is a decision, and all of it stands between her and the tick. Her words: *"tight short. sharp no words that arent neccesary. what do you need me to decide with the actual example/wording that the issue/decision applies to? recoomendation if you have it. Quick. and dont waste words on wha tyou gave em before or what was incorrect. JUST decisions."*

**How to find more.** Take the draft and cross out everything that is not one of four things: the decision, the exact words or number it applies to, the recommendation, the box she ticks. Whatever is left after that is the document. Then check each decision individually: is there a concrete artefact here she can accept or amend, or only a description of a problem? A decision with no artefact is not ready and drafting the artefact is your job, not hers. Finally, count. If she has to read more than roughly one screen per decision, it is still too long.

Three specific things that always go: any sentence about a previous version, any paragraph of context she already has, and any option you are not recommending and would argue against. Present the real alternatives, not a survey.

**Mechanical check.** Words divided by decisions. Under 100 words per decision is right. 5,894 words for 8 decisions is the failure this rule was written from.

| | |
|---|---|
| **Good** | **Can we ever sell it outside PRN?** The draft says we will not. **Recommendation: keep the door shut.** Selling a tradesperson's know-how to a third party ends the relationship, and we have not costed it. ☐ Never sell it ☐ Leave it open |
| **Bad** | Three paragraphs on what the corpus says about provider knowledge, a table of four options with reversibility columns, and a closing note on what an earlier draft got wrong. |

**Where it does not apply.** When she asks for the context itself, give her the context. She asked for the long version once and then asked for it cut, which means the long version had a job for exactly one reading. Keep the full research in [[The Vault|the vault]] where Josh and a future session can use it, and hand her the short one. Safety copy is the other exception: there the exact wording IS the decision, so the document is longer because the artefacts are longer, not because the prose is.


## 54. Two reasons only to put something in front of her: you need her hands, or it is a genuinely huge decision. Everything else you do.

Added 2026-09-11. This one governs rules 52 and 53 and outranks them.

**Why.** Her attention is the scarcest thing in the business and every item she reads costs some of it, whether or not she can act on the item. A finding is not a question. A discrepancy in the record is not a question. A defect you found is not a question, it is a fix with your name on it. Presenting those as things needing her makes her do your sorting, and she will stop trusting the list. Her words: *"you do EVERYTHING you can and only ask if you need me to be hands or a GENUINE huge decision."*

**How to find more.** Before anything reaches her, sort it into one of four piles and act on the pile.

1. **Her hands.** Only she can physically do it: an account she owns, a card, a sign-in, a real-world act. Write it as go to X, do Y, tell me when. Never as an explanation of why it matters. If you can do it instead, offer.
2. **A genuinely huge decision.** It changes money, rights, safety policy, what the business is, or something you cannot take back. Give her the actual wording or figure and a recommendation.
3. **Her eye.** A design or a piece of content only she can judge. Say what you need her to look at, not why.
4. **Everything else.** Yours. Do it, log it, put it on the test-time checklist so she sees it when she reaches that section.

Pile 4 is bigger than it looks. Bugs you found, contradictions in the record, a missing control, a spec that never got written, a number nobody set: all pile 4 until proven otherwise. **A defect you can describe precisely is a defect you can fix.** The test on any item: if her answer would be "well, fix it then", it was never hers.

**Where the sort goes wrong.** Two failure modes, both seen. Surfacing a finding as a decision, which is pile 4 dressed as pile 2. And its opposite, deciding something in pile 2 because it was inconvenient to ask, which is how a customer-data setting gets changed on a spoken instruction with nobody's sign-off. Getting the sort right matters more than either individual call.

| | |
|---|---|
| **Good** | openrouter.ai → Settings → Keys. Delete every key except the newest. Tell me when done. |
| **Bad** | The OpenRouter key came through chat on Aug 25, so treat it as exposed. Josh said he would confirm when it was dead. No confirmation exists, 17 days on. |

**Where it does not apply.** Something irreversible about to happen by default still reaches her, even if no task is blocked, because a default nobody chose is still a decision. And when she asks to be told about a class of thing, that instruction outranks the sort until she withdraws it.

