# ROADMAP template

A blank `docs/ROADMAP.md` plus the rules that make one worth reading. Copy
the skeleton below into a new roadmap, or use the entry shapes at the
bottom when adding a line to the existing one.

There are two PowerPoint companions to this file, both CompNinja-branded
and organised as milestones on a week-by-week calendar:

- **`docs/CompNinja-Roadmap-12-Weeks.pptx`** — the same plan filled in for
  the twelve weeks from 2026-08-17: four tracks, twelve milestones, one
  landing each week, one slide per four-week block.
- **`docs/CompNinja-Roadmap-Template.pptx`** — the blank version of that
  deck. Every slot carries a dashed outline and a grey italic prompt; a
  prompt left in place is the tell that the section was never thought about.

The deck is how the plan is read out loud. This file stays the source of
truth — when the two disagree, the file is right.

## The four tracks

Milestones are sorted into four lanes, and the point of the split is that a
quarter cannot be declared a success on code alone. A roadmap with one lane
measures effort; these four measure whether the effort landed.

| Lane | Question it answers | A milestone here looks like |
|---|---|---|
| **DEV** — Development | What must exist? | A capability that now exists and did not before — never a ticket closed. |
| **USE** — Users | Who is actually using it? | People outside the company doing the thing unprompted. Signups are not use; a second visit is. |
| **REL** — Relationships | Who is in the room? | Brokers, partners, advisers, counsel — the answers you cannot write yourself. |
| **PRO** — Profit | What is it worth? | Money from somebody who was free to keep it, and the decisions that let more follow. |

Four rules for the lanes:

- **Only one lane is about building.** DEV is deliberately the small one.
  Everything in the other three is what the building was *for*, and a
  quarter where only DEV lands is a quarter that shipped a great deal and
  proved nothing.
- **Three milestones a lane over twelve weeks** is the working default — one
  landing a week. The lanes are unequal in effort by nature (REL is mostly
  conversations, PRO is often a switch and a wait); effort is not what they
  measure, so do not try to balance it.
- **A dependency between lanes is stated in the week, not hidden.** If a DEV
  milestone must land before a REL one — a licence gate before a broker holds
  a vault — put them in adjacent weeks and say so on the slide.
- **Rename a lane if the business genuinely has a different fourth thing,
  but keep four.** Three collapses back into "build, then hope"; five starts
  double-counting the same milestone in two lanes.

Why a template at all: the CompNinja roadmap earns its keep because its
entries carry the *reasoning*, not just the intent — what is blocked and
on what, what was rejected and why, what evidence would change the
answer. Those are exactly the parts a hurried edit drops, after which the
file decays into a to-do list and the next session re-litigates a
decision that was already made. The prompts below exist to make dropping
them feel wrong.

---

## The skeleton

Everything between the rules is the file. Delete the `<!-- -->` prompts as
you fill them in.

---

# <Product> Roadmap

The one place the product direction lives in the repo.
<!-- One or two sentences: what this file replaced, and what deliberately
     stays OUT of it (a personal notepad, a ticket tracker, a doc in some
     drive). A reader who knows what is NOT here stops looking for it. -->

Update rule: when something ships, move its line to the Shipped log at the
bottom with the date. When priorities change, reorder; this file states
intent, the devlog states history.

## Now

<!-- At most a handful of items, ideally one. "Now" means the next thing
     that gets worked on, not everything that is urgent — a Now section
     with eight entries is a Next section wearing a hat.

     Each entry names: the concrete next action, the cost (code / no code,
     rough time), what is already known, and what specifically would
     resolve it. If the item is a wait rather than a task, say what is
     being waited on and what the re-check consists of, so the next reader
     performs the check instead of re-deriving it.

     If a non-engineering item outranks every engineering item, say so
     here and say why — that ordering is the single most useful thing a
     roadmap can assert, and it is the first thing a new session gets
     wrong. -->

- **`[DEV|USE|REL|PRO]` <Item>** (<code / no code>, ~<effort>). <Current
  state, with the date it was last checked.> **<What is left.>** The
  re-check is: <the specific question to answer>. <Where the full findings
  live.>
<!-- Tag each entry with the lane it moves. An untaggable entry is usually
     two entries, or busywork. -->

## Next

