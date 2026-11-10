"""G1 and G2 heuristics: injection and jailbreak patterns, and the analysis framing that tells a
question about an attack apart from an attack.

These are deliberately simple, inspectable rules. They catch common payloads and miss new ones;
the enforcement point is the Gateway (ADR 0003), so a missed payload still cannot widen policy.
Their precision and recall are measured on ``eval/guard_cases.jsonl``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_I = re.IGNORECASE


@dataclass(frozen=True)
class Rule:
    category: str
    weight: int
    regex: re.Pattern[str]


_DETERMINER = (
    r"(?:previous|prior|above|earlier|preceding|all|any|every|your|the|these|those|existing|"
    r"initial|original|system|safety|security)"
)
_HIDDEN_TARGET = (
    r"(?:hidden (?:prompt|instructions?|rules)|initial (?:prompt|instructions?)|secret (?:rules|"
    r"instructions?)|developer (?:message|prompt|instructions?)|pre-?prompt|internal (?:rules|"
    r"instructions))"
)
_SECRET_TARGET = r"(?:system prompt|system message|" + _HIDDEN_TARGET + r")"

INJECTION_RULES: tuple[Rule, ...] = (
    Rule(
        "instruction_override",
        3,
        re.compile(
            r"\b(?:ignore|disregard|forget|override|bypass|skip|abandon|drop|discard|suspend|"
            r"(?:set|put|lay|cast) aside|throw out|stop following|no longer follow)\b"
            r"[^.\n]{0,40}?\b"
            + _DETERMINER
            + r"\b[^.\n]{0,30}?\b(?:instructions?|rules?|guidelines?|prompts?|directives?|"
            r"polic(?:y|ies)|restrictions?|guardrails?|constraints?|programming|training)\b",
            _I,
        ),
    ),
    Rule(
        "context_override",
        2,
        re.compile(
            r"\b(?:ignore|disregard|forget)\s+(?:all\s+|everything\s+)?(?:of\s+)?(?:the\s+|that\s+)?"
            r"(?:above|preceding|previous|prior|earlier)\b(?!\s+(?:question|example|issue|typo|"
            r"answer|point|suggestion|message about|paragraph|sentence))",
            _I,
        ),
    ),
    Rule(
        "prompt_extraction",
        3,
        re.compile(
            r"\b(?:reveal|show|print|output|repeat|display|leak|dump|disclose|tell me|give me|copy|"
            r"paste|recite|spell out|write out|write|list|share|quote|type out)\b[^.\n]{0,40}?"
            r"\b(?:(?:your|ur)\s+(?:full\s+|"
            r"exact\s+|entire\s+|whole\s+|original\s+|initial\s+|hidden\s+|secret\s+|complete\s+)?"
            r"(?:instructions|rules|guidelines|prompt|configuration|config|system prompt)|"
            r"the\s+(?:full\s+|exact\s+|entire\s+|whole\s+|complete\s+)?(?:system prompt|system "
            r"message|hidden (?:prompt|instructions?|rules)|initial (?:prompt|instructions?)|"
            r"developer (?:message|prompt|instructions?)|pre-?prompt|confidential configuration)|"
            + _HIDDEN_TARGET
            + r")\b",
            _I,
        ),
    ),
    Rule(
        "prompt_extraction_own",
        3,
        re.compile(
            r"\b(?:what (?:is|are|would|does|do)|what's)\b[^.\n?]{0,20}\b(?:your|ur)\s+"
            r"(?:own\s+)?" + _SECRET_TARGET + r"\b",
            _I,
        ),
    ),
    Rule(
        "prompt_extraction_paraphrase",
        3,
        re.compile(
            # Naming the hidden prompt without its usual names: "the prompt that configures you",
            # "what you were told before", "everything before ... in your context".
            r"\b(?:prompt|instructions?|text|message|rules|setup)\s+(?:that|which)\s+"
            r"(?:configures?|configured|controls?|defines?|sets? up|governs?|shapes?)\s+you\b|"
            r"\b(?:what|everything|anything|all|the (?:text|words|instructions|prompt))\s+"
            r"(?:you were|you've been|you have been|you got)\s+(?:told|given|configured with|"
            r"set up with|instructed|initiali[sz]ed with|programmed with|fed)\b|"
            r"\beverything (?:before|above|preceding)\b[^.\n]{0,40}\b(?:context|prompt|"
            r"conversation|window|chat)\b|"
            r"\bfirst \d+ (?:words|lines|characters|sentences|tokens) of (?:your|ur|the) "
            r"(?:instructions|prompt|system prompt|rules|configuration)\b",
            _I,
        ),
    ),
    Rule(
        "instructions_void",
        3,
        re.compile(
            # Declaring the existing instructions void: "your previous instructions are cancelled".
            r"\b(?:your|the|all|any|my)\s+(?:(?:previous|prior|earlier|old|original|initial|"
            r"current|existing|safety|system)\s+)?(?:instructions|rules|guidelines|directives|"
            r"polic(?:y|ies)|restrictions|programming)\s+(?:are|is|have been|has been)\s+"
            r"(?:now\s+)?"
            r"(?:cancel+ed|void|revoked|lifted|removed|suspended|disabled|replaced|overridden|"
            r"null(?:ified)?|obsolete|gone|no longer (?:valid|in effect|apply|active))\b",
            _I,
        ),
    ),
    Rule(
        "new_rules",
        2,
        re.compile(
            r"\bnew (?:rules|instructions|directives|policy|role|persona)\s*[:\-]",
            _I,
        ),
    ),
    Rule(
        "obedience",
        2,
        re.compile(
            r"\byou (?:will |must |shall |now |should )?(?:comply with|obey|do|follow|agree to) "
            r"(?:anything|everything|whatever|all)\b[^.\n]{0,20}\b(?:i|we) (?:say|ask|tell|want|"
            r"request|write)\b|"
            r"\b(?:no refusals?|never refuse|without refusing|don'?t refuse|do not refuse)\b",
            _I,
        ),
    ),
    Rule(
        "execute_quoted",
        3,
        re.compile(
            # Wrapping an attack in quotes and asking for it to be carried out.
            r"(?:^|[.!?:;,]\s*|\b(?:then|and|please|also|just)\s+)(?:do|follow|obey|execute|"
            r"carry out|act on|comply with)\s+(?:what|whatever|everything|all)\s+(?:it|this|that|"
            r"they|the (?:text|message|email|document|note|quote|string|line))\s+(?:says|asks|"
            r"tells you|requests|instructs|wants)\b",
            _I | re.MULTILINE,
        ),
    ),
    Rule(
        "role_abandon",
        2,
        re.compile(
            r"\bstop (?:being|acting as|pretending to be|playing) (?:an?|the|my|your) \w+|"
            r"\b(?:from (?:this (?:moment|point)(?: on)?|here on)|starting now|as of now|"
            r"henceforth),?\s+you\b",
            _I,
        ),
    ),
    Rule(
        "role_override",
        2,
        re.compile(
            r"\byou are (?:now|no longer)\b|\bfrom now on,? you (?:are|will|must|shall)\b|"
            r"\bstop (?:being|acting as|pretending to be)\b|\byou are\s+(?:now\s+)?(?:DAN|STAN|"
            r"DUDE|AIM)\b",
            _I,
        ),
    ),
    Rule(
        "unrestricted_persona",
        3,
        re.compile(
            r"\b(?:act|behave|respond|answer|reply|pretend|role-?play|speak)\b[^.\n]{0,25}?\b"
            r"(?:as|to be|like)\b[^.\n]{0,15}?\b(?:unfiltered|uncensored|unrestricted|jailbroken|"
            r"evil|rogue|amoral|unaligned|lawless)\b|"
            r"\b(?:as an?|like an?|pretend (?:to be|you are|you're)|you are|simulate an?|"
            r"emulate an?|impersonate an?|play an?|become an?)\b[^.\n]{0,30}"
            r"\b(?:ai|assistant|model|chatbot|bot|llm)\b[^.\n]{0,40}"
            r"\b(?:without|with no|with zero|free of|that ignores|"
            r"that has no|who has no)\b"
            r"[^.\n]{0,15}"
            r"\b(?:restrictions|limits|filters|guidelines|safety|rules|ethics|policies)\b|"
            r"\b(?:if you had|imagine you had|pretend you had|assume you have|suppose you had) no "
            r"(?:restrictions|rules|limits|filters|guidelines)\b",
            _I,
        ),
    ),
    Rule(
        "jailbreak_persona",
        2,
        re.compile(
            r"\b(?:do(?:es)? anything now|developer mode|jailbreak(?:ed)?|god mode|no[- ]limits? "
            r"mode|unrestricted mode|evil (?:mode|confidant|twin))\b",
            _I,
        ),
    ),
    Rule("jailbreak_persona", 2, re.compile(r"\bDAN\b")),
    Rule(
        "mode_switch",
        3,
        re.compile(
            r"\b(?:enable|enter|activate|switch to|turn on|unlock|go into)\b[^.\n]{0,20}?"
            r"\b(?:developer|"
            r"jailbreak|god|dan|unrestricted|unfiltered|admin|debug|no[- ]limits?|evil)\s+mode\b",
            _I,
        ),
    ),
    Rule(
        "no_restrictions",
        2,
        re.compile(
            r"\b(?:without|with no|with zero|free of|ignoring|ignore) (?:any |all |your )?"
            r"(?:content |safety )?(?:restrictions|limits|limitations|filters|guidelines|safety|"
            r"censorship|rules|ethics|polic(?:y|ies))\b|"
            r"\byou (?:now )?(?:have|got) no (?:\w+ )?(?:rules|restrictions|limits|filters|"
            r"guidelines|policies|ethics)\b",
            _I,
        ),
    ),
    Rule(
        "fake_role_tag",
        2,
        re.compile(
            r"(?m)^[^\S\n]*+(?:system|assistant|developer)\s*+:|<\|?(?:system|im_start|im_end|"
            r"endoftext)\|?>|\[/?(?:INST|SYS)\]|<</?SYS>>|</?system>",
            _I,
        ),
    ),
    Rule(
        "system_banner",
        2,
        re.compile(
            r"\b(?:system|admin|developer|root)\s+(?:override|command|access granted)\b", _I
        ),
    ),
    Rule(
        "disable_safety",
        2,
        re.compile(
            r"\b(?:disable|turn off|deactivate|remove|bypass|lift|switch off)\b[^.\n]{0,30}?\b"
            r"(?:safety|security|guard(?:rail)?s?|filters?|restrictions|rules|policies|checks|"
            r"input guard|gateway|moderation)\b",
            _I,
        ),
    ),
    Rule(
        "exfiltration",
        3,
        re.compile(
            r"\b(?:send|post|upload|exfiltrate|forward|transmit|leak|email|append)\b[^.\n]{0,60}?"
            r"\b(?:to|at|via|into)\b[^.\n]{0,40}?"
            r"(?:https?://|webhook|attacker|!\[|\b[\w.-]+@[\w-]+\.[a-z]{2,})",
            _I,
        ),
    ),
    Rule(
        "secret_request",
        3,
        re.compile(
            r"\b(?:send|give|show|tell|list|print|reveal)\s+me\b[^.\n]{0,25}?\b(?:api keys?|keys|"
            r"tokens|passwords|credentials|secrets|env(?:ironment)? variables)\b[^.\n]{0,30}?"
            r"\b(?:you|your)\b",
            _I,
        ),
    ),
    Rule(
        "tool_abuse_url",
        3,
        re.compile(
            r"\b(?:call|use|run|invoke|execute|trigger|start)\b[^.\n]{0,30}?"
            r"\b(?:run_injection_test|lookup_vulnerabilities|generate_report|analyze_prompt|"
            r"search_knowledge|the tool|a tool|your tools?|injection tests?)\b[^.\n]{0,60}?"
            r"https?://",
            _I,
        ),
    ),
    Rule(
        "tool_abuse",
        2,
        re.compile(
            r"\b(?:call|use|run|invoke|execute|trigger|start)\b[^.\n]{0,30}?"
            r"\b(?:run_injection_test|lookup_vulnerabilities|generate_report|analyze_prompt|"
            r"search_knowledge|the tool|a tool|your tools?|injection tests?)\b[^.\n]{0,60}?"
            r"(?:\bagainst\b|\bon (?:host|server|domain)\b)",
            _I,
        ),
    ),
    Rule(
        "encoded_payload",
        3,
        re.compile(
            r"\b(?:decode|base64|rot13|hex|reverse)\b[^.\n]{0,40}?\b(?:and|then)\b[^.\n]{0,25}?"
            r"\b(?:follow|execute|run|obey|do what|carry out|act on)\b",
            _I,
        ),
    ),
    Rule(
        "authority_claim",
        2,
        re.compile(
            r"\b(?:i am|i'm|this is) (?:your|the|an?) (?:\w+ )?(?:developer|administrator|admin|"
            r"creator|owner|system|operator)\b[^\n]{0,80}?\b(?:override|unlock|disable|grant|"
            r"authori[sz]e|allow|permit|bypass)",
            _I,
        ),
    ),
)

# Matches aimed at Rampart itself are not excused by question words, only by quoting.
DIRECT_CATEGORIES = frozenset(
    {"prompt_extraction_own", "secret_request", "mode_switch", "execute_quoted"}
)

# Text in documents or Tool output that speaks to an AI is suspicious in itself (G2 only).
AI_DIRECTED = Rule(
    "ai_directed_instruction",
    3,
    re.compile(
        r"\b(?:note|message|instructions?|attention) (?:to|for) (?:the |all |any )?"
        r"(?:ai|assistants?|chatbots?|language models?|llms?|models?|agents?)\b|"
        r"\b(?:ai|assistants?|chatbots?|llms?|language models?|ai agents?)\b[^.\n]{0,25}?"
        r"\b(?:must|should|are instructed to|need to|have to|shall)\b",
        _I,
    ),
)

ANALYSIS_CUES = re.compile(
    r"\b(?:analy[sz]e|analysis|review|audit|classify|categori[sz]e|detect(?:ion|ing|s)?|"
    r"is this|is it|does this|could this|would this|examples?|how (?:do|would|could|can|might|"
    r"does) (?:an? )?(?:attackers?|adversar(?:y|ies)|someone|people|hackers?|this|it)|"
    r"what (?:is|are|does|do)|explain|meaning|means|why (?:does|do|would|is)|test cases?|"
    r"payloads?|red[- ]team(?:ing)?|mitigat\w*|defen[cd]\w*|protect\w* against|prevent\w*|"
    r"guard(?:rail)?s? against|filter\w*|sanitiz\w*|threat model\w*|owasp|atlas|"
    r"injection attacks?|recogni[sz]e|spot|flag)\b",
    _I,
)

# An imperative at the start of a line or after sentence punctuation. Written so that each run of
# whitespace is scanned once: "(?:^|[.!?:;]\s+|\n)\s*" split a run between two quantifiers and
# restarted at every newline of a run, which made one message of blank lines cost seconds.
DIRECT_IMPERATIVE = re.compile(
    r"(?:^[^\S\n]*+|[.!?:;]\s++)(?:now\s++|please\s++|ok(?:ay)?,?\s++|then\s++|and\s++)?"
    r"(?:ignore|disregard|forget|override|bypass|reveal|print|show me|output|repeat|dump|"
    r"tell me your|give me your|send|forward|upload|email|append|post|exfiltrate|call|run|invoke|"
    r"use your tools?|act as|pretend|you are now|from now on|do it|do this|enter|switch to|"
    r"enable)\b",
    _I | re.MULTILINE,  # "^" is every line start, which replaces the old "\n" alternative
)

# Addresses and domains start where their run of characters starts (the lookbehinds): starting at
# every word boundary inside "a-a-a-..." rescanned the run each time.
_ADDRESSES = re.compile(
    r"https?://\S+|(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?<![\w-])[\w-]+(?:\.[\w-]+)+\b"
)


def asks_about(text: str) -> bool:
    """Question or analysis words, ignoring URLs, addresses and domains ("example.org")."""
    return bool(ANALYSIS_CUES.search(_ADDRESSES.sub(" ", text)))


_QUOTED = re.compile(
    r"```[\s\S]*?```|`[^`\n]+`|\"[^\"\n]{3,}\"|“[^”\n]{3,}”|'[^'\n]{12,}'|^>.*$",
    re.MULTILINE,
)
_TAG_CHARS = re.compile("[\U000e0000-\U000e007f]")
_ZERO_WIDTH = re.compile("[​-‏⁠﻿]")
_BASE64_BLOB = re.compile(r"[A-Za-z0-9+/]{160,}={0,2}")


@dataclass(frozen=True)
class Match:
    category: str
    weight: int
    start: int
    end: int
    snippet: str


_LEET = str.maketrans(
    {"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"}
)
_SPACED_GROUP = re.compile(r"(?:\b\w\b[ \t]){3,}\b\w\b")


def normalise(text: str) -> str:
    """Undo common obfuscation: leetspeak digits and letters spaced out one by one."""
    collapsed = _SPACED_GROUP.sub(lambda m: m.group(0).replace(" ", "").replace("\t", ""), text)
    words = re.split(r"(\s+)", collapsed)
    return "".join(w.translate(_LEET) if any(c.isalpha() for c in w) else w for w in words)


def find_matches(text: str, rules: tuple[Rule, ...] = INJECTION_RULES) -> list[Match]:
    found: list[Match] = []
    for rule in rules:
        for m in rule.regex.finditer(text):
            lo, hi = max(0, m.start() - 40), min(len(text), m.end() + 40)
            snippet = " ".join(text[lo:hi].split())
            found.append(Match(rule.category, rule.weight, m.start(), m.end(), snippet[:200]))
    normalised = normalise(text)
    if normalised != text:  # obfuscated matches have no position in the original text
        seen = {m.category for m in found}
        for rule in rules:
            if rule.category in seen:
                continue
            m = rule.regex.search(normalised)
            if m is not None:
                snippet = f"(deobfuscated) {m.group(0)}"[:200]
                found.append(Match(rule.category, rule.weight, -1, -1, snippet))
    return found


def score(matches: list[Match]) -> int:
    best: dict[str, int] = {}
    for match in matches:
        best[match.category] = max(best.get(match.category, 0), match.weight)
    return sum(best.values())


def quoted_spans(text: str) -> list[tuple[int, int]]:
    return [m.span() for m in _QUOTED.finditer(text)]


def all_quoted(matches: list[Match], spans: list[tuple[int, int]]) -> bool:
    return bool(matches) and all(
        m.start >= 0 and any(lo <= m.start and m.end <= hi for lo, hi in spans) for m in matches
    )


def hidden_text_weight(text: str) -> int:
    weight = 0
    if _TAG_CHARS.search(text):
        weight += 3  # Unicode tag characters carry invisible ASCII ("ASCII smuggling")
    if len(_ZERO_WIDTH.findall(text)) >= 4:
        weight += 1
    if _BASE64_BLOB.search(text):
        weight += 1
    return weight


def strip_invisible(text: str) -> str:
    return _ZERO_WIDTH.sub("", _TAG_CHARS.sub("", text))
