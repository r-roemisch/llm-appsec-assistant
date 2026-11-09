import pytest
from langchain_core.messages import AIMessage, AIMessageChunk

from rampart.catalog.catalog import Catalog, ModelSpec
from rampart.chat.llm import (
    GenerationSettings,
    OpenRouterChat,
    ProviderChatModelFactory,
    extract_usage,
)
from rampart.config import load_settings
from rampart.errors import ServiceUnavailable


def test_streaming_chunk_keeps_openrouter_cost():
    model = OpenRouterChat(model="anthropic/claude-haiku-5.5", api_key="k", base_url="http://x")
    usage_chunk = {
        "id": "gen-abc",
        "object": "chat.completion.chunk",
        "choices": [],
        "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7, "cost": 0.00042},
    }
    text_chunk = {"id": "gen-abc", "choices": [{"delta": {"content": "Hi"}, "index": 0}]}
    first = model._convert_chunk_to_generation_chunk(text_chunk, AIMessageChunk, None)
    last = model._convert_chunk_to_generation_chunk(usage_chunk, AIMessageChunk, None)
    assert first is not None and last is not None
    assert "openrouter_usage" not in first.message.response_metadata
    merged = first.message + last.message
    assert merged.response_metadata["openrouter_usage"]["cost"] == 0.00042
    assert merged.response_metadata["openrouter_id"] == "gen-abc"
    assert merged.usage_metadata["input_tokens"] == 5

    usage = extract_usage(merged, "openrouter")
    assert (usage.input_tokens, usage.output_tokens, usage.cost_usd) == (5, 2, 0.00042)
    assert usage.generation_id == "gen-abc"


def test_extract_usage_non_streaming_and_ollama():
    message = AIMessage(
        content="x",
        usage_metadata={"input_tokens": 3, "output_tokens": 4, "total_tokens": 7},
        response_metadata={"token_usage": {"prompt_tokens": 3, "completion_tokens": 4, "cost": 0.5}},
    )
    assert extract_usage(message, "openrouter").cost_usd == 0.5
    assert extract_usage(message, "ollama").cost_usd == 0.0
    bare = AIMessage(content="x")
    assert extract_usage(bare, "openrouter") == extract_usage(bare, "openrouter")
    assert extract_usage(bare, "openrouter").cost_usd is None


def test_factory_builds_each_provider_or_explains(tmp_path):
    settings = load_settings(_env_file=None, data_dir=tmp_path, openrouter_api_key=None,
                             langfuse_public_key=None, langfuse_secret_key=None)
    hosted = ModelSpec(id="anthropic/claude-haiku-5.5", provider="openrouter",
                       display_name="H", kind="chat", tier="cheap")
    local = ModelSpec(id="ollama/qwen3:8b", provider="ollama", display_name="Q",
                      kind="chat", tier="cheap")
    factory = ProviderChatModelFactory(settings)
    with pytest.raises(ServiceUnavailable):
        factory.build(hosted, GenerationSettings())

    configured = load_settings(_env_file=None, data_dir=tmp_path, openrouter_api_key="sk-test",
                               langfuse_public_key=None, langfuse_secret_key=None)
    model = ProviderChatModelFactory(configured).build(hosted, GenerationSettings(0.3, 2048))
    assert isinstance(model, OpenRouterChat)
    assert model.extra_body == {"usage": {"include": True}}
    assert model.stream_usage is True and model.temperature == 0.3 and model.max_tokens == 2048
    assert "openrouter.ai" in str(model.openai_api_base)

    ollama = ProviderChatModelFactory(configured).build(local, GenerationSettings(None, 256))
    assert type(ollama).__name__ == "ChatOllama"
    assert ollama.model == "qwen3:8b" and ollama.num_predict == 256
    assert ollama.num_ctx == 16384  # never Ollama's 4096 default, which cuts the system prompt
    assert ollama.reasoning is False  # no thinking by default: CPU inference is slow

    thinking = load_settings(_env_file=None, data_dir=tmp_path, openrouter_api_key=None,
                             langfuse_public_key=None, langfuse_secret_key=None,
                             ollama_thinking=True, ollama_num_ctx=8192)
    answers = ProviderChatModelFactory(thinking).build(local, GenerationSettings())
    grader = ProviderChatModelFactory(thinking).build(local, GenerationSettings(), purpose="grader")
    assert answers.reasoning is None and answers.num_ctx == 8192  # the model's own default
    assert grader.reasoning is False  # routing and grading never think


def test_catalog_validation():
    good = {
        "models": [
            {"id": "a/b", "provider": "openrouter", "display_name": "AB", "kind": "chat", "tier": "cheap"},
            {"id": "a/e", "provider": "openrouter", "display_name": "AE", "kind": "embedding", "tier": "cheap"},
        ],
        "slots": {"chat": {"model": "a/b"}, "grader": {"model": "a/b"}, "judge": {"model": "a/b"},
                  "embedding": {"model": "a/e"}},
    }
    catalog = Catalog.from_mapping(good)
    assert catalog.slot_defaults["chat"].model_id == "a/b"

    from rampart.errors import Invalid

    def fails(mutate):
        import copy
        broken = copy.deepcopy(good)
        mutate(broken)
        with pytest.raises(Invalid):
            Catalog.from_mapping(broken)

    fails(lambda c: c["slots"].pop("judge"))
    fails(lambda c: c["slots"]["embedding"].update(model="a/b"))
    fails(lambda c: c["models"].append(dict(c["models"][0])))
    fails(lambda c: c["models"].append({"id": "qwen3", "provider": "ollama", "kind": "chat", "tier": "cheap"}))
    fails(lambda c: c["models"][0].update(provider="azure"))
    fails(lambda c: c["slots"]["chat"].update(temperature=5))


def test_openrouter_calls_retry_with_backoff_and_time_out():
    """P6-A22: Provider errors are retried (the OpenAI client backs off exponentially) before a
    clear error; every call has a timeout."""
    from pydantic import SecretStr

    from rampart.config import load_settings

    configured = load_settings(_env_file=None, openrouter_api_key=SecretStr("sk-or-test"))
    spec = ModelSpec(id="openai/gpt-6-luna", provider="openrouter", display_name="L", kind="chat", tier="cheap")
    model = ProviderChatModelFactory(configured).build(spec, GenerationSettings(None, 256))
    assert model.max_retries == 2 and model.request_timeout == 120
