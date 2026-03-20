import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional
from urllib.parse import urljoin

import requests

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / "apps" / "desktop" / ".env.local"
UA = "Mozilla/5.0 (compatible; 5ch-browser-template-post-probe/0.1)"
THREAD_URL = "https://mao.5ch.io/test/read.cgi/ngt/9240230711/"
REAL_SUBMIT_TOKEN = "I_UNDERSTAND_REAL_POST"


@dataclass
class PostFlowResult:
    mode: str
    thread_get_status: int
    form_action: Optional[str]
    form_method: Optional[str]
    form_input_names: list[str]
    hidden_input_names: list[str]
    confirm_status: Optional[int]
    confirm_location: Optional[str]
    confirm_markers: list[str]
    confirm_form_action: Optional[str]
    confirm_form_field_names: list[str]
    confirm_form_field_count: int
    finalize_attempted: bool
    finalize_status: Optional[int]
    finalize_location: Optional[str]
    finalize_markers: list[str]
    response_cookie_names: list[str]
    session_cookie_names: list[str]
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


def parse_confirm_form(html: str, fallback_post_url: str) -> tuple[Optional[str], Dict[str, str]]:
    forms = re.finditer(r"<form[^>]*>(.*?)</form>", html, re.IGNORECASE | re.DOTALL)
    for m in forms:
        form_html = m.group(0)
        has_bbs = re.search(r'name=["\']?bbs["\']?\b', form_html, re.IGNORECASE) is not None
        has_key = re.search(r'name=["\']?key["\']?\b', form_html, re.IGNORECASE) is not None
        has_time = re.search(r'name=["\']?time["\']?\b', form_html, re.IGNORECASE) is not None
        if not (has_bbs and has_key and has_time):
            continue

        action_match = re.search(r'action=["\']([^"\']+)["\']', form_html, re.IGNORECASE)
        action = action_match.group(1) if action_match else fallback_post_url
        action_url = urljoin(fallback_post_url, action)

        payload: Dict[str, str] = {}
        for input_match in re.finditer(r"<input[^>]*>", form_html, re.IGNORECASE):
            tag = input_match.group(0)
            name_match = re.search(r'name=["\']([^"\']+)["\']', tag, re.IGNORECASE)
            if not name_match:
                name_match = re.search(r'name=([^\s>"\']+)', tag, re.IGNORECASE)
            if not name_match:
                continue
            value_match = re.search(r'value=["\']([^"\']*)["\']', tag, re.IGNORECASE)
            if not value_match:
                value_match = re.search(r'value=([^\s>"\']+)', tag, re.IGNORECASE)
            payload[name_match.group(1)] = value_match.group(1) if value_match else ""
        return action_url, payload
    return None, {}


def marker_scan(text: str) -> list[str]:
    markers = []
    table = {
        "confirm": r"書き込み確認|確認画面|confirm",
        "error": r"ERROR|ＥＲＲＯＲ|エラー",
        "empty_body": r"本文がありません|本文が空",
        "done": r"書きこみました|投稿しました|完了",
        "login": r"UPLIFT|BE|ログイン",
        "mona_ticket": r"MonaTicket",
        "oekaki": r"oekaki_thread1|お絵描き",
        "wait": r"ＷＡＩＴ|忍法帖|規制",
    }
    for key, pat in table.items():
        if re.search(pat, text, re.IGNORECASE):
            markers.append(key)
    return markers


def uplift_login(session: requests.Session, env: Dict[str, str], timeout: int) -> None:
    if not env.get("UPLIFT_EMAIL") or not env.get("UPLIFT_PASSWORD"):
        return
    login_url = "https://uplift.5ch.io/login"
    r = session.get(login_url, timeout=timeout)
    form_action = "/log"
    m = re.search(r'action=["\']([^"\']+)["\']', r.text, re.IGNORECASE)
    if m:
        form_action = m.group(1)
    payload = {
        "usr": env["UPLIFT_EMAIL"],
        "pwd": env["UPLIFT_PASSWORD"],
    }
    session.post(urljoin(login_url, form_action), data=payload, timeout=timeout, allow_redirects=True)


