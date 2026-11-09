"""``python -m rampart.eval run <run id>...``: execute evaluation runs the admin page queued.

The web server starts this as a separate process, so DeepEval never loads inside the server.
"""

from __future__ import annotations

import argparse
import sys

from rampart.config import load_settings
from rampart.eval.service import EvalService


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m rampart.eval")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="execute queued evaluation runs")
    run.add_argument("run_ids", nargs="+")
    args = parser.parse_args(argv)
    service = EvalService.from_settings(load_settings())
    failed = 0
    for run_id in args.run_ids:
        try:
            row = service.execute(run_id, progress=print)
            print(f"{run_id}: done, report {row.report_path}", flush=True)
        except Exception as exc:  # the run row records the failure; carry on with the next
            failed += 1
            print(f"{run_id}: failed: {type(exc).__name__}: {exc}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
