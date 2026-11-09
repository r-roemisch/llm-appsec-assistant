# Critique log

An outside critique of Rampart and what was done about each point (the "ChatGPT critique" soft
requirement). The prompt is in `docs/critique_prompt.md`.

- **Date:** 2026-11-09, after M6 was built.
- **Reviewer:** `openai/gpt-6.1-sol` (an OpenAI GPT Model) through OpenRouter. Rampart reaches hosted
  Models only through OpenRouter (ADR 0002), so the critique did not go through the ChatGPT app.
- **Input:** `README.md`, `docs/DESIGN.md`, `docs/SPEC.md`, `docs/traceability.md` and the three
  ADRs; 21648 tokens in, 3426 out, $0.0884.
- **Limit of the review:** the reviewer saw documents only, not code, tests or reports (it says
  so itself), so several points describe controls that already existed. The responses below
  were checked against the code, and every claimed fix has a test.

## Responses

| # | Point (severity) | Verdict | What was done |
|---|---|---|---|
| 1 | Claims exceed the evidence (high) | Agreed, fixed | The README now calls Rampart a local review-support and learning tool, not an assessment, and has a "Scope and limits" section stating what each Tool covers and does not. Every generated Report now carries a scope note: a missing finding does not mean the application is secure. Not done: a task-based study with real developers and reviewers. |
| 2 | Loopback is not ownership; networking details (high) | Partly in place, hardened, limit documented | Already: registration accepts only loopback literals and `localhost`, never resolving names, so DNS rebinding and mixed results do not apply; the Gateway checks again per call. New: the harness ignores proxy environment variables and never follows redirects (`tests/test_injection.py::test_the_harness_never_follows_a_redirect_or_an_environment_proxy`), and a Target URL may carry nothing but a port: paths, queries, fragments and credentials are refused (the confusing `user@host@127.0.0.1` form that used to pass is now refused, `tests/test_gateway.py::test_loopback_urls`). Documented: on a shared host loopback is the server's machine, so ownership is not proven; switch `run_injection_test` to administrator approval there. Not done: an ownership challenge. |
| 3 | Plugin review is not isolation (high) | Agreed; already documented, now prominent | The admin guide and the M5 report already said Plugins run as Rampart's OS user and are not sandboxed; the README's "Scope and limits" now says Plugins are trusted local programs. The "datasets unreadable at runtime" claim is scoped to Tool, Source, upload and prompt paths (`eval/README.md`). Not done: an OS-level sandbox. |
| 4 | Approval binding needs more than an argument digest (high) | Mostly in place; test added | The Approval is bound to the tool call, the Conversation, the assistant message and the argument digest; only the Conversation's owner can resume it; on resume the Gateway runs every check again (registry, enabled, Plugin drift, role, schema, rate, budget, Target ownership) before consuming it; consumption happens before execution in one transaction (at most once); turns of a Conversation never overlap. New test: a Tool disabled between the request and the approval is denied on resume (`tests/test_approvals.py::test_an_approved_call_is_checked_again_when_the_turn_resumes`). |
| 5 | Secrets across the whole lifecycle (high) | Partly in place; real gaps fixed | Already: pasted secrets are removed before storage and before any Model sees them (so checkpoints hold the redacted text); Tool output is redacted before the Model and the audit log; model output is redacted while streaming and before it is stored; stored Tool arguments and Feedback comments are redacted. **Gaps the critique found:** uploaded documents and the Project Profile were not redacted, and Langfuse received raw model output from the LangChain callback. Fixed: uploads are redacted before indexing (so before any prompt or embedding call), the Profile on save, and every value exported to Langfuse passes the SDK's mask hook with the same redaction (`tests/test_data_protection.py`). The detector's limit (credential-shaped strings only) is stated in the README. Not done: a written data-flow inventory and a retention policy for traces. |
| 6 | Isolation evidence narrower than "all user data" (high) | In place; evidence consolidated | A single cross-user test now covers 14 routes across Conversations, Approvals, Feedback, Reports, Targets and uploads (all 404, lists empty, owner's data intact: `tests/test_isolation.py::test_every_user_object_is_private_to_its_owner`). Ownership always comes from the session, never from Model arguments (`generate_report` and `run_injection_test` carry Gateway ownership constraints). Deleting a Conversation deletes its messages, Feedback and LangGraph checkpoint; traces are developer-facing records and are kept. |
| 7 | The input Guard conflicts with the core workflow (high) | Partly disagree | The analysis path exists: quoted or asked-about attack text passes (the benign set includes such cases, 0 false positives), the blocked-input reply tells the user to put a suspicious prompt in a code block, and `analyze_prompt` takes hostile prompts as data. Agreed that the Guard is advisory: the docs call it defence in depth and the Gateway the enforcement point. Summaries enter the prompt as a delimited note, never as instructions. |
| 8 | "Every Tool call passes the Gateway" leaves paths ambiguous (high) | Agreed, clarified | The admin guide now says the per-turn retrieval step is part of answering, not a Tool, applies the same access rules, and is not switched off with `search_knowledge`. Allowed Tools cannot reach other users' resources: ownership constraints are Gateway checks (A08 shows an injected request for an unregistered Target being denied through an enabled Tool). |
| 9 | The harness demonstrates its fixtures, not general resistance (high) | Agreed, wording fixed | The README calls it a regression check whose deterministic demo Target demonstrates the harness and its two profiles. The ambiguous denominator is now explicit: all 11 uncontaminated injection candidates breached (12 in total, 1 contaminated), 0 of 12 on the secure profile, no benign candidate acted on. Not done: run-specific random markers. |
| 10 | Datasets too small and not independent (medium) | Agreed, documented | `eval/README.md` is a dataset card: sizes, topics, who wrote each set, the holdout policy, and what a single case moves. Not done: independent or real-user cases. |
| 11 | The judge is not calibrated (medium) | Agreed, documented | Each report records the resolved chat, grader and judge Models and the threshold; the admin guide and README say the judge is not calibrated against human ratings and may favour its own vendor. Not done: a human-rated sample, an adversarial test of the judge, argument-level tool checks. |
| 12 | Passing tests stand in for outcome reporting (medium) | Agreed | The M6 report has a results table with the thresholds fixed before the run, exact counts, failures and what was not run (the full 30-case QA run waits for a cost decision). |
| 13 | Budgets, retries, paused turns (medium) | Mostly in place, documented | Budgets are per Conversation and checked before every Model and Tool call; a Conversation never runs two turns at once, so a budget cannot race; Approvals execute at most once; evaluation runs on a snapshot of the database and the vector store, with its traces inside the snapshot and a throwaway user, deleted afterwards. |
| 14 | No browser end-to-end tests (medium) | Partly disagree | A recorded scope decision (DESIGN Q31, SPEC non-goals). Each milestone was nevertheless driven in a real browser against the real backend and real Models (m2 to m6 reports), and the frontend never renders raw HTML (no `dangerouslySetInnerHTML`; Plugin text is plain text). Not done: committing a browser suite. |
| 15 | Conflicting documentation (medium) | Agreed, fixed | `docs/DESIGN.md` is marked a historical record; the spec's contradiction about the judge Slot, the "hard rubric met after M3" claim and the Plugin naming in A20 are corrected. Help mode searches only the user and admin guides, which are current. |

## Follow-up in M7 (2026-11-09)

Items the responses above left "not done", and what M7 changed (`docs/reports/m7.md`):

| # | Was not done | Now |
|---|---|---|
| 1 | Dependency discovery | Partly done: a Dependency File (six formats, PyPI and npm) fills the Project Profile, and `check_dependencies` checks it in one OSV.dev batch. Reachability is still not judged; a task-based study with real users is still not done. |
| 5 | A data-flow inventory and a trace retention policy | Done: `docs/data_flows.md`; `rampart traces prune` and `RAMPART_TRACE_RETENTION_DAYS`. Writing it found a real gap, now fixed: deleting an account left its conversations' checkpoints behind. |
| 9 | Run-specific random markers | Done: a random Sentinel per run, checked by the harness in the sink text itself; a Target that ignores it is reported as weaker evidence. |
| 10 | Independent cases | Not done. A fresh Guard Holdout Set was written before the rules were tuned, but by the same author. |
| 11 | Argument-level tool checks | Done: argument correctness, Gateway decision correctness and unnecessary calls. A human-rated judge sample is still not done. |
| 12 | The full QA run | Done: all 30 cases twice, against a target fixed beforehand (24 of 30 passing every metric): 23, then 26 after a retrieval fix. |
| 7 | The Guard as a classifier | Measured on a fresh Holdout Set: the rules catch 2 of 15 attacks, the model classifier 14 of 15, neither blocks a benign input. This supports the critique: the rules are advisory. |

## The critique, verbatim

This is a document-level review: source code, datasets, milestone reports and actual evaluation outputs were not supplied. Test names in `docs/traceability.md` show intended coverage, not independently verified behavior. Where the documents leave a control unspecified, I identify an assurance gap—not a confirmed exploitable implementation bug.

## 1. The “secure reference implementation” claim exceeds the evidence
**Severity: high**

**What is wrong:** README and SPEC §1 describe Rampart as “the secure agent it recommends” and a working reference implementation. The supplied evidence mainly establishes feature presence and scripted acceptance scenarios—not resistance to realistic attacks or usefulness to the named developers and AppSec reviewers. `analyze_prompt` is a deterministic lint tool; OSV lookup is not dependency discovery or reachability analysis; citations do not establish that advice is correct. These capabilities can help learners without constituting an application-security assessment.

**Why it matters:** Developers may interpret a clean report or passing injection suite as assurance that their application is secure. AppSec reviewers need scope, limitations and evidence provenance, not just findings assembled into Markdown.

**Concrete fix:** Describe Rampart as a **local educational and review-support prototype**, with individually tested controls. State each tool’s coverage and exclusions. Make reports distinguish observed evidence, heuristic findings and untested assumptions, and never imply that “no finding” means secure. Add task-based evaluation with representative developers/reviewers before claiming practical review effectiveness. Choosing an educational scope is a judgement call; presenting it as stronger assurance is not.

## 2. Loopback restriction does not establish target ownership or safe networking
**Severity: high**

**What is wrong:** SPEC §§8 and 11 equate registered loopback targets with applications owned by the caller. A user registering a URL does not prove ownership of the local service. Registration-time and Gateway-time DNS checks also leave the connection itself unspecified: address pinning, mixed DNS results, redirects, proxy environment variables and URL normalization are not addressed.

**Why it matters:** On a shared Rampart host, every user reaches the server’s loopback network—not necessarily their own machine. The harness could contact another user’s service or a privileged local API. Rechecking DNS before a request does not eliminate resolution-to-connection races.

**Concrete fix:** Require an ownership challenge or an administrator-provisioned target capability. Validate all resolved addresses and connect to the validated address while preserving the intended host identity; disable redirects and environment proxies. Restrict ports and endpoint paths to the harness protocol. Test rebinding, redirects, mixed address families and cross-user target registration. Correct the ownership claim in P6-R11.

## 3. Plugin review and definition drift detection are not process isolation
**Severity: high**

**What is wrong:** README’s Plugin section emphasizes minimal environment variables and accepted tool-definition digests. Neither confines the executable. A stdio child normally inherits the Rampart OS user’s filesystem and network privileges. It may read `.env`, SQLite databases, traces or files under `HOME`; it may change behavior without changing its advertised schema. Listing tools again also does not bind subsequent execution to the reviewed implementation.

**Why it matters:** A malicious or compromised catalogued Plugin can bypass the Gateway through its own process privileges. The “datasets unreadable at runtime” claim is also too strong if a Plugin can read the repository.

**Concrete fix:** Explicitly treat Plugins as trusted native code unless sandboxed. For an untrusted-Plugin claim, use a separate OS identity and restricted filesystem, network and resource access, with no access to Rampart data or credentials. Pin executable/dependency versions and test attempted filesystem and network escape. Catalog-only registration is a reasonable capstone scope choice; calling it confinement would be incorrect.

## 4. Approval binding needs more than an argument digest
**Severity: high**

**What is wrong:** P6-R05, P6-A12 and ADR 0003 cover changed arguments, expiry and single use. They do not establish binding to the authenticated caller, conversation, tool implementation/version, accepted Plugin definition, resolved target identity or relevant policy version. Concurrent approval consumption and policy changes while a turn is paused are unspecified.

**Why it matters:** Identical JSON arguments can authorize a materially different action after a target, Plugin or policy changes. A non-atomic check-and-consume can execute an approved action twice. Requester approval also cannot authorize access the requester does not own.

**Concrete fix:** Bind approvals to a canonical action envelope containing caller, conversation, tool identity/version, arguments and relevant resource/configuration versions. Revalidate authorization, drift, target ownership and budget on resume. Atomically consume the approval and create an execution record. Add race and restart tests. Show an escaped, server-generated action summary in the approval card. Requester approval is a judgement call for owned local targets, not a substitute for authorization.

## 5. Secret protection is specified for displayed text, not the complete data lifecycle
**Severity: high**

**What is wrong:** G4 and P6-A14 focus on redaction before display and persistence of **displayed text**. The guarantees for raw checkpoints, callback payloads, traces, exceptions, tool arguments, uploads, Project Profiles and summaries are not established. “Secrets are removed … before any model call” is broader than a pattern detector can guarantee.

**Why it matters:** A redacted chat bubble can coexist with an unredacted credential in Langfuse, a checkpoint or a provider request. Secret-pattern detection also misses arbitrary credentials and transformed values.

**Concrete fix:** Produce a data-flow inventory identifying every persistence and outbound boundary. Apply redaction before tracing and model submission, including grader, rewrite, summarization and embedding calls; minimize raw storage. Add canary-secret tests across all these paths, including split streams, failures and cancellation. Document detector limitations, file permissions, retention and credential-rotation guidance. Replace absolute secret-removal claims with bounded ones.

## 6. Multi-user isolation coverage is much narrower than P6-R01
**Severity: high**

**What is wrong:** P6-R01 promises isolation of **all user data**, but its traceability evidence primarily covers conversations and uploads. The documents do not establish equivalent controls for reports, approvals, targets, test evidence, feedback, SSE reconnects, checkpoint identifiers, citations, caches and vector-store metadata.

**Why it matters:** Any one of these paths can bypass otherwise correct conversation ACLs. A report generated from another conversation ID or a citation resolved without ownership checks can disclose private content.

**Concrete fix:** Build an object/action authorization matrix and parameterized cross-user tests for every endpoint and service method, including guessed IDs and indirect references. Verify that authenticated identity—not model arguments—supplies ownership. Test concurrent users with identical queries against retrieval caches. Define whether deletion removes checkpoints, embeddings, reports and traces, and distinguish “not applied in future context” from actual data deletion.

## 7. The input Guard conflicts with the product’s core workflow
**Severity: high**

**What is wrong:** README says attack-like input receives a fixed response unless quoted or asked about. The named users routinely need to paste hostile prompts, jailbreaks and poisoned documents for analysis. Quotation and question phrasing are neither reliable indicators of benign intent nor security boundaries. Summarization introduces another risk: untrusted instructions can lose provenance and become apparently authoritative memory.

**Why it matters:** The Guard can block legitimate security work while remaining easy to evade. Guard precision/recall on sentence labels does not demonstrate that downstream actions remain authorized.

**Concrete fix:** Provide an explicit artifact-analysis path that accepts hostile text as inert data. Preserve provenance through retrieval, tool results and summaries; never promote user-derived summaries to system authority. Test delimiter spoofing, quoted attacks and multi-turn persistence. Evaluate both legitimate analysis completion and unauthorized-action prevention. Treat the heuristic Guard as advisory defense in depth, not a classifier that makes inputs safe.

## 8. “Every Tool call passes the Gateway” leaves important execution paths ambiguous
**Severity: high**

**What is wrong:** SPEC §19 explicitly says M2 retrieval runs as a graph node, while `search_knowledge` is also a Gateway-controlled Tool. Similar ambiguity exists for model calls, summarization and other graph-internal work. “No Tool edits policy” proves only that direct policy modification is unavailable; it does not prove that permitted tools cannot be abused.

**Why it matters:** Disabling a tool or imposing its rate limit may not restrict equivalent graph-node behavior. A malicious instruction can also misuse an allowed action without changing policy.

**Concrete fix:** Enumerate every execution path and its enforcement point. Route duplicate graph/tool capabilities through the same authorization, size-limit and accounting services. State whether disabling `search_knowledge` disables retrieval or only model-invoked search. Apply resource ownership constraints to allowed actions such as `generate_report(conversation_id)`. Test an injection that requests an unauthorized resource through a valid, enabled tool.

## 9. The injection harness demonstrates its fixtures, not general injection resistance
**Severity: high**

**What is wrong:** SPEC §11 tests an authored demo target with secure and vulnerable profiles, a fake export tool and a small fixed suite. Target audit logs and sink evidence are better than model prose, but remain target-provided evidence. The supplied documents do not establish whether the demo’s decision behavior meaningfully represents an LLM application. SPEC §20’s “11 breaches of 12 (1 contaminated, excluded)” also leaves the rate denominator ambiguous.

**Why it matters:** A secure profile that deterministically denies exports can pass without demonstrating model-level injection resistance. A broken adapter or falsified target log can misclassify results. Zero observed breaches is not evidence of general security.

**Concrete fix:** Call this a **harness/fixture regression test** unless independently representative targets are evaluated. Define an adapter protocol, run-specific unpredictable markers, isolated sink state and correlated evidence. Report proposed, attempted, executed, received, contaminated, error and not-tested outcomes separately. Publish exact denominators and test benign functionality so “deny everything” cannot appear successful.

## 10. The datasets are too small and insufficiently independent for broad quality claims
**Severity: medium**

**What is wrong:** SPEC §13 uses roughly 30 authored QA cases, 20 tool tasks and 104 Guard inputs, plus a 30-item Guard holdout. There is no supplied breakdown of coverage, author independence, duplicates, class balance or how “never tuned against” is maintained. Continually inspecting a holdout through CI can turn it into a development set.

**Why it matters:** Scores can reflect familiarity with the fixtures and expected phrasing rather than usefulness on real AppSec tasks. Thirty holdout items provide weak evidence about rare failures.

**Concrete fix:** Publish a dataset card and coverage matrix. Separate development, frozen test and newly collected challenge sets; track when test results influence changes. Add realistic benign security artifacts, negative cases, multi-turn requests and independent reviewer-authored cases. Report uncertainty and avoid generalizing outside the tested distribution.

## 11. The judge design does not yet establish reliable measurement
**Severity: medium**

**What is wrong:** A “powerful” judge slot is not evidence that the judge correctly assesses security advice or citation support. No human calibration, repeated-run agreement, judge-prompt versioning or protection against instructions embedded in evaluated answers is described. Slot overrides also make runs incomparable unless resolved configuration is captured.

**Why it matters:** A judge can reward plausible but wrong security guidance, follow answer-injected grading instructions or favor its own model’s style. Deterministic tool-name correctness can pass despite wrong arguments or failed execution.

**Concrete fix:** Calibrate a blinded sample against human AppSec ratings and report agreement. Version judge prompts and record resolved model/settings for each run. Test adversarial answer content against the judge. Extend tool evaluation to arguments, authorization, execution outcome, unnecessary calls and approval behavior—not only expected tool names.

## 12. Passing acceptance tests is being used as a substitute for outcome reporting
**Severity: medium**

**What is wrong:** Traceability declares all 24 acceptance tests covered, but P6-A15 accepts “documented rates” without a predefined threshold. P6-A05 requires a citation, not a correct supporting citation. P6-A23 requires metrics to be written and displayed, not acceptable quality. The supplied documents contain no full QA or tool-quality results.

**Why it matters:** A feature-complete application can satisfy these tests while producing poor or unsafe answers. “All milestones built” and “all tests passing” do not resolve that distinction.

**Concrete fix:** Add a consolidated results table with thresholds defined before the final run, exact numerators/denominators, configuration, failures, skipped cases and error handling. Report end-task usefulness, citation entailment, abstention and unauthorized-action rates separately from infrastructure tests. Preserve and discuss representative failures rather than presenting only aggregate scores.

## 13. Budgets, retries and paused turns need transactional semantics
**Severity: medium**

**What is wrong:** SPEC §7 sets model-call, tool-call and 60-second limits, but does not explain whether retries, internal model calls, Plugin startup or approval wait time count. Concurrent turns can race budget checks. Costs may be unknown or arrive only after expenditure. Evaluation snapshots prevent ordinary database writes but do not inherently isolate checkpoint files, Chroma, traces or external side effects.

**Why it matters:** A nominal budget can be exceeded; retries can duplicate paid work; an approval resume after a restart can repeat an action. Evaluation may still affect live resources.

**Concrete fix:** Define a turn state machine and budget accounting rules. Reserve budget atomically across concurrent turns, impose output/call caps before spending, and represent unknown cost honestly. Use idempotency keys and durable execution records. Separate active-execution deadlines from approval expiry. Run evaluation with dedicated storage, identities and restricted tool capabilities. Test crashes, cancellation, concurrent turns and resume after policy changes.

## 14. The most security-sensitive browser flows lack automated integration coverage
**Severity: medium**

**What is wrong:** ADR 0001 explicitly excludes browser end-to-end tests despite relying on cookies, CSRF, SSE, approval cards, Markdown and citations. Backend tests and a few Vitest tests cannot establish that these components work securely together. Markdown rendering and URL handling are not specified here.

**Why it matters:** Lost or duplicated SSE events can misrepresent execution state. Unsafe Markdown or tool descriptions can become XSS. A broken CSRF implementation can undermine otherwise correct service authorization.

**Concrete fix:** Add a small browser suite covering login/logout, CSRF rejection, approval/rejection, reconnect without duplicate execution, cross-user navigation and malicious Markdown/tool descriptions. Disable raw HTML or sanitize it and restrict link schemes. This is a scope judgement, not proof of an existing flaw—but omitting all browser integration tests is a poor trade-off for this particular product.

## 15. The documentation has conflicting authorities and completion claims
**Severity: medium**

**What is wrong:** `docs/DESIGN.md` says nothing has been built and confirmation is pending, yet SPEC §19 says it was confirmed and README says all milestones are complete. SPEC declares DESIGN authoritative. SPEC §20 both changes the judge to GPT and later says it stays on Claude. P6-A20 confuses `plugin:<id>` contribution metadata with README’s `<plugin>__<tool>` callable names. “Hard rubric fully met after M3” conflicts with later evaluation delivery and the explicit admission that learning from feedback is only partly met.

**Why it matters:** A grader cannot reliably determine the current contract, configuration or completion status. Stale material also enters help-mode retrieval and can produce incorrect operational guidance.

**Concrete fix:** Mark DESIGN as a historical interview record and remove its precedence over the current specification. Establish one current behavior/configuration reference, reconcile naming and tracing/report paths, and replace milestone-wide completion claims with requirement-level statuses: implemented, tested, live-verified, limited or partially met. Exclude obsolete operational instructions from help retrieval.