def be_front_login(session: requests.Session, env: Dict[str, str], timeout: int) -> None:
    if not env.get("BE_EMAIL") or not env.get("BE_PASSWORD"):
        return
    login_url = "https://5ch.io/_login"
    r = session.get(login_url, timeout=timeout)
    m = re.search(r'name="unique_regs"\\s+value="([^"]+)"', r.text, re.IGNORECASE)
    if not m:
        return

    payload = {
        "unique_regs": m.group(1),
        "umail": env["BE_EMAIL"],
        "pword": env["BE_PASSWORD"],
        "login_be_normal_user": "ログイン",
    }
    session.post(login_url, data=payload, timeout=timeout, allow_redirects=True)


def one_hop_body_for_markers(session: requests.Session, base_url: str, resp: requests.Response, timeout: int) -> str:
    body = resp.text
    location = resp.headers.get("Location")
    if not location:
        return body
    try:
        follow = session.get(urljoin(base_url, location), timeout=timeout)
        return follow.text
    except requests.RequestException:
        return body


def run_probe(
    mode: str,
    session: requests.Session,
    thread_url: str,
    timeout: int,
    from_name: str,
    mail: str,
    message: str,
    allow_real_submit: bool,
) -> PostFlowResult:
    get_resp = session.get(thread_url, timeout=timeout)
    action, method, payload, input_names, hidden_names = find_post_form(get_resp.text)

    confirm_status = None
    confirm_location = None
    confirm_markers: list[str] = []
    confirm_form_action = None
    confirm_form_field_names: list[str] = []
    confirm_form_field_count = 0
    finalize_attempted = False
    finalize_status = None
    finalize_location = None
    finalize_markers: list[str] = []
    response_cookie_names: list[str] = []
    note = ""

    if action and method == "POST":
        post_url = urljoin(thread_url, action)
        payload["FROM"] = from_name
        payload["mail"] = mail
        payload["MESSAGE"] = message
        payload["submit"] = payload.get("submit") or "書き込む"

        confirm_resp = session.post(post_url, data=payload, timeout=timeout, allow_redirects=False)
        confirm_status = confirm_resp.status_code
        confirm_location = confirm_resp.headers.get("Location")
        response_cookie_names = list(confirm_resp.cookies.keys())
        confirm_body = one_hop_body_for_markers(session, post_url, confirm_resp, timeout)
        confirm_markers = marker_scan(confirm_body)

        confirm_form_action, confirm_form_payload = parse_confirm_form(confirm_body, post_url)
        confirm_form_field_names = sorted(confirm_form_payload.keys())
        confirm_form_field_count = len(confirm_form_payload)

        if confirm_form_action and allow_real_submit:
            finalize_attempted = True
            finalize_resp = session.post(
                confirm_form_action, data=confirm_form_payload, timeout=timeout, allow_redirects=False
            )
            finalize_status = finalize_resp.status_code
            finalize_location = finalize_resp.headers.get("Location")
            finalize_body = one_hop_body_for_markers(session, confirm_form_action, finalize_resp, timeout)
            finalize_markers = marker_scan(finalize_body)
            note = "finalize submit executed (real submit enabled)"
        elif confirm_form_action:
            note = "confirm form detected; finalize submit blocked"
        else:
            note = "confirm form not detected from confirm response"
    else:
        note = "posting form not found"

    return PostFlowResult(
        mode=mode,
        thread_get_status=get_resp.status_code,
        form_action=action,
        form_method=method,
        form_input_names=input_names,
        hidden_input_names=hidden_names,
        confirm_status=confirm_status,
        confirm_location=confirm_location,
        confirm_markers=confirm_markers,
        confirm_form_action=confirm_form_action,
        confirm_form_field_names=confirm_form_field_names,
        confirm_form_field_count=confirm_form_field_count,
        finalize_attempted=finalize_attempted,
        finalize_status=finalize_status,
        finalize_location=finalize_location,
        finalize_markers=finalize_markers,
        response_cookie_names=response_cookie_names,
        session_cookie_names=sorted({c.name for c in session.cookies}),
        note=note,
    )


