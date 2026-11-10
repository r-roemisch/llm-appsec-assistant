# Traceability

Every requirement (P6-R01 to R14), acceptance test (P6-A01 to A31) and rubric line of
`docs/SPEC.md`, with the code that implements it and the evidence that it works. Paths are
relative to the repository root; `tests/x.py::name` is a pytest test in the offline suite (run
with `uv run pytest`), which uses a scripted stand-in model and the real services. Live evidence
(real Models, real processes, a real browser) is recorded in the milestone reports.

Status on 2026-11-09: all 31 acceptance tests are covered by passing tests; see
`docs/reports/m6.md` and, for A25 to A31 (milestone M7), `docs/reports/m7.md` for the final
test runs and the recorded live runs. A30 is covered as specified, but its 60 % recall floor
was not met; the measured level is what the test pins.

## Requirements

| ID | Requirement (short) | Code | Evidence |
|---|---|---|---|
| P6-R01 | Argon2 passwords; accounts by admin or CLI only; roles; httpOnly session with CSRF; per-user isolation; users delete their own data | [`auth/service.py`](../src/rampart/auth/service.py), [`auth/router.py`](../src/rampart/auth/router.py), [`deps.py`](../src/rampart/deps.py), [`cli.py`](../src/rampart/cli.py) | `tests/test_auth.py::test_user_role_is_rejected_on_admin_routes`, `tests/test_isolation.py::test_conversations_are_private`, `tests/test_knowledge.py::test_uploads_are_private_to_their_owner` |
| P6-R02 | Chat Model per Conversation across OpenRouter and Ollama; admin Slots with temperature and max tokens; fixed persona | [`models.yaml`](../models.yaml), [`catalog/catalog.py`](../src/rampart/catalog/catalog.py), [`catalog/service.py`](../src/rampart/catalog/service.py), [`chat/llm.py`](../src/rampart/chat/llm.py), [`chat/prompts.py`](../src/rampart/chat/prompts.py) | `tests/test_chat.py::test_switch_model_mid_conversation`, `tests/test_models.py::test_admin_overrides_chat_slot_and_turns_use_it`, `tests/test_llm.py::test_factory_builds_each_provider_or_explains` |
| P6-R03 | Agentic retrieval: hybrid search with ACL, grading, at most two rewrites, Citations | [`chat/graph.py`](../src/rampart/chat/graph.py), [`knowledge/retrieval.py`](../src/rampart/knowledge/retrieval.py), [`chat/citable.py`](../src/rampart/chat/citable.py) | `tests/test_retrieval.py::test_answer_cites_the_knowledge_base`, `tests/test_retrieval.py::test_weak_retrieval_rewrites_at_most_twice`, `tests/test_retrieval.py::test_uploads_stay_private_in_hybrid_search_and_chat` |
| P6-R04 | Six built-in Tools (five until M7) with manifests, admin toggles; Plugins from the catalog under the same registry; drift blocks use | [`tools/registry.py`](../src/rampart/tools/registry.py), [`tools/builtin.py`](../src/rampart/tools/builtin.py), [`admin/router.py`](../src/rampart/admin/router.py), [`plugins/`](../src/rampart/plugins/), [`plugins/catalog.yaml`](../plugins/catalog.yaml) | `tests/test_gateway.py::test_disabled_tool_is_not_offered_and_a_direct_call_is_denied`, `tests/test_plugins.py::test_an_enabled_plugin_contributes_tools_disabled_by_default_after_review`, `tests/test_plugins.py::test_drift_blocks_use_until_an_admin_accepts_the_change` |
| P6-R05 | The Gateway checks every call; Approval for `run_injection_test` and Plugin Tools (requester, or admin by switch); every decision audited | [`gateway/gateway.py`](../src/rampart/gateway/gateway.py), [`gateway/approvals.py`](../src/rampart/gateway/approvals.py), [`gateway/constraints.py`](../src/rampart/gateway/constraints.py) | `tests/test_gateway.py::test_unknown_tool_and_undeclared_arguments_are_rejected_before_execution`, `tests/test_approvals.py` (P6-A12), `tests/test_plugins.py::test_a_plugin_tool_call_needs_approval_and_its_output_is_untrusted_data` |
| P6-R06 | Input Guard; Provenance on every context item; output redaction; events shown to admins | [`guards/input_guard.py`](../src/rampart/guards/input_guard.py), [`guards/patterns.py`](../src/rampart/guards/patterns.py), [`guards/secrets.py`](../src/rampart/guards/secrets.py), [`guards/stream.py`](../src/rampart/guards/stream.py) | `tests/test_guards.py::test_guard_cases_are_replayed_at_the_documented_rates`, `tests/test_guards.py::test_streaming_redactor_never_releases_a_secret_split_across_chunks`, `tests/test_tools.py::test_poisoned_passage_is_flagged_and_its_instruction_denied` |
| P6-R07 | Short-term memory in the checkpointer, summarised past a size; the Project Profile read every turn, editable and deletable | [`chat/engine.py`](../src/rampart/chat/engine.py), [`chat/graph.py`](../src/rampart/chat/graph.py) (`memory`), [`profile/service.py`](../src/rampart/profile/service.py) | `tests/test_memory.py::test_older_turns_are_summarised_and_the_last_turns_kept`, `tests/test_profile.py::test_profile_is_read_every_turn_and_dropped_after_delete` |
| P6-R08 | Tokens and cost per turn, Conversation and user from the figure OpenRouter reports (zero for Ollama); admin totals | [`chat/ledger.py`](../src/rampart/chat/ledger.py), [`usage/service.py`](../src/rampart/usage/service.py), [`chat/llm.py`](../src/rampart/chat/llm.py) | `tests/test_usage.py::test_usage_totals_match_the_recorded_costs`, `tests/test_llm.py::test_extract_usage_non_streaming_and_ollama` |
| P6-R09 | Feedback with trace id, shown to admins, forwarded as a score, convertible into Evaluation Cases; changes nothing else | [`feedback/service.py`](../src/rampart/feedback/service.py), [`feedback/router.py`](../src/rampart/feedback/router.py), [`tracing/tracer.py`](../src/rampart/tracing/tracer.py) | `tests/test_feedback.py::test_thumbs_down_is_stored_with_the_trace_and_changes_no_policy`, `tests/test_feedback.py::test_an_admin_turns_feedback_into_an_evaluation_case`; real score read back from Langfuse Cloud (`docs/reports/m6.md`) |
| P6-R10 | OSV.dev at runtime (Provenance API); OWASP, ATLAS, NIST via `rampart ingest` with license notes; no runtime web fetching | [`tools/osv.py`](../src/rampart/tools/osv.py), [`knowledge/sources.py`](../src/rampart/knowledge/sources.py), [`knowledge/ingest.py`](../src/rampart/knowledge/ingest.py) | `tests/test_tools.py::test_osv_lookup_is_parsed_cached_and_survives_an_outage`, `tests/test_sources.py::test_owasp_entry_becomes_one_source_with_section_headings`, `tests/test_sources.py::test_fetcher_refuses_hosts_outside_the_allowlist` |
| P6-R11 | Injection tests only against registered loopback Targets; outcomes from harness evidence | [`targets/service.py`](../src/rampart/targets/service.py), [`targets/runner.py`](../src/rampart/targets/runner.py), [`demo_target/app.py`](../src/rampart/demo_target/app.py), [`fixtures/injection/seed-v1.json`](../fixtures/injection/seed-v1.json) | `tests/test_injection.py::test_injection_tool_runs_end_to_end_against_a_vulnerable_target`, `tests/test_targets.py::test_register_only_loopback_targets` |
| P6-R12 | A trace per turn, its id on the message and linked to Feedback; evaluation reports from `rampart eval`, viewable in the admin UI | [`tracing/tracer.py`](../src/rampart/tracing/tracer.py), [`eval/service.py`](../src/rampart/eval/service.py), [`eval/router.py`](../src/rampart/eval/router.py), [`eval/report.py`](../src/rampart/eval/report.py) | `tests/test_tracing.py::test_jsonl_trace_is_written_with_the_message_trace_id`, `tests/test_eval.py::test_the_admin_page_estimates_starts_and_shows_runs` |
| P6-R13 | Retries with backoff then a clear error; BM25-only with a badge; JSONL fallback; size caps; timeouts; bounded loops | [`chat/llm.py`](../src/rampart/chat/llm.py), [`chat/service.py`](../src/rampart/chat/service.py), [`knowledge/retrieval.py`](../src/rampart/knowledge/retrieval.py), [`tracing/tracer.py`](../src/rampart/tracing/tracer.py) | `tests/test_llm.py::test_openrouter_calls_retry_with_backoff_and_time_out`, `tests/test_chat.py::test_ollama_offline_gives_a_clear_error`, `tests/test_tracing.py::test_langfuse_unreachable_still_writes_the_jsonl_trace`, `tests/test_gateway.py::test_rate_limit_and_conversation_budget_stop_further_calls` |
| P6-R14 | README with runnable examples, guides, decision records, traceability, critique log, a report per milestone | [`README.md`](../README.md), [`user_guide.md`](user_guide.md), [`admin_guide.md`](admin_guide.md), [`adr/`](adr/), this file, [`critique_log.md`](critique_log.md), [`reports/`](reports/) | README commands executed as written (`docs/reports/m6.md`); documentation review |

