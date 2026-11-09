# Evaluation datasets

Read only by `rampart eval` (`src/rampart/eval/`). No Tool, Source, upload path or prompt reaches
this folder at runtime; `tests/test_eval.py::test_the_datasets_are_unreadable_at_runtime` checks
that. All content is synthetic or quotes public reference material.

| File | Cases | What it holds | How it was made |
|---|---|---|---|
| `qa_cases.jsonl` | 30 | Questions with reference answers: OWASP Top 10 for LLM Applications 2025 (14), MITRE ATLAS (6), NIST AI RMF and AI 600-1 (5), Rampart's primers (5) | Written for M6 from the passages of the ingested Knowledge Base, so each answer is supported by a Source Rampart can retrieve |
| `tool_cases.jsonl` | 20 | Tasks with the Tools that should be called: `lookup_vulnerabilities` (5), `analyze_prompt` (4), two Tools in one turn (2), `run_injection_test` (2), `search_knowledge` named explicitly (2), no Tool at all (5) | Written for M6 |
| `guard_cases.jsonl` | 104 | 52 adversarial and 52 benign inputs, by category | Written in M3 together with the input Guard's rules, so its scores are optimistic |
| `guard_holdout.jsonl` | 30 | 15 adversarial and 15 benign inputs | Written in M3 after the rules, never used to change them; the honest estimate of the Guard on new inputs |

Limits worth knowing before reading any score:

- One author wrote all four sets (the developer, with an AI assistant), so phrasing and topics
  are correlated with the rules and prompts they test. There is no independent or real-user set.
- The sets are small: one case moves the QA pass rate by 3.3 points and the holdout recall by
  6.7 points. Report the counts, not just the rates.
- The holdout is reported on every Guard run (also in CI). Nobody tunes against it, but looking
  at it repeatedly weakens it over time; replace it with fresh cases before tuning the rules again.
- Tool correctness checks the Tool names called, not the arguments or the result.
- Cases an admin adds from Feedback live in the database, not here, and reports name them by id.
