# Budget Management System — Master Implementation Prompt

> The prompt used to direct the AI-assisted build of both deliverables,
> reproduced verbatim. Headings, lists and code fences have been added for
> readability; no wording has been changed or removed.

---


## 1. Role

You are acting as a senior software engineer, FDE, product-minded technical architect, and QA engineer helping me complete a time-sensitive take-home assignment.  
Your objective is not simply to write code. Your objective is to help me produce a high-quality, customer-facing Deliverable 1 as quickly as possible, while making sound engineering decisions that can later support a strong production-oriented Deliverable 2.  
I have approximately 48 hours from the start of this project to complete the assignment, so execution speed matters significantly.  
The priority order is:
- Correctness
- Meeting the stated requirements
- High-quality engineering decisions
- Customer-facing usability and polish
- Maintainability
- Speed
- Avoiding unnecessary complexity

Do not sacrifice correctness or important engineering quality for speed. At the same time, do not over-engineer the demo merely to demonstrate technical sophistication.  

## 2. Assignment Context

The assignment is to build a demonstration budget-management system for an organisation whose employees work across different countries.  
The initial problem was described as a currency converter, but the actual requirement is better understood as a budget allocation / salary adjustment system involving multiple currencies.  
For the demo, assume the organisation has employees in:
- USA
- India
- Mexico

We will create dummy/mock employee data.  
Each employee must have at least these columns:
- Name
- Employee_ID
- Role
- Country
- Salary

Do not remove, rename, or omit any of these required columns.  
The demo will allow a user to enter an additional budget and distribute that budget proportionally across all employees.  
The first deliverable must be an HTML-based customer-facing demo.  

## 3. Confirmed Business Requirements

The following requirements have been clarified and must be treated as authoritative.  

### 3.1 Salary currencies

Employees are located in different countries and their salaries must be displayed in their local currency:
- USA → USD
- India → INR
- Mexico → MXN

The employee's displayed salary should remain in their local currency.  

### 3.2 Budget input currency

The user may select the currency in which they enter the additional budget.  
Supported currencies:
- USD
- INR
- MXN

The system must internally convert the budget into a common calculation currency before performing the proportional allocation.  
The final updated salary for each employee must be displayed back in that employee's local currency.  

### 3.3 Exchange rates

For Deliverable 1:  
Do not use a live exchange-rate API.  
Use fixed/mock exchange rates.  
The rates should be clearly defined and centralized rather than scattered throughout the code.  
The README should clearly state that these are fixed demo rates and are not intended to represent live market rates.  
Choose sensible deterministic rates and document them.  
If there is a materially important question regarding how the rates should be represented internally, make the most robust engineering choice and document it.  

### 3.4 Meaning of the budget

This has been explicitly clarified.  
The user-entered budget is an additional amount of money to distribute, not the target total payroll.  
Example:
- Existing total payroll = $8M
- Additional budget entered = $2M

The system distributes the additional $2M proportionally across employees.  
The resulting total payroll therefore becomes:
- $8M + $2M = $10M

## 4. Allocation Logic

The additional budget must be distributed according to incremental percentage proportion.  
This means every employee receives the same percentage increase relative to their existing salary.  
For example:  
Employee A:
- Current salary = $150,000

Employee B:
- Current salary = $100,000

If the allocation percentage is 20%:  
Employee A receives:
- $150,000 × 20% = $30,000

Employee B receives:
- $100,000 × 20% = $20,000

Therefore:
- A's new salary = $180,000
- B's new salary = $120,000

The absolute increases differ because the original salaries differ, but the percentage increase is identical.  
This proportional incremental allocation is the only allocation mechanism required for Deliverable 1.  

## 5. Allocation Formula

Treat the calculation carefully as a financial calculation.  
Conceptually:  
Existing Payroll = sum of all employee salaries converted into the common calculation currency  

Additional Budget = user-entered budget converted into the same common calculation currency  

```
Allocation Percentage =
    Additional Budget / Existing Payroll
```

For each employee:  

```
Additional Allocation =
    Employee Salary × Allocation Percentage
```

```
Updated Salary =
    Employee Salary + Additional Allocation
```

The implementation must ensure that the total additional allocation is reconciled against the entered additional budget, subject to the defined currency conversion and rounding policy.  
Do not casually ignore rounding.  
Money calculations must be deterministic and documented.  

## 6. Deliverable 1

