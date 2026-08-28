# Deliverable 2 — Production Design Document

## Scoping and Execution Brief

This document defines what Deliverable 2 must contain, the standard it must meet,
and the order in which to build it. It is written to be executed by a fresh
working session with no prior context, and to be read on its own by anyone who
wants to see the scope reasoned about before the document was written.

It is a brief, not the deliverable. The deliverable is
`design/PRODUCTION-DESIGN.md` — named so that nothing in the repository shares a
name with `demo/Design.md`, which is Deliverable 1's decision ledger and a
different kind of document entirely.

Phase 0 — research, measurement and validation of this brief — was completed on
2026-08-27. Its amendments are marked inline *(amended in Phase 0 — §12, An)* and
collected with their original direction and reasoning in §12.

---

## 1. What already exists

Deliverable 1 (`demo/`) is a working, self-contained demonstration: an
additional budget distributed across a workforce, every employee receiving the
same percentage increase, calculated and displayed in their own currency. No
dependencies, no build step, 114 tests.

**The problem is general; the demo dataset is not.** The requirement is a system
for any organisation, operating in whatever countries it operates in, entering
its budget in whatever currency it plans in. The demo runs on 300 synthetic
employees in the USA, India and Mexico because the brief asked for mock data
across three countries — that set is configuration in the demo (`Design.md`
D-22) and must be **tenant data** in the production design. Nothing in this brief
that names those three countries or currencies should be read as fixing them.

Two files carry forward and must be read before writing anything:

| File | Why it matters |
|---|---|
| `demo/Design.md` | Twenty-seven numbered decisions (D-01 … D-27) with alternatives and trade-offs. Several have direct production consequences and are cited throughout this brief. |
| `demo/src/core/` | The allocation engine: exact integer money, rational arithmetic, largest-remainder apportionment. Pure, DOM-free, invariant-tested. |

### Findings from D1 that shape the production design

These are not background. Each is a demo-scale discovery with a production-scale
counterpart, and the design document is expected to carry them forward
explicitly.

| D1 finding | Production question it raises |
|---|---|
| **D-04** — the allocation ratio is dimensionless, so salaries are never converted per row | This is the seam the entire rules engine hangs off. See §4. |
| **D-05** — allocations can reconcile exactly *within* each currency or exactly *to* the entered budget, never both | Which invariant does the ledger guarantee, and where is the residue recorded rather than lost? |
| **D-03** — decimal exchange rates do not round-trip; exact integer ratios do | Rate sets must be immutable, versioned, and stamped onto every calculation. |
| **D-07** — largest-remainder apportionment with a deterministic tiebreak | Re-running a historical allocation must produce byte-identical output. What must be stored to guarantee that? |
| **D-18** — budgets too small for the rule to apply to everyone are refused, not disclosed | Pre-flight validation is a first-class API response, not an exception path. |
| **D-16** — money compared across currencies must use converted values | Where are derived values permitted, and where are they forbidden? |
| **D-01** — no floating point anywhere in the money path | The same rule applies to the database column types, the API wire format, and every service boundary. |
| **D-22** — the country and currency set is configuration, not an assumption | Countries, currencies, minor-unit exponents and rate sets become tenant data. No platform constant may name a country. |

### The starting-point decision

**Build on Deliverable 1's core engine; replace everything else.**

`src/core/` is pure, has no environment dependencies, and its invariants are
already proven — including by mutation testing. It becomes a versioned internal
library. The UI, the in-memory dataset and the static-file delivery model are
demo scaffolding and do not survive.

The design document must state this explicitly and must **not** reproduce the
demo's architecture at production scale. Justify anything carried over.

---

## 2. What Deliverable 2 is

A production design document describing how the demonstration becomes a
multi-tenant compensation planning platform that a real customer could run
payroll decisions through.

It is a **design document, not an implementation**. Small schema definitions,
interface signatures and configuration examples are welcome where they make a
design concrete; full implementations are not.

### Non-goals

State these in the document so the boundary is visible:

- Not a build. No repository, no running service.
- Not a vendor evaluation. Technology choices are recommendations with reasoning,
  not procurement decisions.
- Not a project plan with dates. Phases are ordered by dependency, not calendar.

---

## 3. The standard it must meet

For every significant component:

```
Problem  →  Options  →  Trade-offs  →  Chosen solution  →  Why  →  Consequences
```

Additional rules, applied without exception:

1. **Every component states why it exists.** A component that cannot be
   justified by a stated requirement does not appear. It should be possible to
   ask "why is this here?" of any box in any diagram and find the answer in the
   text.
2. **Every component states what would remove the need for it.** If a queue is
   present, say what scale or failure mode makes it necessary — and therefore at
   what point it is *not*.
3. **Measure rather than assert.** Where a number can be obtained, obtain it.
   See §9 (Phase 0).
4. **No buzzwords.** "Event-driven", "cloud-native" and "microservices" are not
   arguments. If the design is event-driven, the sentence should explain which
   events, why they must be durable, and what breaks without them.
5. **Name what was rejected.** A section on components deliberately excluded is
   required (§8.16). Recognising when a simple architecture is the correct
   architecture is itself an engineering decision, and it must be visible.
6. **Generic vocabulary.** Standard compensation terminology — merit cycle,
   budget pool, compa-ratio, pay equity, HRIS — is expected. Do not model the
   design on any specific commercial product.
7. **Every flow states how it fails.** *(Added in Phase 0 — §12, A8.)* For each
   important flow — simulation, commit, correction, rate ingestion, employee
   ingestion, export — the document reasons through: dependency unavailable,
   slow, or returning malformed data; request retried, duplicated, or timed out;
   partial failure; concurrent modification; process or worker crash; database
   or rate source unavailable; message delivered twice or late; operation
   succeeded but the response was lost; operation failed after partial work.
   Every resilience mechanism is justified as *failure mode → consequence →
   required guarantee → mechanism → trade-off → condition under which it is
   unnecessary*. A mechanism without that chain does not appear.

