#!/usr/bin/env python3
"""Smoke test: one Telugu urgent-request sentence through a running service.

    python smoke_test.py                       # against http://127.0.0.1:8099
    python smoke_test.py http://127.0.0.1:9000

Prints the raw /health and /decide bodies, so the evidence in a report is the bytes that came
back and not a summary of them. Exits non-zero if /decide did not return a decision.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

# Telugu, urgent, crop-stress, release-time: "The paddy crop is drying up, there is no water in
# the channel. Send water immediately, my crop will die." Mirrors the phrasing the rules tier
# matches in apps/api/src/system1.rules.ts (ఎండిపో / నీళ్లు లేవు / వెంటనే).
TELUGU_URGENT = (
    "నా వరి పంట ఎండిపోతుంది, కాలువలో నీళ్లు లేవు. "
    "వెంటనే నీరు పంపండి, పంట చనిపోతుంది."
)


def call(url: str, payload: dict | None = None) -> tuple[int, dict, float]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"content-type": "application/json"} if data else {},
        method="POST" if data else "GET",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            body = json.loads(response.read().decode("utf-8"))
            status = response.status
    except urllib.error.HTTPError as exc:
        body = json.loads(exc.read().decode("utf-8"))
        status = exc.code
    return status, body, (time.perf_counter() - started) * 1000.0


def main() -> int:
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8099").rstrip("/")

    status, health, wall = call(base + "/health")
    print("GET /health  -> HTTP %d  (wall %.0f ms)" % (status, wall))
    print(json.dumps(health, ensure_ascii=False, indent=2))
    if not health.get("ok"):
        print("\n/health is not ok; skipping /decide (the service must refuse, not guess).")
        return 1

    print("\nPOST /decide text=%r" % TELUGU_URGENT)
    status, decision, wall = call(base + "/decide", {"text": TELUGU_URGENT})
    print("POST /decide -> HTTP %d  (wall %.0f ms)" % (status, wall))
    print(json.dumps(decision, ensure_ascii=False, indent=2))
    return 0 if status == 200 and decision.get("source") == "laya" else 1


if __name__ == "__main__":
    raise SystemExit(main())
