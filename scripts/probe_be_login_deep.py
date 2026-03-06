import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urljoin

import requests

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / "apps" / "desktop" / ".env.local"
REPORT_PATH = ROOT / "docs" / "BE_LOGIN_DEEP_PROBE_2026-03-07.json"
UA = "Mozilla/5.0 (compatible; 5ch-browser-template-be-probe/0.1)"
TIMEOUT = 20
BASE = "https://be.5ch.net/"


@dataclass
class Hop:
    url: str
    status: int
    location: Optional[str]
    set_cookie_names: List[str]


def load_env(path: Path) -> Dict[str, str]:
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


def parse_form(html: str) -> tuple[str, str, Dict[str, str]]:
    m = re.search(r"<form[^>]*action=[^>]*>(.*?)</form>", html, re.I | re.S)
    if not m:
        return "/log", "POST", {}
    form_html = m.group(0)
    action_m = re.search(r'action=["\']([^"\']+)["\']', form_html, re.I)
    method_m = re.search(r'method=["\']([^"\']+)["\']', form_html, re.I)
    hidden: Dict[str, str] = {}
    for im in re.finditer(r"<input[^>]*>", form_html, re.I):
        tag = im.group(0)
        type_m = re.search(r'type=["\']([^"\']+)["\']', tag, re.I)
        name_m = re.search(r'name=["\']([^"\']+)["\']', tag, re.I)
        val_m = re.search(r'value=["\']([^"\']*)["\']', tag, re.I)
        if not name_m:
            continue
        if (type_m.group(1).lower() if type_m else "text") == "hidden":
            hidden[name_m.group(1)] = val_m.group(1) if val_m else ""
    return action_m.group(1) if action_m else "/log", (method_m.group(1).upper() if method_m else "POST"), hidden


def cookie_names_from_headers(resp: requests.Response) -> List[str]:
    raw = resp.headers.get("Set-Cookie")
    if not raw:
        return []
    names = []
    for part in raw.split(","):
        seg = part.strip().split(";", 1)[0]
        if "=" in seg:
            names.append(seg.split("=", 1)[0].strip())
    return sorted(set(names))


def markers(html: str) -> Dict[str, bool]:
    return {
        "has_login_word": bool(re.search(r"ログイン|login", html, re.I)),
        "has_logout_word": bool(re.search(r"ログアウト|logout", html, re.I)),
        "has_status_word": bool(re.search(r"status|ステータス|会員", html, re.I)),
        "has_error_word": bool(re.search(r"error|エラー|失敗", html, re.I)),
    }


def request_with_hops(session: requests.Session, method: str, url: str, data: Optional[Dict[str, str]] = None, limit: int = 5):
    hops: List[Hop] = []
    cur_url = url
    cur_method = method
    cur_data = data

    for _ in range(limit):
        if cur_method == "POST":
            resp = session.post(cur_url, data=cur_data, timeout=TIMEOUT, allow_redirects=False)
        else:
            resp = session.get(cur_url, timeout=TIMEOUT, allow_redirects=False)

        location = resp.headers.get("Location")
        hops.append(Hop(
            url=cur_url,
            status=resp.status_code,
            location=location,
            set_cookie_names=cookie_names_from_headers(resp),
        ))

        if resp.status_code in (301, 302, 303, 307, 308) and location:
            cur_url = urljoin(cur_url, location)
            cur_method = "GET"
            cur_data = None
            continue
        return resp, hops

    return resp, hops


def run_flow(email: str, password: str):
    s = requests.Session()
    s.headers.update({"User-Agent": UA})

    login_get = s.get(BASE, timeout=TIMEOUT)
    action, method, hidden = parse_form(login_get.text)
    payload = dict(hidden)
    payload["mail"] = email
    payload["pass"] = password
    payload["login"] = "ログイン"

    login_resp, hops = request_with_hops(s, method, urljoin(BASE, action), payload)

    home = s.get(BASE, timeout=TIMEOUT)
    status = s.get(urljoin(BASE, "status"), timeout=TIMEOUT)

    return {
        "initial_get_status": login_get.status_code,
        "form_action": action,
        "form_method": method,
        "redirect_hops": [asdict(h) for h in hops],
        "final_login_response_status": login_resp.status_code,
        "session_cookie_names": sorted({c.name for c in s.cookies}),
        "home_status": home.status_code,
        "home_url": home.url,
        "home_markers": markers(home.text),
        "status_status": status.status_code,
        "status_url": status.url,
        "status_markers": markers(status.text),
    }


def main() -> int:
    env = load_env(ENV_PATH)
    if not env.get("BE_EMAIL") or not env.get("BE_PASSWORD"):
        print("FAILED: BE_EMAIL/BE_PASSWORD missing")
        return 1

    anon = run_flow("", "")
    auth = run_flow(env["BE_EMAIL"], env["BE_PASSWORD"])

    report = {
        "executed_at": __import__("datetime").datetime.now().isoformat(),
        "notes": [
            "credential values are not stored",
            "cookie values are not stored",
            "anonymous baseline captured for comparison",
        ],
        "anonymous": anon,
        "authenticated": auth,
    }

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("ANON cookies:", ",".join(anon["session_cookie_names"]) if anon["session_cookie_names"] else "(none)")
    print("AUTH cookies:", ",".join(auth["session_cookie_names"]) if auth["session_cookie_names"] else "(none)")
    print("AUTH home markers:", auth["home_markers"])
    print("AUTH status markers:", auth["status_markers"])
    print(f"WROTE: {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
