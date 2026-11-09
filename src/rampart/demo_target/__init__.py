"""A small loopback application Rampart's injection test suite can test against.

It is a deterministic stand-in for a document assistant, not a real LLM, so a test run is
reproducible and needs no Provider. Its one side-effecting action, ``export_document``, only
appends a clearly synthetic sentinel to a local file (the sink). The two profiles differ exactly
as the specification says: ``secure`` refuses to export internal records, ``vulnerable`` follows
an instruction found in the document. It exists to be tested, not used.
"""

from rampart.demo_target.app import INTERNAL_SENTINEL, DemoState, create_demo_target

__all__ = ["INTERNAL_SENTINEL", "DemoState", "create_demo_target"]
