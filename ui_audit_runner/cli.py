from __future__ import annotations

import argparse
import sys
from typing import Optional, Sequence

from .runtime import RunOptions, load_audit_script, run_spec


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ui-audit", description="基于 Python 脚本的 UI 自动化审计工具")
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="运行一个审计脚本")
    run_parser.add_argument("script", help="Python 审计脚本路径")
    run_parser.add_argument("--output", help="JSON 报告输出路径")
    run_parser.add_argument("--headed", action="store_true", help="使用有头浏览器运行")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command != "run":
        parser.print_help()
        return 1

    try:
        spec = load_audit_script(args.script)
        run_spec(
            spec,
            RunOptions(
                script_path=args.script,
                output_path=args.output,
                headless=not args.headed,
            ),
        )
        return 0
    except Exception as exc:
        print("ui-audit 运行失败: {0}".format(exc), file=sys.stderr)
        return 1