---

## 4. The allocation rules system

This is the headline feature of the production design and deserves the most
careful treatment. Deliverable 1 implements exactly one rule; the production
system must let customers define their own.

### The architectural seam

D1's allocation is:

```
share_i  =  weight_i / Σ weight  ×  budget
```

where `weight_i = base(salary_i)` — the employee's salary expressed exactly in
the base currency. Generalising the weight is the whole extension:

```
weight_i  =  base(salary_i)  ×  Π factor_k(employee_i, context)   salary-proportional rules
weight_i  =  g(employee_i, context)                                other rules, e.g. equal share: weight_i = 1
```

*(Amended in Phase 0 — §12, A1.)* Weights are **dimensionless, non-negative,
exact rationals**. Salaries paid in different currencies cannot be summed as
weights, so the base conversion is part of the weight, performed exactly — no
rounding — with the cycle's pinned rate set. Every factor is an exact rational:
a rule that yields a decimal (an inflation figure, a tenure curve) is quantised
to a declared precision and converted at the boundary, so no binary float can
enter through a rule. Verified algebraically in Phase 0: with
`weight_i = base(salary_i)` the per-employee share collapses to `salary_i × p` in
the employee's own currency, exactly D-04, to the minor unit.

The apportionment mathematics — largest remainder, deterministic tiebreak, exact
reconciliation — is **unchanged regardless of how weights are produced**. That
separation is the single most important structural idea in the document:
rule composition is a pure function producing a weight vector, and the money
arithmetic downstream never learns what the rules were.

### The engine contract *(added in Phase 0 — §12, A2)*

Inputs: `(employee id, pay currency, weight_i)` for every eligible employee, the
budget in the planning currency, the cycle's pinned rate set, the currency table
and the algorithm version. Per currency group: the exact pool is
`budget × W_c / W`, converted to local minor units and rounded **once**
(half-up); within the group each employee's exact share `weight_i / W × budget`,
converted, is floored and the shortfall is distributed by largest remainder
with the canonical tiebreak. D1 is the special case `weight_i = base(salary_i)`.
Consequences the document must carry:

- the below-resolution minimum (D-18) has a closed form for any weight vector —
  the budget at which the smallest converted `weight_i / W` share reaches one
  minor unit — so pre-flight validation works for every rule set;
- eligibility is first-class: `weight_i = 0` means excluded, and excluded
  employees do not bind the minimum;
- guardrails that clamp a share (minimum or maximum increase) are integer
  operations that redistribute the difference by the same deterministic,
  bounded procedure; the document states the iteration and why it terminates
  *(superseded in Phase 2: the design solves floors and caps in closed form by a
  λ-search over sorted breakpoints — PRODUCTION-DESIGN §5.5 — so there is no
  iteration to terminate)*.

Design this properly. It must cover:

- **Composition** — rules applied in a defined order; whether factors multiply,
  add, or clamp; how conflicting rules resolve.
- **Versioning** — a rule set is immutable once used in a committed allocation.
  Editing produces a new version.
- **Explainability** — for any employee, the system must be able to answer *why
  did this person receive this amount?* as an ordered list of factors and their
  contributions. This is a hard requirement, not a nice-to-have: allocations
  affect people's pay and will be challenged.
- **Simulation** — customers must be able to run a rule set and inspect the
  outcome before committing anything.
- **Guardrails** — minimum and maximum increase per employee, per country, per
  org unit; caps that override rule output; what happens to the remainder when a
  cap binds.
- **Safety** — customer-authored logic is untrusted input. See §8.9.

### Rules to design for

The system must support at least these, and must make adding another a
configuration change rather than a code change:

| Rule | Notes |
|---|---|
| **Proportional to salary** | The D1 baseline. Same percentage for everyone. |
| **Equal share** | Same absolute amount for everyone. Compresses the pay structure — worth documenting the consequence. |
| **Country economic adjustment** | Inflation, cost-of-living, FX movement. **The direction is a policy choice, not a technical one** — see below. |
| **Tenure / loyalty weighting** | Longer service attracts a higher factor. Define the curve shape (linear, banded, capped) as configuration. |
| **Performance rating** | Weight by rating band. |
| **Pay-equity correction** | Directed uplift toward employees below a target compa-ratio for their band. |
| **Role or band weighting** | Different factors by job family or level. |
| **Manager discretion** | A bounded per-employee adjustment inside a manager's own sub-budget. |
| **Customer-authored** | The extensibility requirement. |

**Confirmed requirement — natural-language authoring** *(added in Phase 4.5 — §12, A15)*.
In the production system, users describe how the budget should be allocated in plain
English — "distributed evenly across all regions", "adjust more for countries with higher
inflations", "grant more to long tenured employees", "no increase for lower performers" — and
combine such statements. The design must turn a statement into a validated, versioned rule set
in the catalogue above, shown back to the user for confirmation before it runs, with every
guarantee of the money and rules sections intact: a language model may propose, never execute,
never see employee data and never supply a number. See the natural-language authoring section
of the design.

The four statements are examples; the capability is general *(§12, A16)*. Any statement of
scope, basis, factor, threshold, bound, priority, budget treatment or exclusion — and any
combination — must be interpreted into the catalogue, asked about where a financially
consequential parameter is unstated, or refused with a reason where it is unsupported, unsafe,
outside the author's authorisation, or an attempt to override a guardrail. Nothing is guessed
and nothing is silently dropped; the design defines a closed intent taxonomy so that "every
case" is a finite claim that can be tested.

### On the inflation rule specifically

There are two defensible and opposite policies, and the platform must not
hard-code either:

- **Preserve real wages** — a higher-inflation country receives a *larger*
  factor, so local purchasing power is maintained.