## Acceptance tests

| ID | Scenario | Tests | Live evidence |
|---|---|---|---|
| P6-A01 | Own data only; admin route 403; another user's Conversation 404 | `tests/test_auth.py::test_user_role_is_rejected_on_admin_routes`, `tests/test_isolation.py::test_conversations_are_private` | |
| P6-A02 | Model switched mid-Conversation | `tests/test_chat.py::test_switch_model_mid_conversation` | live smoke (`tests/test_live_smoke.py`, m1 to m6 reports) |
| P6-A03 | A user writes a Slot, Tool policy or the system prompt: 403 | `tests/test_admin.py::test_users_cannot_write_tool_policy_or_the_system_prompt`, `tests/test_auth.py::test_user_role_is_rejected_on_admin_routes` | |
| P6-A04 | Admin changes the chat Slot or its settings | `tests/test_models.py::test_admin_overrides_chat_slot_and_turns_use_it` | |
| P6-A05 | Citations; at most two rewrites | `tests/test_retrieval.py::test_answer_cites_the_knowledge_base`, `tests/test_retrieval.py::test_weak_retrieval_rewrites_at_most_twice` | real retrieval turns (m2 report); DeepEval contextual metrics (m6 report) |
| P6-A06 | Another user's upload is never retrieved | `tests/test_knowledge.py::test_uploads_are_private_to_their_owner`, `tests/test_retrieval.py::test_uploads_stay_private_in_hybrid_search_and_chat`, `tests/test_data_protection.py::test_a_private_upload_stays_out_of_the_admin_audit_log` | mutation check (m2 report) |
| P6-A07 | PDF, Markdown, text uploads; bad files 422 | `tests/test_knowledge.py::test_uploads_accept_pdf_markdown_text_and_reject_bad_files` | |
| P6-A08 | A passage tells the assistant to test an external host | `tests/test_tools.py::test_poisoned_passage_is_flagged_and_its_instruction_denied` | |
| P6-A09 | OSV.dev up and down | `tests/test_tools.py::test_osv_lookup_is_parsed_cached_and_survives_an_outage`, `tests/test_tools.py::test_lookup_vulnerabilities_tool_with_osv_up_and_down` | real OSV.dev lookups (m3 report) |
| P6-A10 | A disabled Tool is not offered and is denied | `tests/test_gateway.py::test_disabled_tool_is_not_offered_and_a_direct_call_is_denied` | |
| P6-A11 | Unknown Tool or undeclared argument rejected before execution, audited | `tests/test_gateway.py::test_unknown_tool_and_undeclared_arguments_are_rejected_before_execution` | |
| P6-A12 | Approval card; changed arguments, expiry, single use, admin switch | `tests/test_approvals.py` (the whole file) | live approval in the browser (m3, m4, m5 reports) |
| P6-A13 | Rate limit or budget exceeded: bounded stop | `tests/test_gateway.py::test_rate_limit_and_conversation_budget_stop_further_calls`, `tests/test_gateway.py::test_conversation_budget_stops_a_turn_before_any_model_call` | |
| P6-A14 | Secrets in Tool or model output redacted before display and storage | `tests/test_guards.py::test_secrets_in_the_model_answer_are_redacted_before_display_and_storage`, `tests/test_tools.py::test_tool_output_secrets_are_redacted_before_the_model_and_the_card` | |
| P6-A15 | Guard cases replayed at the documented rates | `tests/test_guards.py::test_guard_cases_are_replayed_at_the_documented_rates` | `rampart eval --suite guard` (m6 report; run in CI) |
| P6-A16 | Project Profile applied, then dropped after deletion | `tests/test_profile.py::test_profile_is_read_every_turn_and_dropped_after_delete` | |
| P6-A17 | Cost equals OpenRouter's figure; Ollama zero; totals match | `tests/test_usage.py::test_usage_totals_match_the_recorded_costs` | live smoke: OpenRouter and Ollama turns (m1, m2, m6 reports) |
| P6-A18 | Thumbs down: stored with trace id, forwarded as a score, policy and Guard digests unchanged | `tests/test_feedback.py::test_thumbs_down_is_stored_with_the_trace_and_changes_no_policy` | score read back from Langfuse Cloud with the Feedback's id (m6 report) |
| P6-A19 | Feedback becomes an Evaluation Case that the next run includes | `tests/test_feedback.py::test_an_admin_turns_feedback_into_an_evaluation_case`, `tests/test_eval.py::test_a_feedback_case_is_part_of_the_next_qa_run` | |
| P6-A20 | Plugins: `plugin:<id>`, disabled by default, drift blocks, no command from the model or UI | `tests/test_plugins.py` (the whole file) | real stdio servers, real model and browser (m5 report) |
| P6-A21 | Demo Target vulnerable versus secure; unregistered URL rejected; contamination | `tests/test_injection.py` (the whole file) | real loopback runs and a real-model run (m4 report) |
| P6-A22 | OpenRouter error; Langfuse unreachable; no embedding Model; Ollama offline | `tests/test_chat.py::test_model_failure_is_reported_not_crashed`, `tests/test_llm.py::test_openrouter_calls_retry_with_backoff_and_time_out`, `tests/test_tracing.py::test_langfuse_unreachable_still_writes_the_jsonl_trace`, `tests/test_knowledge.py::test_sources_listing_and_bm25_status`, `tests/test_chat.py::test_ollama_offline_gives_a_clear_error` | |
| P6-A23 | `rampart eval`: metrics written and displayed; datasets unreadable at runtime | `tests/test_eval.py::test_rampart_eval_guard_writes_reports_and_records_the_run`, `tests/test_eval.py::test_the_admin_page_estimates_starts_and_shows_runs`, `tests/test_eval.py::test_the_datasets_are_unreadable_at_runtime` | real `guard`, `tool` and `qa` runs (m6 report) |
| P6-A24 | Help-mode question about registering a Target cites the user guide | `tests/test_retrieval.py::test_help_mode_answers_from_the_user_guide` | |
| P6-A25 | Repeated failed sign-ins are throttled | `tests/test_auth.py::test_a_username_is_throttled_after_five_failures`, `tests/test_auth.py::test_refused_attempts_do_not_extend_the_block`, `tests/test_auth.py::test_success_and_admin_reset_clear_the_count`, `tests/test_auth.py::test_a_client_address_is_throttled_across_usernames`, `tests/test_auth.py::test_forwarded_header_is_ignored_unless_trusted` | |
| P6-A26 | Trace retention | `tests/test_cli.py::test_traces_prune_deletes_only_old_trace_files`, `tests/test_cli.py::test_the_server_prunes_traces_at_start_only_when_configured` | `docs/data_flows.md` |
| P6-A27 | Run-specific Sentinel | `tests/test_injection.py::test_each_run_gets_a_different_sentinel`, `tests/test_injection.py::test_a_sentinel_from_an_earlier_run_does_not_count`, `tests/test_injection.py::test_a_target_that_ignores_the_sentinel_is_weaker_evidence`, `tests/test_injection.py::test_runner_finds_the_vulnerable_profile_breaches_from_the_sink` | |
| P6-A28 | Dependency File import | `tests/test_dependency_files.py` (parser tests), `tests/test_dependency_files.py::test_preview_then_merge_or_replace`, `tests/test_dependency_files.py::test_the_package_cap_names_the_count`, `tests/test_dependency_files.py::test_a_long_package_list_reaches_the_model_as_counts` | `frontend/src/test/DependencyImport.test.tsx` |
| P6-A29 | `check_dependencies` | `tests/test_dependency_files.py::test_check_dependencies_checks_the_profile_in_one_batch`, `tests/test_dependency_files.py::test_check_dependencies_without_versions_or_osv` | |
| P6-A30 | Guard Holdout Set and the model classifier | `tests/test_guards.py::test_guard_cases_are_replayed_at_the_documented_rates`, `tests/test_eval.py::test_the_guard_suite_can_measure_the_model_classifier` | real classifier run (`docs/reports/eval/20261109-143742-guard-bca51853.md`); floor missed by the rules, met by the classifier (m7 report) |
| P6-A31 | Tool evaluation with expected calls | `tests/test_eval.py::test_call_metrics_check_arguments_decisions_and_extra_calls`, `tests/test_eval.py::test_a_turn_record_keeps_each_call_with_its_latest_decision`, `tests/test_eval.py::test_the_authored_tool_cases_name_expected_calls` | real tool run (`docs/reports/eval/20261109-150723-tool-083138a7.md`) |

