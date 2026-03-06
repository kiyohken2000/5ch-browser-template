import json
import os
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, Optional
from urllib.parse import urljoin

import requests

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / "apps" / "desktop" / ".env.local"
REPORT_PATH = ROOT / "docs" / "BE_UPLIFT_AUTH_PROBE_2026-03-07.json"
TIMEOUT = 20
UA = "Mozilla/5.0 (compatible; 5ch-browser-template-auth-probe/0.1)"


@dataclass
class LoginProbeResult:
    service: str
    login_url: str
    form_action: Optional[str]
    form_method: Optional[str]
    get_status: int
    post_status: Optional[int]
    location: Optional[str]
    response_cookie_names: list[str]
    session_cookie_names: list[str]
    page_indicator_after_login: Optional[str]
    likely_logged_in: bool
    note: str


def load_env_file(path: Path) -> Dict[str, str]:
    data: Dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        data[key.strip()] = val.strip()
    return data


def detect_form(html: str) -> tuple[Optional[str], Optional[str], Dict[str, str]]:
    form_match = re.search(r"<form[^>]*>(.*?)</form>", html, re.IGNORECASE | re.DOTALL)
    if not form_match:
        return None, None, {}

    form_tag_start = html[: form_match.start()] + html[form_match.start() : form_match.start() + 300]
    action_match = re.search(r'action=["\']([^"\']+)["\']', form_tag_start, re.IGNORECASE)
    method_match = re.search(r'method=["\']([^"\']+)["\']', form_tag_start, re.IGNORECASE)

    hidden_inputs: Dict[str, str] = {}
    for m in re.finditer(r"<input[^>]*>", form_match.group(1), re.IGNORECASE):
        tag = m.group(0)
        type_match = re.search(r'type=["\']([^"\']+)["\']', tag, re.IGNORECASE)
        name_match = re.search(r'name=["\']([^"\']+)["\']', tag, re.IGNORECASE)
        value_match = re.search(r'value=["\']([^"\']*)["\']', tag, re.IGNORECASE)
        input_type = (type_match.group(1).lower() if type_match else "text")
        if input_type == "hidden" and name_match:
            hidden_inputs[name_match.group(1)] = value_match.group(1) if value_match else ""

    return (
        action_match.group(1) if action_match else None,
        method_match.group(1).upper() if method_match else "GET",
        hidden_inputs,
    )


def probe_login(
    service: str,
    login_url: str,
    username_field: str,
    password_field: str,
    username: str,
    password: str,
) -> LoginProbeResult:
    session = requests.Session()
    session.headers.update({"User-Agent": UA})

    get_resp = session.get(login_url, timeout=TIMEOUT)
    action, method, hidden = detect_form(get_resp.text)
    post_url = urljoin(login_url, action or login_url)

    payload = dict(hidden)
    payload[username_field] = username
    payload[password_field] = password

    post_status: Optional[int] = None
    location: Optional[str] = None
    response_cookie_names: list[str] = []
    page_indicator_after_login: Optional[str] = None
    likely_logged_in = False
    note = ""

    if method == "POST":
        post_resp = session.post(post_url, data=payload, timeout=TIMEOUT, allow_redirects=False)
        post_status = post_resp.status_code
        location = post_resp.headers.get("Location")
        response_cookie_names = list(post_resp.cookies.keys())

        # Follow one hop if redirected.
        follow_resp = None
        if location:
            follow_resp = session.get(urljoin(post_url, location), timeout=TIMEOUT)
            text = follow_resp.text
        else:
            text = post_resp.text

        if re.search(r"ログアウト|Logout|マイページ|mypage|会員情報", text, re.IGNORECASE):
            page_indicator_after_login = "logout_or_mypage_marker_found"
            likely_logged_in = True
        elif re.search(r"ログイン", text, re.IGNORECASE):
            page_indicator_after_login = "login_marker_found"
            likely_logged_in = False
        else:
            page_indicator_after_login = "no_clear_marker"
            likely_logged_in = post_status in (302, 303)

        note = "redirect observed" if location else "no redirect"
    else:
        note = f"unsupported form method detected: {method}"

    return LoginProbeResult(
        service=service,
        login_url=login_url,
        form_action=action,
        form_method=method,
        get_status=get_resp.status_code,
        post_status=post_status,
        location=location,
        response_cookie_names=response_cookie_names,
        session_cookie_names=list(session.cookies.keys()),
        page_indicator_after_login=page_indicator_after_login,
        likely_logged_in=likely_logged_in,
        note=note,
    )