- **Preserve cost in base currency** — a higher-inflation country receives a
  *smaller* factor, so the employer's base-currency cost stays flat.

Both are real positions taken by real employers. The design document should
present this as a configurable policy with the trade-off stated, and should treat
any rule whose direction is a business judgement the same way. Getting this wrong
by hard-coding it is precisely the class of mistake this platform exists to
avoid.

---

## 5. Money architecture

The deepest technical section, and the one where an error is least recoverable. Do not
hand-wave any of it.

- **Authoritative representation.** Where does the canonical monetary value live?
  The recommendation carried from D-04 is that the employee's **local-currency
  amount is authoritative** and every base-currency figure is *derived* — but
  argue it rather than assert it, and state the consequences for reporting.
- **Storage type.** Exact integer minor units or exact decimal. Never a binary
  float, in any column, any cache, any API payload, any log line. Say how this is
  enforced rather than merely intended.
- **Exchange rates.** Sourcing, ingestion, validation of a suspicious rate,
  immutability, versioning, and the fact that every calculation records the rate
  set it used. Coverage for arbitrary currency pairs — triangulated through a
  base currency, with the precision consequences stated. Currencies with zero
  and three minor-unit digits, not only two. What happens when a rate provider
  is unavailable mid-cycle.
- **Rounding.** The policy, where it is applied, how many times, and why that
  number of times. Phase 0 enumerated the production rounding points the
  document must count *(§12, A4)*: one half-up rounding per currency group per
  run *(the design counts it per currency group **per tranche** per run, because
  each tranche is a complete allocation problem — PRODUCTION-DESIGN §4.5,
  §5.5)*; guardrail clamps, which are integer operations; the
  conversion of a pool delegated down the hierarchy into another currency *(a
  point the design removes: pools are held in the planning currency only, and
  local-currency pools are a stated extension — PRODUCTION-DESIGN §4.5, §4.7)*;
  and the residue itself. Per-employee amounts are never rounded individually.
