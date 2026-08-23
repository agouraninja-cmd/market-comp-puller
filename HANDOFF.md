# Handoff

CompNinja (compninja.co) is live and has been since 2026. This file used to
be the project handoff, written when the app was a local prototype whose
next step was finding a host. Everything in it went out of date — it named
a retired model, a hard-coded Windows path from another machine, and a
"NOT done" hosting task that was done long ago — so rather than keep a
second, decaying description of the project, it now points at the ones that
are maintained.

**Where to actually look:**

| You want | Read |
|---|---|
| To get a local copy running for the first time | [ONBOARDING.md](ONBOARDING.md) |
| How anything in the product works, and why | [CLAUDE.md](CLAUDE.md) — the project bible, and authoritative |
| What shipped, and when | `devlog.json`, rendered at `/dev` on the site |
| What is planned or pending a decision | `docs/ROADMAP.md` |
| Billing and Stripe setup | [PRO-BILLING-SETUP.md](PRO-BILLING-SETUP.md) |
| A quick description of the app and how to deploy it | [README.md](README.md) |

**The one rule worth repeating here**, because it is the one that costs real
money to learn: `main` deploys to the live site automatically, within
minutes, with no review. Work on a branch and open a pull request.

If a document and the code disagree, the code is right and the document is
a bug — CLAUDE.md included. Fix it in the same commit that made it wrong.
