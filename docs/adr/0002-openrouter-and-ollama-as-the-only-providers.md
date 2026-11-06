---
status: accepted
date: 2026-11-06
---

# OpenRouter and Ollama as the only Providers

Version 1.0 of the specification planned direct vendor SDKs for Anthropic, OpenAI and Google, each with its own key, error surface and hand-maintained pricing table. We decided that the application talks to exactly two Providers: OpenRouter for hosted Models (through its OpenAI-compatible API and the `langchain-openai` package) and a local Ollama instance for offline Models (through `langchain-ollama`). The catalog of Models, their Tier (cheap or powerful) and the default Slot assignments live in `models.yaml`; API keys live only in `.env`. One hosted Provider means one key for the user to obtain, one request shape, and a per-request cost figure reported by OpenRouter itself, which removes the pricing table and the drift that comes with it. The trade-off is a dependency on one intermediary and the loss of vendor-specific features (for example Anthropic's native tool streaming and prompt caching controls); we accepted it because multi-model choice, cost accuracy and a small surface matter more to this project than vendor-specific features.

## Consequences

- Cost per request is read from the `usage` object OpenRouter returns when usage accounting is requested; Ollama calls cost zero. No pricing table exists anywhere in the repository.
- Adding a vendor means adding a line to `models.yaml`, not code, as long as OpenRouter serves it.
- Offline tests use a scripted stand-in model and never reach either Provider.