- **Reconciliation.** Which invariant is guaranteed (D-05), how it is
  verified, and where the residue is recorded. Residue that is not recorded is
  residue that is lost. The residue bound *(the design's term)* is half a
  minor unit per currency group, and per tranche in the design, converted to
  base. It therefore **grows with the number of currencies** a tenant pays in:
  the demo's sub-cent figure is a property of its three currencies (D-25), not
  of the algorithm. The bound is computed and stored with every run, and the
  residue is a ledger entry against a per-cycle rounding-residue account,
  never absorbed into an employee line *(refined in Phase 1: the residue is
  recorded as an exact rational on the immutable run record and is observable
  as the ledger's translation position; it is not posted as a money line,
  because it is smaller than a minor unit by construction and posting it would
  invent one more rounding — PRODUCTION-DESIGN §4.6)*.
- **Country and org subtotals.** Derived by aggregating local amounts, or by
  converting then aggregating? These give different answers. Pick and justify.
- **Reproducibility.** A committed allocation from two years ago must be
  reproducible exactly. Enumerate everything that must be stored to guarantee
  that: inputs, rate-set version, rule-set version, algorithm version, tiebreak
  ordering — and, added in Phase 0 *(§12, A3)*: the identifier of the immutable
  per-cycle **employee snapshot** (a run never reads live tables), the
  currency-table version, the engine build version, and a tiebreak defined on a
  **canonical, collation-independent key**. D1 tiebreaks on a JavaScript string
  comparison of `Employee_ID`; a database `ORDER BY` under a locale collation can
  disagree with it, which would apportion the same inputs differently in
  different components. Together these form the stored run record.
- **Corrections.** Money already committed cannot be edited. Design the
  correction path — reversal plus reissue, or an adjusting entry — and say which.
- **Audit.** Who changed what, when, and what the value was before.

---

## 6. Tech stack

The document must recommend a stack and justify every element. Justification
means: the problem it solves, the alternatives considered, why this one, and
**what would change the decision**.

The recommendations below are a starting position. The implementing session
should validate them against the design as it develops and is expected to
disagree where warranted — a reversed recommendation with a stated reason is a
better outcome than an unexamined one.

| Layer | Recommendation | Reasoning | What would change it |
|---|---|---|---|
| **Allocation engine** | TypeScript, pure, zero-dependency, published as an internal versioned package — refactored into a **pure function of explicit inputs** (rate set, currency table and algorithm version injected; the demo's module-level constants do not carry) *(amended in Phase 0 — §12, A6)* | It already exists, is invariant-tested, and has no environment coupling. Native `BigInt` gives exact integer money without a decimal library. Rewriting proven financial code to change language is risk without reward. Measured in Phase 0 (§9): linear, roughly 400–500k rows per second single-threaded, 500,000 employees in 1.3 s — the engine is not the bottleneck. One refactor is noted, not required: the exact-rational payroll sum is computed twice by the bound checks, 37% of runtime. D1's test vectors become golden files. | Allocation becoming CPU-bound at very large tenants — then extract this one module to a compiled language and keep the same test vectors. |
| **API / services** | TypeScript on Node (Fastify or NestJS) | Shares types and the engine with the frontend and the domain library; a single language for a small team is a real velocity argument. The workload is I/O-bound. | A CPU-bound profile, or an existing team standard in another language. Go or Kotlin would both serve. |
| **Database** | PostgreSQL | Transactional integrity for budget commits; exact `NUMERIC`; row-level security as a multi-tenancy primitive; `JSONB` for rule configuration; native partitioning; mature operational tooling. | Nothing at the scale in scope. Document the point at which it would strain. |
| **Job execution** | Postgres-backed durable queue with a TypeScript client (pg-boss or graphile-worker), consumed by a **dedicated worker service** *(amended in Phase 0 — §12, A5)* | Long-running allocations need durability and retries, not a streaming platform. Reusing the database keeps one fewer system to operate, secure and back up. The separate worker is required by measurement, not by scale (§9): allocation is CPU-bound for 20 ms at 10,000 employees and 1.3 s at 500,000, Node is single-threaded, so a run on the API process stalls every other request; and a run holds 60–275 MB at 100,000–500,000 employees. | Cross-team event streaming, or a genuine throughput ceiling. Then Kafka — with the reason stated. |
| **Cache** | None initially; Redis when a measured need appears | Allocation results are per-cycle and written once. A cache in front of a correctly indexed Postgres, before there is evidence it is needed, is an extra consistency problem. | Measured read amplification on reference data (rates, org hierarchy). |
| **API style** | REST with OpenAPI | Explicit versioning, straightforward idempotency semantics, easy to document and to secure. | A client needing highly variable graph traversal — but weigh the cost of query-shape control on a system holding salary data. |
| **Frontend** | React with TypeScript | Shares domain types with the backend; the largest hiring pool; mature table and form ecosystems. | Nothing in scope. |
| **Identity** | Managed IdP with OIDC/SAML (Auth0, WorkOS, Okta) | Enterprise buyers require SSO and SCIM. Building this is a large, high-risk investment with no product differentiation. | A customer requirement no managed provider satisfies. |
| **Infrastructure** | Containers on a managed runtime (ECS/Fargate, Cloud Run, or equivalent) | Kubernetes is an operations commitment that must be earned. Start managed; move if the workload demands it. | Multi-cloud portability as an explicit requirement, or scheduling needs a managed runtime cannot meet. |
| **IaC** | Terraform | Environments must be reproducible and reviewable. Click-ops is not a security posture. | An existing organisational standard. |
| **CI/CD** | GitHub Actions | Adjacent to the code, adequate for the pipeline described in §8.14. | Enterprise policy requiring self-hosted tooling. |
| **Observability** | OpenTelemetry, backend-agnostic | Instrumenting to an open standard avoids re-instrumenting when the vendor changes. | Nothing. |

Also cover: language-level decisions that affect money correctness (why not a
float type anywhere), and dependency policy for a system that handles salary data.

---

## 7. Product scope

Design for these capabilities. Each needs a place in the architecture, not
necessarily a section of its own.

- **Tenant configuration** — the countries a tenant operates in, the currencies
  it pays in, and the currency it plans in are tenant data, editable without a
  deployment. Adding a country to a tenant must not touch platform code.
  The currency an employee is paid in is an attribute of the employee (or of
  their payroll entity), not of their country — the demo's 1:1 country → currency
  table is demo wiring *(§12, A9)*. Salary amounts carry minor units; pay
  frequency and annualisation are an ingestion mapping and are stated as an
  assumption.
- **Merit cycles** — a named, dated planning cycle with a lifecycle: draft →
  modelling → in review → approved → committed → closed.
- **Budget pools** — allocated to the organisation and delegated down a
  hierarchy, in whichever currency the customer plans in.
- **Modelling and simulation** — run a rule set, inspect the outcome, compare
  scenarios side by side, discard without trace. "Without trace" means the
  scenario's *values* are deletable — simulations are not money and live outside
  the ledger; the audit log keeps the event (who ran or deleted a scenario, when,
  against which rule-set and snapshot versions), never the figures *(§12, A11)*.
- **Natural-language rule authoring** — a policy stated in plain English becomes a validated,
  versioned rule set the user confirms before it runs *(§12, A15)*.
- **Approval workflow** — hierarchical review, delegation, rejection with reason,
  and an immutable record of who approved what.
- **Manager planning** — managers allocate within their own sub-budget under
  guardrails, with visibility scoped to their reporting line.
- **Employee statements** — a per-employee record of the outcome, releasable on a
  schedule.
- **Reporting** — spend against budget by country, org unit and rule; pay-equity
  reporting; cycle-over-cycle comparison.
- **Data ingestion** — employee, salary, tenure, performance and hierarchy data
  from an HRIS.
- **Export** — outcomes back to the HRIS or payroll.

---

## 8. Ground to cover

The document must address every heading below. Where a heading does not apply,
say so and why — an explicit "not needed, because…" is a better answer than
silence.

### 8.1 Requirements and assumptions
Functional and non-functional. State assumptions explicitly and mark which are
load-bearing.

### 8.2 Architecture overview
Component diagram and request lifecycles for the two paths that matter: running a
simulation, and committing an allocation. Show where money crosses a boundary.
Results are persisted and read back paginated: at 500,000 employees the result
rows alone are 79 MB as JSON, 16 MB at 100,000 (§9). An inline response is
acceptable only below a stated size *(§12, A7)*.

### 8.3 Domain and data model
Entities, relationships, cardinality. Where the ledger sits. Soft deletion and
tombstones. Schema evolution and migration strategy (expand/contract).

### 8.4 Money ledger
Per §5. Append-only design, event shape, projections, correction path.

### 8.5 Allocation engine and rules
Per §4. Include the explainability output format.

### 8.6 API design
Resources, versioning strategy, pagination, filtering, error format. Idempotency
keys on every mutating endpoint — a retried "commit allocation" must never
double-apply. Rate limiting. Long-running operations: job submission, status
polling, result retrieval. Job semantics must cover the whole ladder
*(§12, A7)*: accepted → running → a dependency fails → the job retries
idempotently or is dead-lettered → completed — with the client retrying at every
step of it. Results are always persisted; retrieval is paginated (§8.2).

### 8.7 Employee data ingestion
Integration patterns (scheduled pull, webhook, file drop). Schema mapping.
Validation and quarantine of bad records — carry D1's principle that a dataset
which fails validation stops the run rather than silently producing wrong
numbers. Reconciliation against the source. Handling mid-cycle joiners, leavers
and transfers. Ingestion is itself a mutating path and needs the same
idempotency discipline as the API *(§12, A12)*: webhooks deduplicated by event
id, file drops checksummed and applied atomically, source sequence numbers to
order out-of-order updates, and quarantine scoped per tenant so one bad file
cannot stall another tenant's cycle. Joiners, leavers and transfers are handled
through the per-cycle snapshot: a run reads a frozen snapshot, and refreshing it
is an explicit act that invalidates in-flight simulations and never touches a
committed run.

### 8.8 Validation
Layered: schema, business rule, financial pre-flight (D-18 generalised).
What is rejected at the edge versus at the engine, and why.

### 8.9 Security
This is a system holding every employee's salary. Treat it accordingly.

- Authentication: SSO (OIDC/SAML), MFA, session management, SCIM provisioning.
- Authorisation: RBAC plus attribute/row-level rules — a manager sees their
  reporting line and no further. Where the check is enforced, and why it cannot
  be enforced only in the UI.
- **Multi-tenancy isolation**: shared schema with row-level security, versus
  schema-per-tenant, versus database-per-tenant. Options, trade-offs, chosen,
  and the blast radius of a mistake in each.
- **Untrusted rule execution**: customer-authored rules are untrusted input.
  Sandboxing, resource limits, timeouts, and why a general-purpose scripting
  language may be the wrong answer.
- Encryption in transit and at rest; key management and rotation. Field-level
  encryption of salary **amounts** is to be *evaluated, not assumed* *(amended in
  Phase 0 — §12, A10)*: it prevents the database from summing, sorting,
  constraining or indexing the values the system exists to aggregate. The likely
  outcome is at-rest encryption with per-tenant keys, strict authorisation and
  audited reads for amounts, with field-level encryption reserved for
  identifiers and other PII — decided, with the trade-off stated, in the
  security section.
- Secrets management. No credential in an environment variable in a repository.
- Network posture: private subnets, no public database, egress control, WAF,
  managed rules and rate limiting at the edge, bastion or SSM-style access rather
  than open SSH.
- Audit logging, including read access to salary data. Who *looked* matters.
- Supply chain: dependency pinning and scanning, SBOM, provenance.
- Application security: SAST, DAST, secret scanning in CI, penetration testing
  cadence.
- Compliance posture: SOC 2 Type II as the realistic enterprise requirement, and
  what it demands of the design.

### 8.10 Privacy and data residency
Salary and personal data falls under the privacy regime of every jurisdiction a
tenant operates in, and that set differs per tenant. Design a framework for
jurisdiction-specific obligations rather than a fixed list: the demo dataset's
three countries bring India's DPDP Act, Mexico's LFPDPPP and US state privacy
law into view, and a European tenant brings the GDPR; the design must accommodate
the next one without redesign. Cover data residency options, retention and
deletion, subject access requests, PII classification, and redaction in logs and
traces.

### 8.11 Concurrency and consistency
Two managers editing overlapping budgets. A cycle committed while a simulation
runs. Optimistic locking, isolation levels, and which operations require
serialisability. Where eventual consistency is acceptable and where it is not —
a budget total is not eventually consistent.

### 8.12 Reliability
SLOs and error budgets. Failure modes and graceful degradation. Retries with
backoff, circuit breakers, backpressure. Disaster recovery with stated RPO and
RTO, point-in-time recovery, and the fact that an untested restore is not a
backup. Multi-AZ; when multi-region becomes justified.

### 8.13 Observability
Structured logging with PII redaction. Metrics, traces, and correlation across a
long-running allocation. **Business-level alerting**: alert when a reconciliation
residue exceeds its proven bound, when an allocation is refused unexpectedly
often, when rate ingestion produces an outlier. A financial system should page on
a broken invariant, not only on a 500.

### 8.14 Testing
Unit and property-based tests for the engine. Golden-file regression against
historical allocations — an algorithm change that alters a committed result must
fail the build. Contract tests between services. Load and soak testing. Chaos
testing for the failure modes in §8.12. Carry forward D1's mutation-testing
discipline: a suite that passes is not evidence; a suite that fails when the code
is wrong is. Financial invariants as CI gates.

### 8.15 Delivery
Environments and their data. Infrastructure as code. Pipeline stages from commit
to production. Zero-downtime migrations. Feature flags. Progressive rollout and
rollback — including how to roll back a data migration, which is the hard case.

### 8.16 Deliberately excluded
Components considered and rejected, each with the condition that would justify
reconsidering. At minimum address: a streaming platform, microservice
decomposition, event sourcing beyond the money ledger, a separate analytics
store, Kubernetes, a service mesh, and a multi-region active-active deployment.

### 8.17 Scalability
Per §9, Phase 0 — grounded in measurement, not assertion.

### 8.18 Cost
Rough shape of the operating cost at each scale tier, and which decisions
dominate it.

### 8.19 Future extensions
Bonus and equity planning, promotion cycles, headcount planning, benchmarking
data, forecasting.

### 8.20 Natural-language authoring *(added in Phase 4.6 — §12, A16)*
The interpretation layer and its boundary; the intent taxonomy and the structured policy
representation; the deterministic policy compiler (validation, binding of answers and tenant
defaults, provenance of every number); ambiguity handling and which parameters may never take a
default; authorisation binding and guardrail-override refusal; human confirmation of the
platform's own rendering; interpretation provenance and the stability rules (no automatic
reinterpretation); agent failure handling; the evaluation corpus generated from the taxonomy;
and the explicit exclusion of an autonomous agent, of model-computed allocations and of a
conversational interface over salary data.

---

## 9. Execution phases

Work in this order. Report at the end of each phase.

### Phase 0 — Measure before designing
Benchmark the existing D1 engine at 300, 10,000, 100,000 and 500,000 employees:
wall-clock, memory, and where time is spent. Determine empirically where a single
synchronous request stops being viable.

Do this **first**. The scalability architecture must be derived from these
numbers rather than assumed, and the numbers will change what the rest of the
document says. If the engine turns out to be fast enough that asynchronous
execution is unnecessary below a large tenant size, that is a finding and the
design should reflect it.

**Outcome — measured 2026-08-27.** Apple M1, 8 GB, macOS, Node 20.20.2; seeded
synthetic employees through the real `loadEmployees` → `allocate` path; three
currencies; budget ≈ 5% of payroll entered in USD; median of 5 runs (3 at
≥ 100,000); a fresh process per size. A cloud vCPU should be assumed 1.5–2.5×
slower than this machine (an estimate) until measured there.

| Employees | Load + validate | Allocate (median) | Rows/s | Heap after run | RSS | Result rows as JSON |
|---|---|---|---|---|---|---|
| 300 | 0.7 ms | 1.3 ms | 227k | 3.6 MB | 46 MB | ~0.05 MB |
| 10,000 | 7.3 ms | 19.1 ms | 522k | 8.6 MB | 105 MB | 1.6 MB |
| 100,000 | 57 ms | 201 ms | 497k | 58 MB | 173 MB | 16 MB |
| 500,000 | 336 ms | 1,281 ms (1,208–1,398) | 390k | 275 MB | 580 MB | 79 MB |

Where the time goes at 500,000: the exact-rational payroll sum, 236 ms, computed
twice by the two bound checks (≈ 37%); row materialisation ≈ 23%; the remainder
sort ≈ 14%; `scaleFloor`, the money arithmetic itself, ≈ 7%. Linear scaling
with an O(n log n) sort; single-threaded.

What the numbers decide (compute measured; I/O figures are estimates and must be
labelled as such wherever they are used):

- **≤ 10,000 employees** — ≤ 20 ms compute, ≤ 1.6 MB of result rows:
  synchronous, in-request; the result may be returned inline and is still
  persisted.
- **10,000–100,000** — 20–200 ms compute: must run off the API event loop (a
  200 ms run on a single-threaded Node process stalls every other request); a
  synchronous HTTP response remains viable (est. 0.5–2 s including database load
  and persist); results persisted and paginated.
- **> 100,000** — 0.2–1.3 s compute, 60–275 MB heap per run, 16–79 MB of result
  rows, plus est. 2–10 s of database I/O at 500,000: a durable asynchronous job
  with status polling, on a worker sized for the memory, with bounded concurrent
  runs.
- **The engine alone never forces asynchrony below 500,000.** Event-loop
  isolation, memory per run, result volume and database I/O do. Horizontal
  scaling of allocation *compute* is not required at the scale in scope;
  isolation and bounding are. The full write-up belongs in PRODUCTION-DESIGN
  §18 *(§12, A13)*.

### Phase 1 — The money core
Money ledger, exchange-rate versioning, rounding and reconciliation at scale,
reproducibility, correction path. The sections that carry the weight of the
document.

### Phase 2 — The allocation engine and rules
Per §4, including composition, versioning, explainability, simulation and
guardrails.

### Phase 3 — The platform
Data model, API, ingestion, validation, concurrency, workflow.

### Phase 4 — Running it in production
Security, privacy and residency, reliability, observability, testing, delivery.

### Phase 5 — Scale, cost, and what was excluded
Phase 0's measurements written up, cost shape, rejected components.

### Phase 6 — Build roadmap
An ordered implementation plan from the D1 engine to the full platform, with
entry and exit criteria per stage, and what ships to a first customer versus what
follows. Ordered by dependency, not by date.

### Phase 7 — Review
Read the whole document as a sceptical senior engineer. Delete any sentence that
asserts rather than argues. Verify every component states why it exists and what
would remove it. Verify every number is measured or explicitly marked as an
estimate. Check that the production architecture does not merely restate the
demo's.

---

## 10. Working rules

- **Do not ask for approval on routine decisions.** Make the engineering call,
  document the reasoning in the document itself, and continue.
- **Do stop and ask** when a choice materially changes financial semantics,
  security posture, or the scope of the deliverable. When asking: state the
  ambiguity, the options, the trade-offs, a recommendation and the reason.
- **Research where it changes an answer** — money handling, security standards,
  regulatory obligations. Not for choices with an obvious default. Cite sources
  where research changes a decision.
- **Prefer the simpler architecture** and say what would justify the more complex
  one. Complexity must be earned by a requirement.

---

## 11. Open questions to resolve while writing

Answer these in the document rather than leaving them implicit:

1. Is the money ledger append-only for allocations only, or for all monetary
   state? What is the cost of the broader choice?
2. Does a committed allocation write back to the HRIS, or does the HRIS remain
   the system of record with this platform as the planning layer? This changes
   the consistency model substantially.
3. How are rule sets authored — configuration, a constrained expression
   language, or code? Each has a different security and support profile.
4. Where does the base currency come from: the tenant's reporting currency, a
   fixed platform base, or per-cycle? What happens when a tenant changes it, and
   what happens when a tenant adds a country whose currency no configured rate
   set covers?
5. What is the smallest useful product? Which capabilities in §7 ship first, and
   what does the architecture need on day one to avoid a rewrite later?

**Answers recorded at the end of Phase 0 (2026-08-27).** Questions 1, 2, 3 and 5
were confirmed as decisions; question 4 is a recommendation the document must
argue. The document states each with its reasoning *(§12, A14)*.

1. **All committed monetary facts** are append-only ledger entries — pool grants,
   delegations, allocations, corrections and the rounding residue — with balances
   as projections maintained and constrained in the same transaction. Simulations
   are not money and stay outside the ledger. The cost of the broader choice is a
   projection per pool and stricter write discipline; at tens to hundreds of pool
   entries per cycle it is small, and it buys replayable pool history and a
   single correction mechanism for everything.
2. **This platform is the planning layer; the HRIS remains the system of
   record.** Commit is one local ACID transaction. Outcomes reach HRIS or payroll
   through an idempotent, acknowledged export job driven from an outbox; an
   export failure never rolls back a commit, and unacknowledged exports are
   surfaced by reconciliation. Consistency is strict inside the platform and
   eventual — but observable — outside it.
3. **The catalogue is the execution target; natural-language authoring over it ships in
   the first product; a constrained expression language follows; never code.** *(Revised in
   Phase 4.5 — §12, A15.)* A typed, parameterised rule catalogue (schema-validated, exact
   rational factors) is what runs. Users author policy in plain English: a language model
   compiles the statement into a proposal in the catalogue's schema, the platform validates
   it, renders it back deterministically with pre-flight numbers and surfaces every ambiguity
   as a question, and the user confirms; the confirmed structure is what is versioned,
   simulated, approved, committed and reproduced — the model proposes and never executes,
   never sees employee data, and never supplies a number. A non-Turing-complete expression
   language — no loops, no I/O, bounded evaluation cost, exact arithmetic, quantised outputs —
   is the later extension for what the catalogue cannot express, and the assistant may then
   emit it through the same validator. General-purpose scripting is excluded: it is the
   largest attack surface, floats leak in by default, and explainability suffers.
4. **The tenant's planning currency, pinned per cycle** together with the
   rate-set identifier. Changing it affects new cycles only. A cycle cannot be
   created, or its snapshot refreshed, while the active rate set lacks a currency
   any snapshot employee is paid in; the refusal names the missing currencies —
   the D-18 principle applied to configuration.
5. **A single-cycle core**: tenant configuration, rate sets with manual
   activation, HRIS import (file and pull adapter *— the roadmap ships the file
   drop first and pull adapters after the first customer, PRODUCTION-DESIGN §23*),
   per-cycle snapshot, a cycle
   lifecycle with one approver, the rule catalogue (proportional, equal share,
   country factor, tenure bands, performance bands, per-employee caps),
   simulation with explainability, idempotent commit, corrections, export with
   acknowledgement, SSO with RBAC, audit log and invariant alerting. Delegated
   manager planning, approval chains, employee statements, pay-equity reporting,
   the expression language and SCIM follow. All eleven capabilities in §7 are
   designed in full; the answer fixes the order of the roadmap and the day-one
   foundations that avoid a rewrite: tenant isolation, the ledger, immutable
   snapshots, idempotent commit, the job runner, and versioned rule sets, rate
   sets and engine.

---

## 12. Phase 0 outcome and amendments

Phase 0 read the D1 implementation rather than its documentation, studied the
system-design reference material (Xu, *System Design Interview* vols. 1–2;
Vitillo, *Understanding Distributed Systems*), and measured the engine (§9). Two
findings reshape the brief; the rest sharpen it. Each amendment is marked at the
place it applies and recorded here with the original direction, why it was
reconsidered, the evidence, the new direction and the impact on the design.

### The two findings that change the design

**The brief's weight formula was dimensionally wrong.** `weight_i = salary_i ×
Π factor_k` sums salaries paid in different currencies. Weights must be
dimensionless exact rationals with the base conversion inside the weight (A1).

**The engine is not the bottleneck; isolation is.** 500,000 employees allocate
in 1.3 s single-threaded, but a Node API process cannot afford even the 200 ms of
a 100,000-employee run on its event loop, a run holds up to 275 MB, and the
result rows are 79 MB. Asynchrony is justified by isolation, memory and I/O —
not by compute (A5, A7, §9).

### Amendments

| # | Section | Original direction | Why reconsidered · evidence | New direction | Impact |
|---|---|---|---|---|---|
| A1 | §4 | `weight_i = salary_i × Π factor_k` | Salaries in different currencies cannot be summed as weights. Verified algebraically that `w_i = base(salary_i) × Π f_k` with an exact rational `base()` reproduces D1 to the minor unit (`share_i = salary_i × p`, D-04) | Dimensionless, non-negative, exact rational weights; base conversion inside the weight; equal share is `w_i = 1`; factors quantised to rationals at the boundary | Phase 2 engine contract; the no-float rule extends to the rules layer |
| A2 | §4 | Seam described qualitatively | The rules pipeline and the pre-flight gate need an explicit contract | Engine contract stated; D1 is the special case; closed-form minimum budget for any weight vector; eligibility first-class; caps by deterministic bounded redistribution | Phase 2 |
| A3 | §5 | Reproducibility inputs: inputs, rate set, rule set, algorithm, tiebreak | D1 reads the whole live dataset and tiebreaks on a JavaScript string comparison (`demo/src/core/allocate.js:289`); a database collation can disagree | Add the immutable per-cycle employee snapshot, currency-table version, engine build version, and a canonical collation-independent tiebreak key — the complete run record | Phases 1, 3 |
| A4 | §5 | "Where the residue is recorded" | The bound is Σ ½ minor unit per currency in base; it grows with the number of currencies (D-25) | Rounding points enumerated; bound computed and stored per run; residue is a ledger entry against a per-cycle residue account *(refined in Phase 1: an exact rational on the run record, observable as the translation position — PRODUCTION-DESIGN §4.6)* | Phase 1 |
| A5 | §6 | "river, pg-boss, or equivalent" | river is Go-native; the measured reason for a worker is event-loop isolation of 20 ms–1.3 s CPU runs holding 60–275 MB (§9) | TypeScript-native Postgres queue (pg-boss or graphile-worker); dedicated worker service; thresholds from §9 | Phases 3, 5 |
| A6 | §6 | Engine published as an internal package | Module-level constants (`RATES`, `BASE_CURRENCY`, `CURRENCIES`) are demo wiring; payroll is summed twice (37% of runtime) | Pure function of explicit inputs; compute payroll once; D1 vectors as golden files | Phases 2, 6 |
| A7 | §8.2, §8.6 | Job submission, status polling, result retrieval | 79 MB of result rows at 500,000, 16 MB at 100,000 | Results always persisted and paginated; inline only below a stated size; job semantics cover dependency failure, idempotent retry and dead-lettering, with the client retrying at every step | Phase 3 |
| A8 | §3 | Six standards | Failure behaviour must be reasoned per flow, not listed once under reliability | Rule 7: the failure ladder per flow and the justification chain per mechanism | Whole document |
| A9 | §7 | Countries and currencies as tenant data | D1's 1:1 country → currency constant (`currencies.js:23–27`); integer annual salaries only (`employees.js:82–88`) | Pay currency is an employee attribute; minor-unit amounts; pay frequency as an ingestion mapping | Phase 3 |
| A10 | §8.9 | "Field-level encryption for salary" | Encrypting amounts at field level blocks database aggregation, sorting, constraints and indexing of the values the system exists to sum | Evaluate; likely at-rest with per-tenant keys plus authorisation and audited reads for amounts, field-level for identifiers | Phase 4 |
| A11 | §7 | "Discard without trace" beside full audit | Contradiction | Scenario values deletable; the audit event retained | Phases 3, 4 |
| A12 | §8.7 | Reconciliation against the source | Idempotency was specified only for API mutations | Webhook dedupe by event id, file checksums, source sequence ordering, per-tenant quarantine; snapshot refresh as an explicit act | Phase 3 |
| A13 | §9 | Measure first | Done | Measurements and thresholds recorded in §9 | Phase 5 |
| A14 | §11 | Open questions | Resolved | Answers recorded in §11 | Phases 1–3 |
| A15 | §4, §7, §11 | Configuration first, a constrained expression language later | A confirmed requirement: users describe allocation policy in plain English, with combinations; a search of this brief and the design found no such capability | A language model compiles prose into proposals in the catalogue schema; the platform validates (including provenance for every number), renders deterministically and a person confirms; natural-language authoring over the catalogue ships in the first product | New design section; MVP scope; threat model; privacy registers; API; testing (Phase 4.5) |
| A16 | §4, §8.20 | Four example statements | An audit found the design would refuse most statements outside the examples; "every case" needs a finite mechanism | A closed intent taxonomy with one deterministic landing place per class (kind, question or refusal); a named deterministic policy compiler; an ambiguity policy under which financially consequential parameters are always asked; authorisation binding and guardrail-override refusal; stability rules; catalogue kinds for absolute, percentile and relative statements; the corpus generated from the taxonomy | Phase 4.6 amendments to the design; required section 8.20 |
| A17 | §8.20 | The model has no tools at all | "Describe the allocation in plain English" implies the loop a colleague would run — ask, try, explain, adjust — not a one-shot form | The assistant may drive a closed vocabulary of read-only or disposable actions (pre-flight, exploratory simulation, comparison, explanation, a further proposal) under the user's own authorisation, with bounded steps and visible results; publish, approve, commit, correct, export and configuration remain human — agentic where it is reversible, human where it is money | PRODUCTION-DESIGN §6.7; exploratory scenarios on draft versions (§5.7, §5.8) |

### Resolved without a decision — forced by the requirements

- **Snapshot semantics.** Every run reads an immutable per-cycle employee
  snapshot; live tables are never an input to a calculation. Forced by exact
  reproducibility.
- **Tiebreak canonicalisation.** The deterministic ordering is defined on a
  collation-independent key and is part of the algorithm version.
- **Residue destination.** A ledger entry against a per-cycle rounding-residue
  account; never absorbed into an employee line (D-05's reasoning, kept)
  *(refined in Phase 1 to an exact rational on the run record, observable as the
  translation position — PRODUCTION-DESIGN §4.6)*.
- **Zero- and three-digit currencies.** D1 supports them in form and never
  exercised them; the design's test plan must.

### Risk register carried into the design

Recorded so that the Phase 7 review can check that each is closed.

| # | Risk if unaddressed |
|---|---|
| R1 | Runs reading live employee tables instead of immutable snapshots — a historical result cannot be reproduced |
| R2 | A rules engine built on the original weight formula — silently wrong for every mixed-currency rule |
| R3 | Floats entering through rule factors (an inflation percentage, a tenure curve); D1's fitness test guards only `src/core` |
| R4 | Allocation on the API process — every request stalls for 20 ms to 1.3 s |
| R5 | Tiebreak nondeterminism between a database collation and code-unit comparison |
| R6 | Pool over-commit by concurrent managers without a database-enforced balance; the invariant is non-monotonic and cannot be eventual |
| R7 | Commit idempotency by convention rather than by a unique constraint — a retry double-applies |
| R8 | Exporting to the HRIS inside the commit transaction — commit availability coupled to the HRIS |
| R9 | A rate-provider outage blocking commits — avoided only if commits use the cycle's pinned rate set |
| R10 | Inline responses of tens of megabytes |
| R11 | Field-level encryption of salary amounts defeating aggregation and constraints |
| R12 | An expression language before a working rule catalogue |

### What the reference material contributed

The reference was used as a method, not a catalogue; each pattern is recorded in
the design document where it is used, with the condition under which it does not
apply. In summary: exactly-once as at-least-once plus idempotency; the
idempotency key stored atomically with the write; double-entry entries that sum
to zero; event sourcing confined to the ledger; the outbox for the side effects
of a commit; a database constraint with a version column, rather than locks, for
the pool invariant; coordination cannot be avoided for a non-monotonic invariant;
one database transaction rather than two-phase commit; a database-assigned
sequence rather than client time; timeouts, capped backoff with jitter and
circuit breakers only for dependencies outside the platform; a queue as a load
leveller; bulkheads per tenant; a monolith until there is a stated reason to
split; caching as an optimisation rather than an architecture; alerting on
business invariants.