Objective  
Build a simple, polished, customer-facing HTML demo.  
The demo should allow a potential customer to understand the core concept immediately.  
The expected flow is:  

```
Mock employee data
        ↓
User selects budget currency
        ↓
User enters additional budget
        ↓
System validates the input
        ↓
Budget is converted into the common calculation currency
        ↓
Additional budget is distributed proportionally
        ↓
Updated salaries are calculated
        ↓
Updated employee table is displayed
        ↓
User can filter employees by country
```

## 7. Deliverable 1 UI Requirements

The interface should contain, at minimum:
- Budget input
- Numeric budget input
- Currency selector
- Clear indication that this is an additional budget
- Appropriate validation/error handling
- Action to perform the allocation
- Employee results table

The table must contain at minimum:
- Name
- Employee_ID
- Role
- Country
- Salary

You may add useful columns if they materially improve the demo, such as:
- Original Salary
- Additional Allocation
- Updated Salary
- Currency

However, do not remove the required columns.  
If adding columns, make the distinction between original and updated salary immediately understandable.  
Country filter  
Provide a country filter that allows the user to view:
- All employees
- USA employees
- India employees
- Mexico employees

The default should show all employees.  
Useful summary information  
Consider displaying appropriate summary information such as:
- Existing total payroll
- Additional budget
- Allocation percentage
- Updated total payroll

Only include summary information if it improves comprehension.  

## 8. Deliverable 1 Scope Boundary

The following are NOT required in Deliverable 1:
- Inflation-based adjustments
- Country-specific weighting
- Loyalty/tenure points
- Customer-defined allocation rules
- Dynamic weighting
- Live exchange-rate APIs
- Production database
- Authentication
- User accounts
- Multi-tenant architecture
- Message queues
- Kubernetes
- Microservices
- Distributed infrastructure

Other production infrastructure that does not contribute meaningfully to the demo  
These concepts will be considered in Deliverable 2.  
Do not introduce unnecessary infrastructure into Deliverable 1 simply because the assignment mentions advanced backend concepts.  
The purpose of Deliverable 1 is to demonstrate the working product concept.  

## 9. Deliverable 1 Architecture Philosophy

The demo must be:
- Fast to run
- Easy to review
- Easy to understand
- Deterministic
- Self-contained
- Maintainable
- Customer-friendly

Mock employee data may be stored locally within the project rather than introducing a backend solely for the sake of having a backend.  
However, do not create one giant unstructured HTML file if a clean separation can be achieved without materially increasing setup complexity.  
Use a sensible lightweight structure such as:  

```
project/
├── index.html
├── ...
├── README.md
├── Design.md
└── CLAUDE.md
```

You may choose the exact structure based on the repository and implementation requirements.  
Do not introduce unnecessary frameworks or dependencies unless they provide a clear benefit.  

## 10. Required Documentation

Create and maintain the following files.  
README.md  
The README is customer/evaluator-facing.  
It should eventually explain:
- What the demo does
- How to run it
- Supported currencies
- How the allocation works
- Fixed exchange-rate assumption
- Example usage
- Important assumptions
- Any limitations relevant to the demo

Keep it clear and professional.  

Design.md  
This is the engineering decision ledger.  
Record material architectural, product, financial, or design decisions.  
For each significant decision, record:
- Decision
- Context
- Alternatives considered
- Trade-offs
- Recommendation / chosen approach
- Reason
- Impact

Do not clutter Design.md with trivial decisions such as variable names or minor CSS choices.  

CLAUDE.md  
Create a project-level CLAUDE.md containing:
- Assignment requirements
- Confirmed decisions
- Current project phase
- Important constraints
- Decision-making rules
- Usage-efficiency rules
- Testing expectations
- Deliverable status

Keep it updated as the project progresses.  
This file should allow a fresh Claude Code session to understand the current state without requiring the entire previous conversation.  

## 11. Decision-Making Rules

This is extremely important.  
Do NOT ask me for approval on every small implementation decision.  
Use the following decision hierarchy.  

### Tier 1 — STOP AND ASK ME

Stop and ask me before proceeding if a decision materially affects:
- Business requirements
- Financial calculation semantics
- Salary/budget correctness
- Exchange-rate semantics
- Required deliverable scope
- Public/user-visible behavior that is ambiguous
- Security
- Data integrity
- Major architecture
- External APIs/services
- A decision that could substantially change the implementation

