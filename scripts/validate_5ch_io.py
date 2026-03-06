import json
import re
import sys
from typing import Iterable, List, Tuple
from urllib.parse import urlparse

import requests

BBSMENU_URL = "https://menu.5ch.io/bbsmenu.json"
USER_AGENT = "Mozilla/5.0 (compatible; pre-impl-validator/0.1)"
TIMEOUT = 15


def normalize_5ch_url(url: str) -> str:
    return re.sub(r"(^https?://[^/]*?)5ch\.net", r"\g<1>5ch.io", url)


def flatten_urls(obj) -> Iterable[str]:
    if isinstance(obj, dict):
        for _, value in obj.items():
            if isinstance(value, str) and value.startswith(("http://", "https://")):
                yield value
            else:
                yield from flatten_urls(value)
    elif isinstance(obj, list):
        for item in obj:
            yield from flatten_urls(item)


def collect_board_candidates(menu_data: dict, limit: int = 5) -> List[str]:
    candidates = []
    for raw in flatten_urls(menu_data):
        normalized = normalize_5ch_url(raw)
        parsed = urlparse(normalized)
        if not parsed.netloc.endswith("5ch.io"):
            continue
        if normalized.endswith((".json", ".txt", ".php", ".cgi")):
            continue
        if normalized not in candidates:
            candidates.append(normalized.rstrip("/") + "/")
        if len(candidates) >= limit:
            break
    return candidates


def fetch(session: requests.Session, url: str) -> Tuple[int, str]:
    response = session.get(url, timeout=TIMEOUT)
    return response.status_code, response.text


def check_subject(session: requests.Session, board_url: str) -> Tuple[bool, str]:
    subject_url = board_url.rstrip("/") + "/subject.txt"
    try:
        status, body = fetch(session, subject_url)
        if status == 200 and body.strip():
            first_line = body.splitlines()[0][:120] if body.splitlines() else ""
            return True, f"OK {status} {subject_url} first_line={first_line}"
        return False, f"NG {status} {subject_url} body_len={len(body)}"
    except requests.RequestException as exc:
        return False, f"ERR {subject_url} {exc}"


def main() -> int:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    print("[1/4] Fetch bbsmenu.json")
    try:
        status, body = fetch(session, BBSMENU_URL)
    except requests.RequestException as exc:
        print(f"FAILED: {BBSMENU_URL} {exc}")
        return 1

    if status != 200:
        print(f"FAILED: {BBSMENU_URL} status={status}")
        return 1

    print(f"OK: {BBSMENU_URL} status={status} bytes={len(body)}")

    print("[2/4] Parse menu JSON")
    try:
        menu_data = json.loads(body)
    except json.JSONDecodeError as exc:
        print(f"FAILED: invalid json {exc}")
        return 1

    print("OK: JSON parsed")

    print("[3/4] Collect board candidates")
    candidates = collect_board_candidates(menu_data, limit=5)
    if not candidates:
        print("FAILED: no board candidates found in menu json")
        return 1

    for idx, board in enumerate(candidates, start=1):
        print(f"candidate[{idx}] {board}")

    print("[4/4] Check subject.txt on candidates")
    ok_count = 0
    for board in candidates:
        ok, message = check_subject(session, board)
        print(message)
        if ok:
            ok_count += 1

    print(f"RESULT: {ok_count}/{len(candidates)} boards returned subject.txt")
    if ok_count == 0:
        print("FAILED: no subject.txt success; investigate network/auth/domain assumptions")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

