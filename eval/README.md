# Evaluation datasets

Read only by `rampart eval` (`src/rampart/eval/`). No Tool, Source, upload path or prompt reaches
this folder at runtime; `tests/test_eval.py::test_the_datasets_are_unreadable_at_runtime` checks
that. All content is synthetic or quotes public reference material.

| File | Cases | What it holds | How it was made |
|---|---|---|---|
| `qa_cases.jsonl` | 30 | Questions with reference answers: OWASP Top 10 for LLM Applications 2025 (14), MITRE ATLAS (6), NIST AI RMF and AI 600-1 (5), Rampart's primers (5) | Written for M6 from the passages of the ingested Knowledge Base, so each answer is supported by a Source Rampart can retrieve |
| `tool_cases.jsonl` | 24 | Tasks with the Tools that should be called and, since M7, the expected calls: the structured arguments each call must contain and the Gateway's decision. `lookup_vulnerabilities` (6, one without a version), `analyze_prompt` (4), two Tools in one turn (2), `run_injection_test` (3, one for an unregistered Target that the Gateway should deny), `search_knowledge` named explicitly (2), `generate_report` (1), no Tool at all (6, one a pasted note asking the assistant to call Tools) | 20 written for M6, 4 added in M7 |
| `guard_cases.jsonl` | 134 | 67 adversarial and 67 benign inputs, by category: the 104 written in M3 with the rules, plus the 30 of the M3 holdout, which joined in M7 after being looked at in every run | The development set: the rules are tuned on it, so its scores are optimistic |
| `guard_holdout.jsonl` | 30 | 15 adversarial inputs (with categories) and 15 near-miss benign ones (quoted attacks, pentest phrasing, requests to write robust prompts) | The Holdout Set: written in M7 (commit "New Guard Holdout Set") before the rules were tuned and never used to change them; measured once for the rules. Labels await review by the owner |

Limits worth knowing before reading any score:

- One author wrote all four sets (the developer, with an AI assistant), so phrasing and topics
  are correlated with the rules and prompts they test. There is no independent or real-user set.
  The M7 Holdout Set was written by the same AI assistant that then tuned the rules; it was
  committed before the tuning and not run during it, but its author knew its content.
- The sets are small: one case moves the QA pass rate by 3.3 points and the holdout recall by
  6.7 points. Report the counts, not just the rates.
- The Holdout Set is reported on every Guard run (also in CI). Nobody tunes against it, but
  looking at it repeatedly weakens it over time; replace it with fresh cases before tuning the
  rules again, and move the old one into the development set, as M7 did.
- Tool correctness checks the Tool names called. Since M7, argument correctness checks the
  structured arguments a case names (free text such as a search query or a pasted prompt is not
  checked), decision correctness checks the Gateway's decision, and a separate metric fails any
  call the case does not expect. The Tool's result is still not checked.
- Cases an admin adds from Feedback live in the database, not here, and reports name them by id.
