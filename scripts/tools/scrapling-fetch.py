#!/usr/bin/env python3
"""Render one public page with Scrapling and write its HTML to stdout.

This helper deliberately exposes no cookies, credentials, proxy settings,
stealth mode, or challenge-solving options. URL policy is enforced by the
TypeScript caller before this process starts.
"""

from __future__ import annotations

import json
import os
import sys

from scrapling.fetchers import DynamicFetcher


MAX_OUTPUT_BYTES = 10 * 1024 * 1024


def main() -> int:
    with_metadata = len(sys.argv) == 3 and sys.argv[1] == "--metadata"
    if not ((len(sys.argv) == 2 and sys.argv[1] != "--metadata") or with_metadata):
        print("usage: scrapling-fetch.py [--metadata] <public-url>", file=sys.stderr)
        return 2

    target = sys.argv[2] if with_metadata else sys.argv[1]
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", ".tools/browsers")
    response = DynamicFetcher.fetch(
        target,
        headless=True,
        network_idle=True,
        disable_resources=True,
        timeout=30_000,
    )
    html = response.html_content
    encoded = html.encode("utf-8")
    if len(encoded) > MAX_OUTPUT_BYTES:
        print(f"rendered page exceeds {MAX_OUTPUT_BYTES} bytes", file=sys.stderr)
        return 3
    if with_metadata:
        history = [
            {"url": str(item.url), "status": int(item.status)}
            for item in (response.history or [])
        ]
        data = json.dumps({
            "html": html,
            "finalUrl": str(response.url),
            "status": int(response.status),
            "history": history,
        }, ensure_ascii=False).encode("utf-8")
        if len(data) > MAX_OUTPUT_BYTES:
            print(f"rendered response exceeds {MAX_OUTPUT_BYTES} bytes", file=sys.stderr)
            return 3
        sys.stdout.buffer.write(data)
    else:
        sys.stdout.buffer.write(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
