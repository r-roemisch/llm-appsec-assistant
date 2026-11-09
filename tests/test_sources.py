"""The official-source converters, tested on small local samples (no network)."""

import asyncio

import pytest

from helpers import make_pdf
from rampart.knowledge.sources import (
    ATLAS_LICENSE,
    OWASP_COMMIT,
    HttpFetcher,
    atlas_documents,
    fixture_documents,
    local_documents,
    nist_document,
    owasp_document,
)

OWASP_SAMPLE = """## LLM01:2025 Prompt Injection

### Description

A Prompt Injection Vulnerability occurs when user prompts alter the LLM's behavior.

### Prevention and Mitigation Strategies

#### 1. Constrain model behavior

Provide specific instructions about the model's role.

### Reference Links

1. [Some paper](https://example.org/paper)
"""

ATLAS_SAMPLE = b"""
id: ATLAS
name: Adversarial Threat Landscape for AI Systems
version: 5.6.0
matrices:
- id: ATLAS
  name: ATLAS Matrix
  tactics:
  - id: AML.TA0005
    name: Execution
    description: The adversary is trying to run malicious code.
  techniques:
  - id: AML.T0051
    name: LLM Prompt Injection
    description: An adversary may craft prompts, often after [ML Model Access](/techniques/AML.T0040).
    tactics: [AML.TA0005]
    maturity: realized
  - id: AML.T0051.001
    name: Indirect
    description: Injected through retrieved data.
    specializes: AML.T0051
    maturity: demonstrated
  mitigations:
  - id: AML.M0015
    name: Adversarial Input Detection
    description: Detect and block atypical queries.
    category: [Technical - ML]
    ml-lifecycle: [Deployment]
    techniques:
    - id: AML.T0051
      use: Flag inputs that look like injected instructions.
case-studies:
- id: AML.CS0099
  name: Sample incident
  summary: A chatbot followed instructions hidden in a web page.
  incident-date: 2024-01-01
  case-study-type: incident
  target: Example chatbot
  actor: Researchers
  procedure:
  - tactic: AML.TA0005
    technique: AML.T0051.001
    description: The page contained hidden instructions.
"""


def test_owasp_entry_becomes_one_source_with_section_headings():
    doc = owasp_document("LLM01_PromptInjection.md", OWASP_SAMPLE)
    assert doc.title == "OWASP LLM01:2025 Prompt Injection"
    assert doc.origin.endswith(f"{OWASP_COMMIT}/2_0_vulns/LLM01_PromptInjection.md")
    assert "CC BY-SA 4.0" in (doc.license_note or "")
    headings = [c.heading for c in doc.chunks]
    assert headings == ["Description", "Prevention and Mitigation Strategies"]
    assert "Constrain model behavior" in doc.chunks[1].text
    assert all("example.org" not in c.text for c in doc.chunks)  # Reference Links skipped


def test_atlas_yaml_becomes_techniques_mitigations_and_case_studies():
    techniques, mitigations, studies = atlas_documents(ATLAS_SAMPLE)
    assert [d.title for d in (techniques, mitigations, studies)] == [
        "MITRE ATLAS techniques",
        "MITRE ATLAS mitigations",
        "MITRE ATLAS case studies",
    ]
    assert techniques.license_note == ATLAS_LICENSE
    first = techniques.chunks[0]
    assert first.heading == "AML.T0051: LLM Prompt Injection"
    assert first.text.startswith("An adversary may craft prompts")  # description first
    assert "Tactics: Execution (AML.TA0005)" in first.text
    assert "ML Model Access (AML.T0040)" in first.text  # relative ATLAS link rewritten
    assert "Mitigations: AML.M0015 Adversarial Input Detection" in first.text
    assert "Sub-technique of AML.T0051 LLM Prompt Injection" in techniques.chunks[1].text
    assert "AML.T0051 LLM Prompt Injection: Flag inputs" in mitigations.chunks[0].text
    assert "Execution, AML.T0051.001 Indirect: The page contained" in studies.chunks[0].text


def test_nist_pdf_is_chunked_by_page():
    pdf = make_pdf(["Govern Map Measure Manage", "Trustworthy AI characteristics"])
    doc = nist_document(pdf, "https://doi.org/10.6028/NIST.AI.100-1", "NIST AI 100-1")
    assert [c.heading for c in doc.chunks] == ["Page 1", "Page 2"]
    assert "17 U.S.C. 105" in (doc.license_note or "")


def test_local_documents_and_fixtures(settings):
    docs = local_documents(settings.docs_dir)
    titles = {d.title: d for d in docs}
    assert {"Prompt injection: a primer", "Safe tool use for LLM agents"} <= set(titles)
    guide = titles["Rampart user guide"]
    assert guide.source_type == "app_docs" and guide.origin == "docs/user_guide.md"
    assert any(c.heading and "Targets" in c.heading for c in guide.chunks)
    fixtures = fixture_documents(settings.fixtures_dir)
    assert fixtures and all(d.synthetic and d.title.startswith("Fixture:") for d in fixtures)


@pytest.mark.parametrize(
    "url",
    [
        "http://raw.githubusercontent.com/x",
        "https://example.org/ATLAS.yaml",
        "https://127.0.0.1/file",
        "file:///etc/passwd",
    ],
)
def test_fetcher_refuses_hosts_outside_the_allowlist(url):
    with pytest.raises(ValueError, match="refusing to fetch"):
        asyncio.run(HttpFetcher().fetch(url))