A decision where two plausible interpretations of the requirement lead to materially different results  
When asking:  
Explain the ambiguity.  
List the meaningful alternatives.  
Give the trade-offs.  
Give your recommended option.  
Explain why you recommend it.  
Ask me for a decision.  
Do not merely say "I need clarification."  

### Tier 2 — DECIDE, DOCUMENT, CONTINUE

For normal engineering decisions that do not materially change the requirements or architecture:  
Make the best engineering decision yourself.  
Prefer simple, maintainable and conventional solutions.  
Document the decision in Design.md if it is materially relevant.  
Continue working.  
Examples:
- Folder organization
- Function naming
- Variable naming
- Test naming
- CSS organization
- Small helper abstractions
- Minor implementation details
- Standard configuration choices

Do not interrupt me for these.  

### Tier 3 — EXECUTE WITHOUT INTERRUPTION

For routine tasks:
- Formatting
- Straightforward refactoring
- Lint fixes
- Obvious bug fixes
- Writing basic tests
- Documentation cleanup
- Repetitive implementation
- Fixing syntax/type errors
- Running established commands

Just execute them.  

## 12. Research Rules

Research can consume significant time and model usage.  
Do NOT research every implementation choice.  
Use external research only when it can materially improve a decision involving:
- Financial calculations
- Currency/money handling
- Security
- Framework/library capabilities
- Relevant system design patterns
- Important scalability/reliability concerns
- External APIs
- Standards
- Significant architectural decisions

Prefer:
- Official documentation
- Primary technical sources
- Highly credible engineering sources

Do not spend significant time researching trivial implementation decisions.  
When research materially influences a decision, record the relevant source and conclusion in Design.md.  

## 13. Usage-Efficiency Rules

I am working under a limited AI usage allowance and have approximately 48 hours to complete this assignment.  
Optimize for high-quality output per unit of model usage.  
Do not waste premium reasoning capacity on trivial tasks.  
Use deep reasoning for:
- Requirements interpretation
- Architecture
- Financial calculation correctness
- Critical edge cases
- Security
- Major design decisions
- Difficult debugging
- Final review

Use efficient execution for:
- Straightforward coding
- UI implementation
- Basic tests
- Documentation
- Refactoring
- Formatting
- Simple bug fixes

Do not repeatedly re-explain the entire assignment to yourself.  
Use:
- CLAUDE.md
- Design.md
- README.md
- Existing repository state
- Git history where useful

to preserve context.  
If a task is complete, do not continue exploring alternatives merely for the sake of exploration.  

## 14. Phase-Based Execution Plan

The project must be executed in the following phases.  

### PHASE 0 — Repository and Environment Inspection

Before changing code:  
Inspect the entire existing repository.  
Identify:
- Existing files
- Existing framework/tooling
- Existing package configuration
- Existing tests
- Existing scripts
- Existing documentation

Determine whether the repository is empty, partially implemented, or already structured.  
Do not modify anything yet unless necessary to establish project instructions.  
Create/update CLAUDE.md with the assignment context and workflow.  
At the end of this phase, provide me with a concise summary.  
Do not spend excessive time here.  

### PHASE 1 — Requirements Lock + Critical Decisions

Create a concise requirements specification based on the confirmed requirements above.  
Explicitly distinguish:
- Confirmed requirements

from:
- Implementation decisions

from:
- Future Deliverable 2 requirements

Do not ask me about requirements already confirmed above.  
Identify only genuine remaining ambiguities.  
If there are no material ambiguities, proceed immediately.  
Do not block the project unnecessarily.  

### PHASE 2 — Deliverable 1 Architecture

Design the smallest clean architecture capable of producing a high-quality demo.  
Before implementation, determine:
- Data representation
- Currency representation
- Exchange-rate representation
- Calculation model
- Rounding strategy
- Allocation reconciliation
- UI structure
- Filtering approach
- Validation
- Error handling
- Testing strategy

Do not introduce backend infrastructure unless it provides a real benefit for Deliverable 1.  
Document material decisions in Design.md.  
Then proceed directly to implementation.  

### PHASE 3 — Build Deliverable 1 MVP

Implement the complete core flow:  

```
Load employee data
        ↓
Select budget currency
        ↓
Enter additional budget
        ↓
Validate input
        ↓
Convert budget
        ↓
Calculate proportional allocation
        ↓
Apply allocation
        ↓
Display updated salaries
        ↓
Filter by country
```

