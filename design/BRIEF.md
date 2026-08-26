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

where `weight_i = salary_i`. Generalising the weight is the whole extension:

```
weight_i  =  salary_i  ×  Π factor_k(employee_i, context)
```

The apportionment mathematics — largest remainder, deterministic tiebreak, exact
reconciliation — is **unchanged regardless of how weights are produced**. That
separation is the single most important structural idea in the document:
rule composition is a pure function producing a weight vector, and the money
arithmetic downstream never learns what the rules were.

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

The deepest technical section, and the one most likely to be probed. Do not
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
  number of times.
- **Reconciliation.** Which invariant is guaranteed (D-05), how it is verified,
  and where the residue is recorded. Residue that is not recorded is residue that
  is lost.
- **Country and org subtotals.** Derived by aggregating local amounts, or by
  converting then aggregating? These give different answers. Pick and justify.
- **Reproducibility.** A committed allocation from two years ago must be
  reproducible exactly. Enumerate everything that must be stored to guarantee
  that: inputs, rate-set version, rule-set version, algorithm version, tiebreak
  ordering.
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
| **Allocation engine** | TypeScript, pure, zero-dependency, published as an internal versioned package | It already exists, is invariant-tested, and has no environment coupling. Native `BigInt` gives exact integer money without a decimal library. Rewriting proven financial code to change language is risk without reward. | Allocation becoming CPU-bound at very large tenants — then extract this one module to a compiled language and keep the same test vectors. |
| **API / services** | TypeScript on Node (Fastify or NestJS) | Shares types and the engine with the frontend and the domain library; a single language for a small team is a real velocity argument. The workload is I/O-bound. | A CPU-bound profile, or an existing team standard in another language. Go or Kotlin would both serve. |
| **Database** | PostgreSQL | Transactional integrity for budget commits; exact `NUMERIC`; row-level security as a multi-tenancy primitive; `JSONB` for rule configuration; native partitioning; mature operational tooling. | Nothing at the scale in scope. Document the point at which it would strain. |
| **Job execution** | Postgres-backed durable queue (river, pg-boss, or equivalent) | Long-running allocations need durability and retries, not a streaming platform. Reusing the database keeps one fewer system to operate, secure and back up. | Cross-team event streaming, or a genuine throughput ceiling. Then Kafka — with the reason stated. |
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
- **Merit cycles** — a named, dated planning cycle with a lifecycle: draft →
  modelling → in review → approved → committed → closed.
- **Budget pools** — allocated to the organisation and delegated down a
  hierarchy, in whichever currency the customer plans in.
- **Modelling and simulation** — run a rule set, inspect the outcome, compare
  scenarios side by side, discard without trace.
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
polling, result retrieval.

### 8.7 Employee data ingestion
Integration patterns (scheduled pull, webhook, file drop). Schema mapping.
Validation and quarantine of bad records — carry D1's principle that a dataset
which fails validation stops the run rather than silently producing wrong
numbers. Reconciliation against the source. Handling mid-cycle joiners, leavers
and transfers.

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
- Encryption in transit and at rest; field-level encryption for salary; key
  management and rotation.
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
