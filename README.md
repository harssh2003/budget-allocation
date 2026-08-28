# Budget Allocation

A budget-management system for an organisation whose employees are spread across
countries and paid in different currencies: an additional budget, entered in
whichever currency the organisation plans in, is distributed so that every
employee receives the same percentage increase, calculated and shown in their own
currency.

The demo runs on a synthetic workforce in the USA, India and Mexico. That is the
sample data the brief asked for, not the scope of the problem — the country and
currency set is configuration, and the production design treats it as tenant
data.

Two deliverables — a working demo and a production design — plus the prompt that
directed them and the brief the work ran under.

| | | |
|---|---|---|
| **Demo** *(Deliverable 1)* | [`demo/`](demo/) | A working, self-contained demo. No dependencies, no build step, 114 tests. Start with its [README](demo/README.md). |
| **Production design** *(Deliverable 2)* | [`design/PRODUCTION-DESIGN.md`](design/PRODUCTION-DESIGN.md) | How the demo becomes a multi-tenant platform: money, rules, plain-English authoring, and what was deliberately not built. Start with the [reader guide](design/README.md) — it names a two-minute and a ten-minute path through it. |
| **Prompt** | [`PROMPT.md`](PROMPT.md) | The master prompt used to direct the AI-assisted build, reproduced verbatim. |
| **Agent brief** | [`CLAUDE.md`](CLAUDE.md) | The standing instructions the build ran under: locked requirements, scope boundaries, and when to stop and ask. |

## Run the demo

```bash
cd demo
npm start          # http://localhost:8000
npm test           # 114 tests
```

Requires Node 20 or newer. Nothing to install, and no build step. The suite runs
in CI on Node 20 and 22.

**Hosted copy:** <https://budget-allocation-demo.vercel.app>

## Where to look

1. **Run it** — enter `2,000,000`, allocate, then filter and sort. Enter `1` to see
   the demo refuse a budget it cannot apply fairly.
2. [`demo/Design.md`](demo/Design.md) — the decision ledger.
   Twenty-seven numbered decisions with the alternatives considered and what each
   one cost. The reasoning lives here rather than in the code comments.
3. [`demo/tests/`](demo/tests/) — the allocation is verified by
   invariants rather than examples, and the suite has been checked by mutation
   testing: eight deliberate defects, each caught.
4. [`design/PRODUCTION-DESIGN.md`](design/PRODUCTION-DESIGN.md) — Deliverable 2.
   How the demo becomes a production platform: exact money end to end, an
   append-only ledger, a rule catalogue authored in plain English, and the
   components deliberately excluded with the condition that would reverse each.
   The [reader guide](design/README.md) is the way in; the scoping brief it was
   held to is [`design/BRIEF.md`](design/BRIEF.md).

The demo's exchange rates are a fixed snapshot, not live rates; see the demo's
README for the values and the date.