<!-- Committed, ordered, not started. An entry belongs here only if you
     could start it tomorrow — anything needing a decision first goes to
     "Open business questions", anything decided against goes to "Parked".

     The valuable half of a Next entry is its gate: what unblocks it, what
     evidence it should be bought with, and what is deliberately NOT being
     estimated. Write the gate as something observable ("10+ buckets
     holding 8+ provenance-good comps", "the first real broker book"), not
     as a feeling ("when we have more data"). -->

- **<Item>**. <What it is, in one sentence.> <Blocked on what, since when,
  and why that gate is the right one.> <What lands when it is unblocked,
  and what is already in place so it lands as a pure addition.>
- **<Decided but not yet built>** (decided <date>, not yet built). <The
  decision, stated as the thing that will be enforced in code rather than
  remembered as a rule.> <Why it is deferred rather than parked: usually
  "there is no live exposure today, but build it before <the event that
  creates exposure>".> Rejected alternatives, so they are not
  re-litigated: <option A, and the cost that killed it>, and <option B,
  and what it would have weakened>.

## Later (<phase name>, in order)

<!-- Phases or themes, not tasks. One paragraph per phase saying what is
     complete and what remains, so the section shrinks as things ship
     instead of growing. Name anything gated on an outside party (an
     attorney, a partner, a vendor answer) and the fallback if the answer
     is no. -->

<Phase> is complete: <what shipped, with the date>. <What remains, last.>
<Anything gated externally> is gated on <whose answer>; the fallback if
<the bad answer> is <the plan B>.

## Engineering track (no product decisions needed)

<!-- The list anyone may pick up without asking. That is the whole
     criterion: if it needs a yes from the owner, it is not on this list.

     Keep shipped-in-passing notes inline here where they explain the
     pattern to follow ("new candidates earn a module the same way: when
     touched, with tests first") rather than moving every one to the
     Shipped log — the Shipped log is for roadmap-level items. -->

- <Chore, one line, no ceremony.>
- <Refactor with a rule attached.> Shipped <date>: <what moved>. New
  candidates earn one the same way: <the rule>.
- <Measurement to redo before a flag is ever flipped.>

## Open business questions (not code)

<!-- Questions whose answers change what gets built, held by someone other
     than whoever reads this file. Mark which ones gate LAUNCH versus
     which gate development — they are usually different, and conflating
     them stops work that could have continued. Say when a question stopped
     being hypothetical. -->

For <whom>: <the questions>. **<Which of these gates launch, not
development.>** As of <date> it is no longer hypothetical: <what is now
live that makes it real>.

## Parked (decided, not forgotten)

<!-- Things deliberately not being done. The point of the section is that a
     future reader stops proposing them. One line each: what it is, who
     parked it, when, and the condition (if any) that would revive it. -->

- <Item>: <what it is>. Parked <date> by <whom>; <what protects it in the
  meantime, or what would revive it>.

## Principles that bind everything above

<!-- The constraints every entry above is written under — technical
     posture, brand rules, legal positioning, and any claim the product
     may not make yet and the bar that would earn it. Short, absolute, and
     phrased so a violation is recognizable in a diff. -->

<Posture.> <Cost preference.> <UI/brand rule, and what requires an explicit
named yes.> <Legal positioning, stated as the words to use and the words
never to use.> <A claim not to make before a measurable bar is met.>

## Shipped log (roadmap-level items only)

<!-- Newest first. Roadmap-level only — the devlog holds everything else,
     and duplicating it here makes both harder to read.

     A good entry answers "why did we do that?" a year later. It names the
     problem in its own terms, what shipped on both halves if it had two,
     what was verified rather than assumed, and any bounded cost taken
     knowingly. Entries that shipped with visible copy changes say the
     owner said yes. -->

- **<date>: <the change, stated as the outcome>.** <The problem, in the
  terms it was noticed in.> <What shipped.> <What was verified, and how.>
  <Any cost taken knowingly, and why it was acceptable.>

---

## Entry shapes, for adding to an existing roadmap

Four patterns cover nearly every line. Match one rather than inventing a
new voice.

**A wait (Now).** State the last check and its date, what both levers were,
and reduce the next visit to a single question. A wait that does not say
what would end it becomes permanent.

**A gated build (Next).** State the gate as something observable, and say
what is already in place so the work lands as a pure addition rather than a
migration. If it was deferred, say what the deferral costs today — usually
nothing, and saying so is what stops it being re-raised monthly.

**A decision not yet built (Next).** State the rule as code will enforce
it, name the event that creates exposure, and list the rejected
alternatives with the cost that killed each. This is the highest-value
shape in the file: it is the one that stops the same argument recurring.

**A shipped item (Shipped log).** Lead with the outcome, not the
implementation. Name the failure in the terms someone noticed it. Say what
was verified end to end, especially when two halves shipped separately and
neither author had run them together.

## Rules that keep the file honest

- **One file, one direction.** If direction lives in two places they
  disagree within a month, and the reader believes whichever they found
  first.
- **Intent here, history in the devlog.** The Shipped log carries only
  roadmap-level items; every fix and improvement belongs in `devlog.json`
  under the standing rule in `CLAUDE.md`.
- **Move the line when it ships, in the same commit.** A roadmap listing
  work that is already live is worse than no roadmap: it makes the next
  reader distrust every other line.
- **Dates on everything.** "Recently", "soon" and "currently" all age into
  lies. A date does not.
- **Write the reason, not just the item.** An entry that says only what to
  do gets re-argued; one that says why gets executed.
- **Record what was rejected.** The alternatives already considered are the
  most expensive thing in the file to regenerate.
- **Say what is not measurable yet.** "Bought with evidence, not estimated"
  is a real position, and stating it is what stops someone estimating.
