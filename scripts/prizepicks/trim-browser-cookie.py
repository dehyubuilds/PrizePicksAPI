#!/usr/bin/env python3
"""Trim a PrizePicks Cookie header to bot-protection essentials (under Netlify 5k limit).

Usage:
  pbpaste | python3 scripts/prizepicks/trim-browser-cookie.py
  python3 scripts/prizepicks/trim-browser-cookie.py < cookie.txt
  python3 scripts/prizepicks/trim-browser-cookie.py --file ~/cookie.txt

Output: trimmed cookie on stdout; copy into Netlify PRIZEPICKS_BROWSER_COOKIE
        or Settings → PrizePicks → Save cookie to server.
"""

from __future__ import annotations

import argparse
import sys

# Order matters for readability; only these names are kept.
ESSENTIAL_NAMES = [
    "__cf_bm",
    "_cfuvid",
    "cf_clearance",
    "_pxvid",
    "_px3",
    "pxcts",
    "__ps_did",
    "__ps_fva",
    "__ps_sr",
    "__ps_slu",
    "datadome",
    "_swb",
    # Login session — include if present (often needed with bot cookies)
    "CSRF-TOKEN",
    "remember_user_token",
    "pp_uuid",
    "_prizepicks_session",
]


def parse_cookie(raw: str) -> dict[str, str]:
    text = raw.strip()
    if text.lower().startswith("cookie:"):
        text = text.split(":", 1)[1].strip()
    pairs: dict[str, str] = {}
    for part in text.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        name = name.strip()
        if name:
            pairs[name] = value.strip()
    return pairs


def trim_cookie(raw: str) -> str:
    pairs = parse_cookie(raw)
    if not pairs:
        raise SystemExit("error: no cookie pairs found — paste the full Cookie header value.")

    parts: list[str] = []
    for name in ESSENTIAL_NAMES:
        if name in pairs:
            parts.append(f"{name}={pairs[name]}")

    if not parts:
        raise SystemExit(
            "error: none of the essential bot-protection cookies were found. "
            "Copy Cookie from a logged-in app.prizepicks.com /projections request."
        )

    return "; ".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description="Trim PrizePicks browser cookie for Netlify/S3.")
    parser.add_argument(
        "--file",
        "-f",
        help="Read cookie from a file instead of stdin",
    )
    parser.add_argument(
        "--quiet",
        "-q",
        action="store_true",
        help="Only print trimmed cookie (no stats)",
    )
    args = parser.parse_args()

    if args.file:
        with open(args.file, encoding="utf-8") as f:
            raw = f.read()
    else:
        raw = sys.stdin.read()

    full_len = len(raw.strip())
    trimmed = trim_cookie(raw)
    trimmed_len = len(trimmed)

    if not args.quiet:
        print(f"Full input: {full_len:,} chars", file=sys.stderr)
        print(f"Trimmed:    {trimmed_len:,} chars", file=sys.stderr)
        if trimmed_len > 5000:
            print("warn: still over Netlify 5,000 limit — use Settings → PrizePicks S3 paste instead.", file=sys.stderr)
        else:
            print("ok: fits Netlify PRIZEPICKS_BROWSER_COOKIE", file=sys.stderr)
        print(file=sys.stderr)

    print(trimmed)


if __name__ == "__main__":
    main()