def probe_be_front_login(username: str, password: str) -> LoginProbeResult:
    session = requests.Session()
    session.headers.update({"User-Agent": UA})
    login_url = "https://5ch.io/_login"
    get_resp = session.get(login_url, timeout=TIMEOUT)
    # Parse only BE login form on 5ch front page.
    form_match = re.search(
        r'<form[^>]*name=["\']login_form_be["\'][^>]*>(.*?)</form>',
        get_resp.text,
        re.IGNORECASE | re.DOTALL,
    )
    hidden: Dict[str, str] = {}
    if form_match:
        for m in re.finditer(r"<input[^>]*>", form_match.group(1), re.IGNORECASE):
            tag = m.group(0)
            type_match = re.search(r'type=["\']([^"\']+)["\']', tag, re.IGNORECASE)
            name_match = re.search(r'name=["\']([^"\']+)["\']', tag, re.IGNORECASE)
            value_match = re.search(r'value=["\']([^"\']*)["\']', tag, re.IGNORECASE)
            input_type = (type_match.group(1).lower() if type_match else "text")
            if input_type == "hidden" and name_match:
                hidden[name_match.group(1)] = value_match.group(1) if value_match else ""

    payload = dict(hidden)
    payload["umail"] = username
    payload["pword"] = password
    payload["login_be_normal_user"] = "ログイン"

    post_resp = session.post(login_url, data=payload, timeout=TIMEOUT, allow_redirects=False)
    post_status = post_resp.status_code
    location = post_resp.headers.get("Location")
    response_cookie_names = list(post_resp.cookies.keys())

    if location:
        follow_resp = session.get(urljoin(login_url, location), timeout=TIMEOUT)
        text = follow_resp.text
    else:
        text = post_resp.text

    if re.search(r"ログアウト|Logout|_profile|プロフィール", text, re.IGNORECASE):
        page_indicator_after_login = "logout_or_profile_marker_found"
        likely_logged_in = True
    elif re.search(r"ログイン", text, re.IGNORECASE):
        page_indicator_after_login = "login_marker_found"
        likely_logged_in = False
    else:
        page_indicator_after_login = "no_clear_marker"
        likely_logged_in = post_status in (302, 303)

    return LoginProbeResult(
        service="BE_FRONT_5CH_IO",
        login_url=login_url,
        form_action="(same-url)",
        form_method="POST",
        get_status=get_resp.status_code,
        post_status=post_status,
        location=location,
        response_cookie_names=response_cookie_names,
        session_cookie_names=list(session.cookies.keys()),
        page_indicator_after_login=page_indicator_after_login,
        likely_logged_in=likely_logged_in,
        note="front login flow",
    )


def main() -> int:
    if not ENV_PATH.exists():
        print(f"FAILED: env file not found: {ENV_PATH}")
        return 1

    env = load_env_file(ENV_PATH)

    required = ["BE_EMAIL", "BE_PASSWORD", "UPLIFT_EMAIL", "UPLIFT_PASSWORD"]
    missing = [k for k in required if not env.get(k)]
    if missing:
        print(f"FAILED: missing env keys: {', '.join(missing)}")
        return 1

    results = []

    results.append(
        probe_login(
            service="BE",
            login_url="https://be.5ch.net/",
            username_field="mail",
            password_field="pass",
            username=env["BE_EMAIL"],
            password=env["BE_PASSWORD"],
        )
    )
    results.append(
        probe_be_front_login(
            username=env["BE_EMAIL"],
            password=env["BE_PASSWORD"],
        )
    )

    results.append(
        probe_login(
            service="UPLIFT",
            login_url="https://uplift.5ch.io/login",
            username_field="usr",
            password_field="pwd",
            username=env["UPLIFT_EMAIL"],
            password=env["UPLIFT_PASSWORD"],
        )
    )

    report = {
        "executed_at": __import__("datetime").datetime.now().isoformat(),
        "env_file": str(ENV_PATH),
        "result": [asdict(x) for x in results],
        "notes": [
            "credential values are never written to report",
            "cookie values are omitted; only cookie names are recorded",
            "likely_logged_in is heuristic and must be interpreted with page markers",
        ],
    }

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    for item in results:
        print(
            f"[{item.service}] get={item.get_status} post={item.post_status} "
            f"location={item.location} likely_logged_in={item.likely_logged_in} "
            f"cookies={','.join(item.session_cookie_names) if item.session_cookie_names else '(none)'}"
        )

    print(f"WROTE: {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