The objective is to get a fully working end-to-end demo as early as possible.  
Do not spend excessive time on visual polish before the core functionality works.  
At the end of this phase, the application must be runnable and demonstrate the core business logic.  

### PHASE 4 — Financial Correctness + Testing

This phase is high priority.  
Test the allocation logic thoroughly.  
At minimum test:
- Base cases
- Normal budget
- Each supported budget currency
- All countries
- Multiple salary levels
- Boundary cases
- Zero additional budget
- Very small additional budget
- Very large additional budget
- Decimal budget
- Decimal salary values where applicable
- Invalid cases
- Negative budget
- Empty budget
- Non-numeric input
- Invalid currency
- Missing employee salary
- Invalid exchange rate
- Mathematical correctness

Verify that:  
Every employee receives the same percentage increase.  
Higher-paid employees receive a proportionally larger absolute increase.  
Lower-paid employees receive a proportionally smaller absolute increase.  
The total additional allocation reconciles to the intended additional budget within the defined rounding policy.  
Currency conversion does not introduce unexplained discrepancies.  
Results remain deterministic.  
UI correctness  
Verify:
- Country filtering
- Currency selection
- Budget input
- Updated salary display
- Error states
- Empty states where applicable

Fix all important issues discovered.  

### PHASE 5 — Customer-Facing UX and Polish

Only after the core functionality and financial correctness are stable:  
Improve:
- Visual hierarchy
- Readability
- Table usability
- Currency formatting
- Input clarity
- Error messages
- Responsive behavior
- Empty states
- Loading/interaction feedback where appropriate
- Overall customer-facing presentation

The demo should feel like something that could reasonably be shown to a potential customer.  
Do not add unnecessary features.  

### PHASE 6 — Deliverable 1 Final Review

Before considering Deliverable 1 complete:  
Perform a final evaluator-style review.  
Pretend you are a senior engineer evaluating this take-home.  
Check:
- Requirements
- Did we satisfy every confirmed requirement?
- Did we accidentally omit a required employee column?

Did we incorrectly interpret the budget as a target instead of additional money?  
Financial logic  
Is proportional incremental allocation correct?  
Are currencies handled correctly?  
Is rounding deterministic?  
Is reconciliation handled appropriately?  
Code quality  
Is the code understandable?  
Are responsibilities reasonably separated?  
Are there unnecessary dependencies?  
Is there duplicated logic?  
Are there obvious bugs?  
UX  
Can someone understand the demo immediately?  
Is the budget clearly described as additional?  
Is the country filter obvious?  
Are salary currencies clear?  
Documentation  
Can a reviewer run it quickly?  
Does README accurately describe the application?  
Does Design.md explain the important decisions?  
Submission  
Ensure:
- No unnecessary files
- No secrets
- No debug output
- No broken links
- No unused dependencies where avoidable
- No obvious console errors
- Clean repository structure
- Clear README

Deliverable 1 is now considered complete.  
Do not begin Deliverable 2 before this gate is satisfied.  

## 15. DELIVERABLE 1 CHECKPOINT

At this point, stop and report:  

```
DELIVERABLE 1 STATUS

Working:
- ...

Tested:
- ...

Remaining:
- ...

Known assumptions:
- ...

Important decisions:
- ...

Potential evaluator concerns:
- ...

Submission readiness:
- ...
```

If everything is complete, explicitly state:
- DELIVERABLE 1 COMPLETE

Only then should we proceed to Deliverable 2.  

## 16. DELIVERABLE 2 — DO NOT START UNTIL D1 IS COMPLETE

Deliverable 2 is the detailed production-oriented Design Document.  
It should build upon what we learned while implementing Deliverable 1.  
The design document should explain how this demo could evolve into a production-grade budget management platform.  
It should cover:
- Requirements
- Assumptions
- Architecture
- Components
- APIs
- Data model
- Authoritative money ledger
- Cross-currency calculations
- Currency conversion
- Rounding and reconciliation
- Employee data
- Budget allocation engine
- Extensible allocation rules
- Country-specific factors
- Inflation
- Loyalty/tenure weighting
- Customer-configurable rules
- Validation
- Security
- Authentication/authorization
- Multi-tenancy if appropriate
- Scalability
- Reliability
- Observability
- Error handling
- Idempotency
- Concurrency
- Auditability
- Testing
- Deployment
- CI/CD
- Monitoring
- Disaster recovery
- Future extensions