## Rubric: hard requirements

| Rubric line | Feature | Evidence |
|---|---|---|
| Agent purpose | An LLM application security assistant that cites its Sources and is built as the secure agent it recommends (README, `docs/user_guide.md`) | Documentation review |
| Core functionality | R02 to R05, R10, R11 | A02, A05, A09, A12, A21 |
| User interface | React app: Conversations with Tool and Approval cards, Feedback, Knowledge Base, Profile, Targets, Reports, Help, Admin (users, Models, usage, Tools, Plugins, Approvals, Audit, Settings, Feedback, Evaluation) | A01, A03, A24; browser checks in the m2 to m6 reports |
| Technical implementation | FastAPI, LangGraph, SQLite, Chroma and BM25, MCP, Langfuse, DeepEval; R13 | A09, A13, A22 |
| Documentation | R14 | This file, README, guides, ADRs, reports |

## Rubric: soft requirements

| Soft item | Feature | Evidence |
|---|---|---|
| Easy: ChatGPT critique | `docs/critique_prompt.md`, `docs/critique_log.md` (an OpenAI model via OpenRouter) | M6 review |
| Easy: personality | Fixed persona in the system prompt plus the help page | A24; documentation review |
| Easy: choose from a list of LLMs | `models.yaml` catalog and the Model picker | A02 |
| Easy: temperature, max tokens as fields | Admin Slot settings | A04 |
| Easy: interactive help | Help page and help mode over the app's own guides | A24 |
| Medium: token usage and costs | Usage ledger, cost badges, admin usage | A17 |
| Medium: memory in LangGraph | Checkpointer per Conversation with summarisation; Project Profile every turn | A16, `tests/test_memory.py` |
| Medium: tool calling an external API | `lookup_vulnerabilities` (OSV.dev) | A09 |
| Medium: authentication and personalisation | Accounts, roles, per-Conversation Model, Project Profile, greeting by name | A01, A16 |
| Medium: feedback loop with ratings | Feedback capture, admin dashboard, Evaluation Cases (human in the loop) | A18, A19 |
| Medium: five tools, toggles, plugin system | Five built-in Tools, admin toggles, the Plugin catalog | A10, A20 |
| Medium: multi-model support | OpenAI Models via OpenRouter (Anthropic Models in the catalog where the workspace allows them), local Models via Ollama | A02, A22 |
| Medium: security guard, dev/user separation | G1 to G4; admin versus user roles | A03, A08, A11 to A15 |
| Hard: agentic RAG | Route, retrieve, grade, rewrite, generate with Citations and ACL | A05, A06 |
| Hard: LLM observability | Langfuse Cloud with an always-kept JSONL copy; a trace id per turn; Feedback scores | A22 |
| Hard: evaluation report | `rampart eval` with DeepEval and Guard metrics, in the CLI and the admin UI | A23 |
| Hard: agent learns from feedback | Human in the loop only: Feedback becomes Evaluation Cases, the next run measures them, a maintainer changes prompts or retrieval; no automatic adaptation, so a strict reading counts this as partly met | A18, A19 |
| Hard: external data sources | OSV.dev at runtime; OWASP, MITRE ATLAS and NIST via `rampart ingest`; uploads | A07, A09 |
