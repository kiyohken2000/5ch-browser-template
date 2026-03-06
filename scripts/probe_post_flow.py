import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, Optional
from urllib.parse import urljoin

import requests

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / "apps" / "desktop" / ".env.local"
REPORT_PATH = ROOT / "docs" / "POST_FLOW_PROBE_2026-03-07.json"
UA = "Mozilla/5.0 (compatible; 5ch-browser-template-post-probe/0.1)"
TIMEOUT = 20
THREAD_URL = "https://mao.5ch.io/test/read.cgi/ngt/9240230711/"


@dataclass
class PostFlowResult:
    mode: str
    thread_get_status: int
    form_action: Optional[str]
    form_method: Optional[str]
    form_input_names: list[str]
    hidden_input_names: list[str]
    post_status: Optional[int]
    post_location: Optional[str]
    response_cookie_names: list[str]
    session_cookie_names: list[str]
    response_markers: list[str]
    note: str


def load_env_file(path: Path) -> Dict[str, str]:
    env: Dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def find_post_form(html: str) -> tuple[Optional[str], Optional[str], dict[str, str], list[str], list[str]]:
    form_match = re.search(r"<form[^>]*action=[^>]*test/bbs\.cgi[^>]*>(.*?)</form>", html, re.IGNORECASE | re.DOTALL)
    if not form_match:
        return None, None, {}, [], []

    form_html = form_match.group(0)
    action_match = re.search(r'action=["\']([^"\']+)["\']', form_html, re.IGNORECASE)
    method_match = re.search(r'method=["\']([^"\']+)["\']', form_html, re.IGNORECASE)

    payload: dict[str, str] = {}
    input_names: list[str] = []
    hidden_names: list[str] = []
    for m in re.finditer(r"<input[^>]*>", form_html, re.IGNORECASE):
        tag = m.group(0)
        name_match = re.search(r'name=["\']([^"\']+)["\']', tag, re.IGNORECASE)
        if not name_match:
            continue
        name = name_match.group(1)
        input_names.append(name)
        type_match = re.search(r'type=["\']([^"\']+)["\']', tag, re.IGNORECASE)
        input_type = type_match.group(1).lower() if type_match else "text"
        value_match = re.search(r'value=["\']([^"\']*)["\']', tag, re.IGNORECASE)
        value = value_match.group(1) if value_match else ""
        if input_type == "hidden":
            payload[name] = value
            hidden_names.append(name)

    # Add required visible fields with safe values; MESSAGE empty to avoid posting.
    payload.setdefault("FROM", "")
    payload.setdefault("mail", "")
    payload.setdefault("MESSAGE", "")
    payload.setdefault("submit", "書き込む")

    return (
        action_match.group(1) if action_match else None,
        (method_match.group(1).upper() if method_match else "POST"),
        payload,
        sorted(set(input_names)),
        sorted(set(hidden_names)),
    )


def marker_scan(text: str) -> list[str]:
    markers = []
    table = {
        "confirm": r"書き込み確認|確認画面|confirm",
        "error": r"ERROR|ＥＲＲＯＲ|エラー|本文がありません|書き込み",
        "done": r"書きこみました|投稿しました|完了",
        "login": r"UPLIFT|BE|ログイン",
        "mona_ticket": r"MonaTicket",
    }
    for key, pat in table.items():
        if re.search(pat, text, re.IGNORECASE):
            markers.append(key)
    return markers


def uplift_login(session: requests.Session, env: Dict[str, str]) -> None:
    if not env.get("UPLIFT_EMAIL") or not env.get("UPLIFT_PASSWORD"):
        return
    login_url = "https://uplift.5ch.io/login"
    r = session.get(login_url, timeout=TIMEOUT)
    form_action = "/log"
    m = re.search(r'action=["\']([^"\']+)["\']', r.text, re.IGNORECASE)
    if m:
        form_action = m.group(1)
    payload = {
        "usr": env["UPLIFT_EMAIL"],
        "pwd": env["UPLIFT_PASSWORD"],
    }
    session.post(urljoin(login_url, form_action), data=payload, timeout=TIMEOUT, allow_redirects=True)


def be_front_login(session: requests.Session, env: Dict[str, str]) -> None:
    if not env.get("BE_EMAIL") or not env.get("BE_PASSWORD"):
        return
    login_url = "https://5ch.io/_login"
    r = session.get(login_url, timeout=TIMEOUT)
    m = re.search(r'name="unique_regs"\s+value="([^"]+)"', r.text, re.IGNORECASE)
    if not m:
        return

    payload = {
        "unique_regs": m.group(1),
        "umail": env["BE_EMAIL"],
        "pword": env["BE_PASSWORD"],
        "login_be_normal_user": "ログイン",
    }
    session.post(login_url, data=payload, timeout=TIMEOUT, allow_redirects=True)


def run_probe(mode: str, session: requests.Session) -> PostFlowResult:
    get_resp = session.get(THREAD_URL, timeout=TIMEOUT)
    action, method, payload, input_names, hidden_names = find_post_form(get_resp.text)

    post_status = None
    post_location = None
    response_cookie_names: list[str] = []
    markers: list[str] = []
    note = ""

    if action and method == "POST":
        post_url = urljoin(THREAD_URL, action)
        post_resp = session.post(post_url, data=payload, timeout=TIMEOUT, allow_redirects=False)
        post_status = post_resp.status_code
        post_location = post_resp.headers.get("Location")
        response_cookie_names = list(post_resp.cookies.keys())
        body = post_resp.text

        # One-hop follow for marker detection only.
        if post_location:
            follow = session.get(urljoin(post_url, post_location), timeout=TIMEOUT)
            body = follow.text

        markers = marker_scan(body)
        note = "empty MESSAGE used to avoid actual post"
    else:
        note = "posting form not found"

    return PostFlowResult(
        mode=mode,
        thread_get_status=get_resp.status_code,
        form_action=action,
        form_method=method,
        form_input_names=input_names,
        hidden_input_names=hidden_names,
        post_status=post_status,
        post_location=post_location,
        response_cookie_names=response_cookie_names,
        session_cookie_names=sorted({c.name for c in session.cookies}),
        response_markers=markers,
        note=note,
    )


def main() -> int:
    env = load_env_file(ENV_PATH)

    anon = requests.Session()
    anon.headers.update({"User-Agent": UA})

    uplift = requests.Session()
    uplift.headers.update({"User-Agent": UA})
    uplift_login(uplift, env)

    be_front = requests.Session()
    be_front.headers.update({"User-Agent": UA})
    be_front_login(be_front, env)

    results = [
        run_probe("anonymous", anon),
        run_probe("uplift_logged_in", uplift),
        run_probe("be_front_logged_in", be_front),
    ]

    report = {
        "executed_at": __import__("datetime").datetime.now().isoformat(),
        "thread_url": THREAD_URL,
        "result": [asdict(x) for x in results],
        "notes": [
            "credentials are never printed",
            "cookie values are omitted",
            "probe uses empty MESSAGE to avoid actual posting",
        ],
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    for r in results:
        print(
            f"[{r.mode}] get={r.thread_get_status} post={r.post_status} "
            f"loc={r.post_location} markers={','.join(r.response_markers) if r.response_markers else '(none)'} "
            f"cookies={','.join(r.session_cookie_names) if r.session_cookie_names else '(none)'}"
        )
    print(f"WROTE: {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