The production architecture must NOT simply reproduce the static demo architecture.  
Instead, explain how the demo would evolve into a real system.  

## 17. Advanced Allocation Rules — Deliverable 2 Only

The following examples belong to the production design:
- Country/economic adjustments

For example:
- Inflation
- Cost-of-living differences
- Country-specific weighting
- Tenure/loyalty

Longer-serving employees could receive a weighting factor.  
Customer-defined rules  
Customers may eventually define how additional budgets should be allocated.  
These should be designed as an extensible allocation/rules system, rather than hard-coded into the demo.  
Do not implement these in Deliverable 1.  

## 18. Production Financial Architecture

Deliverable 2 must pay particular attention to money correctness.  
Address:
- Authoritative money representation
- Currency-specific amounts
- Base/common calculation currency
- Exchange-rate source
- Exchange-rate versioning
- Precision
- Rounding
- Reconciliation
- Cross-currency totals
- Auditability
- Historical calculations
- Reproducibility

Do not hand-wave financial calculations.  
Explain where the authoritative monetary values live and how country-level subtotals are derived.  

## 19. Scalability

Consider that a real customer may have significantly more employees than the 100-person demo.  
Analyze:
- 100 employees
- Thousands of employees
- Hundreds of thousands of employees
- Large numbers of simultaneous budget allocation events

Explain when and why different architectural approaches become appropriate.  
Do not add infrastructure simply because it sounds advanced.  
Every production component should have a reason to exist.  

## 20. Final Design Document Quality Standard

The Design Document should demonstrate:
- Strong engineering judgment
- Clear trade-offs
- Practical system design
- Financial correctness
- Scalability
- Extensibility
- Reliability
- Security
- Operational awareness

It should read like a genuine engineering design document rather than a list of buzzwords.  
For every significant architectural component, explain:  

```
Problem
↓
Options
↓
Trade-offs
↓
Chosen solution
↓
Why
↓
Consequences
```

## 21. Time Management Rules

Because the total available time is approximately 48 hours:
- Priority 1

Get Deliverable 1 working.  
Priority 2  
Make Deliverable 1 correct.  
Priority 3  
Make Deliverable 1 polished.  
Priority 4  
Complete Deliverable 2.  
Priority 5  
Add optional improvements only if the above are already complete.  
Never sacrifice a complete Deliverable 1 for an interesting Deliverable 2 idea.  
If time becomes constrained:  
Reduce optional features.  
Reduce cosmetic improvements.  
Reduce research breadth.  
Simplify non-essential architecture.  
Never compromise core financial correctness.  

## 22. Communication Protocol With Me

When working autonomously, do not interrupt me unnecessarily.  
When you encounter a Tier 1 decision, respond with:  

```
DECISION REQUIRED

Question:
...

Why it matters:
...

Option A:
...

Option B:
...

Recommended:
...

Reason:
...

Impact on current implementation:
...
```

Then wait.  
For Tier 2 decisions, make the decision yourself and document it.  
For routine implementation, continue without asking.  

## 23. Progress Reporting

At the end of each major phase, give me a concise status update.  
Use:  

```
PHASE:
STATUS:

Completed:
- ...

Important decisions:
- ...

Tests:
- ...

Issues:
- ...

Next:
- ...
```

Do not provide unnecessary narration of every command or file edit.  

## 24. Important Anti-Overengineering Rule

This assignment is evaluating engineering judgment.  
Do not assume that "advanced backend concepts" means that Deliverable 1 needs a backend, database, microservices, queues, containers, or cloud infrastructure.  
A strong engineer should recognize when a simple architecture is the correct architecture.  
Deliverable 1 should therefore remain lightweight while maintaining clean boundaries that allow Deliverable 2 to describe a production-grade evolution.  
Complexity must be justified by a requirement, not added for appearance.  

## 25. Final Operating Principle

Operate according to this rule throughout the project:  
Move fast, but never move fast through a critical ambiguity.  
For important decisions:  
Stop → analyze → recommend → ask.  
For routine engineering:  
Decide → document when material → execute → test → continue.  
For Deliverable 1:  
Working product first.  
For Deliverable 2:  
Production architecture second.  
Do not confuse the two.  
Begin now with PHASE 0 — Repository and Environment Inspection.  
Do not start implementing features until you have inspected the repository and established the project context, but do not spend unnecessary time exploring. The objective is to get to a working Deliverable 1 as quickly as possible.