def parse_args() -> argparse.Namespace:
    today = datetime.now().strftime("%Y-%m-%d")
    parser = argparse.ArgumentParser(
        description="Probe 5ch post flow (thread form -> confirm -> optional finalize submit)."
    )
    parser.add_argument("--thread-url", default=THREAD_URL, help="Thread URL to probe.")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout seconds.")
    parser.add_argument("--from-name", default="", help="FROM value for confirm probe.")
    parser.add_argument("--mail", default="", help="mail value for confirm probe.")
    parser.add_argument(
        "--message",
        default="",
        help="MESSAGE value for confirm probe. Keep empty to avoid actual posting risk.",
    )
    parser.add_argument(
        "--report-path",
        default=str(ROOT / "docs" / f"POST_FLOW_PROBE_{today}.json"),
        help="Output JSON report path.",
    )
    parser.add_argument(
        "--allow-real-submit",
        action="store_true",
        help="Enable finalize submit after confirm form parse.",
    )
    parser.add_argument(
        "--real-submit-token",
        default="",
        help=f"Safety token required for real submit: {REAL_SUBMIT_TOKEN}",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    env = load_env_file(ENV_PATH)
    report_path = Path(args.report_path).resolve()

    allow_real_submit = bool(args.allow_real_submit and args.real_submit_token == REAL_SUBMIT_TOKEN)
    if allow_real_submit and not args.message.strip():
        print("ERROR: real submit requires non-empty --message", file=sys.stderr)
        return 2

    anon = requests.Session()
    anon.headers.update({"User-Agent": UA})

    uplift = requests.Session()
    uplift.headers.update({"User-Agent": UA})
    uplift_login(uplift, env, args.timeout)

    be_front = requests.Session()
    be_front.headers.update({"User-Agent": UA})
    be_front_login(be_front, env, args.timeout)

    be_uplift = requests.Session()
    be_uplift.headers.update({"User-Agent": UA})
    uplift_login(be_uplift, env, args.timeout)
    be_front_login(be_uplift, env, args.timeout)

    results = [
        run_probe("anonymous", anon, args.thread_url, args.timeout, args.from_name, args.mail, args.message, allow_real_submit),
        run_probe(
            "uplift_logged_in", uplift, args.thread_url, args.timeout, args.from_name, args.mail, args.message, allow_real_submit
        ),
        run_probe(
            "be_front_logged_in", be_front, args.thread_url, args.timeout, args.from_name, args.mail, args.message, allow_real_submit
        ),
        run_probe(
            "be_uplift_logged_in",
            be_uplift,
            args.thread_url,
            args.timeout,
            args.from_name,
            args.mail,
            args.message,
            allow_real_submit,
        ),
    ]

    report = {
        "executed_at": datetime.now().isoformat(),
        "thread_url": args.thread_url,
        "allow_real_submit_requested": bool(args.allow_real_submit),
        "allow_real_submit_effective": allow_real_submit,
        "real_submit_token_ok": args.real_submit_token == REAL_SUBMIT_TOKEN,
        "result": [asdict(x) for x in results],
        "notes": [
            "credentials are never printed",
            "cookie values are omitted",
            "real submit requires --allow-real-submit and --real-submit-token",
            f"required token: {REAL_SUBMIT_TOKEN}",
        ],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    for r in results:
        print(
            f"[{r.mode}] get={r.thread_get_status} confirm={r.confirm_status} finalize={r.finalize_status} "
            f"confirm_markers={','.join(r.confirm_markers) if r.confirm_markers else '(none)'} "
            f"finalize_markers={','.join(r.finalize_markers) if r.finalize_markers else '(none)'} "
            f"cookies={','.join(r.session_cookie_names) if r.session_cookie_names else '(none)'}"
        )
    print(f"WROTE: {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
