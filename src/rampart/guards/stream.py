"""G4 for streamed answers: redact secrets before a delta reaches the browser.

Text is held back only as long as it could still turn into a secret: the last (possibly
partial) token, a credential keyword whose value has not finished arriving, and an open
private-key block. Everything before that is redacted and released, so the browser and the
stored message see exactly the same, redacted, text.
"""

from __future__ import annotations

import re
from collections import Counter

from rampart.guards.secrets import CREDENTIAL_TAIL, redact

_LAST_TOKEN = re.compile(r"\S+$")
_PEM_END = re.compile(r"-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----")
MAX_HOLD = 8000  # never hold more than this (a 4096-bit RSA key is about 3.2 kB)


class StreamingRedactor:
    def __init__(self) -> None:
        self._buffer = ""
        self.counts: Counter[str] = Counter()
        self.released: list[str] = []

    def _cut(self) -> int:
        buffer = self._buffer
        token = _LAST_TOKEN.search(buffer)
        cut = token.start() if token else len(buffer)
        tail = CREDENTIAL_TAIL.search(buffer[max(0, cut - 160) :])
        if tail is not None:
            cut = min(cut, max(0, cut - 160) + tail.start())
        begin = buffer.rfind("-----BEGIN")
        if begin != -1:
            end = _PEM_END.search(buffer, begin)
            if end is None:
                cut = min(cut, begin)  # a key block is open: hold it whole
            elif begin < cut < end.end():
                cut = end.end()  # never cut inside a complete block, or redaction cannot match
        if len(buffer) - cut > MAX_HOLD:
            cut = len(buffer) - MAX_HOLD
        return cut

    def feed(self, text: str) -> str:
        self._buffer += text
        cut = self._cut()
        out, self._buffer = self._buffer[:cut], self._buffer[cut:]
        return self._release(out)

    def flush(self) -> str:
        out, self._buffer = self._buffer, ""
        return self._release(out)

    def _release(self, text: str) -> str:
        if not text:
            return ""
        result = redact(text)
        self.counts.update(result.counts)
        self.released.append(result.text)
        return result.text

    @property
    def text(self) -> str:
        return "".join(self.released)
