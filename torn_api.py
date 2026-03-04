import re
import requests
from typing import Any, Dict, List

API_BASE_V1 = "https://api.torn.com"
API_BASE_V2 = "https://api.torn.com/v2"


def _to_int(x: Any) -> int:
    if x is None:
        return 0
    s = str(x)
    s = re.sub(r"[^\d]", "", s)
    return int(s) if s else 0


def me_basic(api_key: str) -> Dict[str, Any]:
    url = f"{API_BASE_V1}/user/"
    r = requests.get(url, params={"selections": "basic", "key": api_key}, timeout=25)
    r.raise_for_status()
    j = r.json()
    if "error" in j:
        raise RuntimeError(j["error"])
    return j


def company_profile(company_id: str, api_key: str) -> Dict[str, Any]:
    url = f"{API_BASE_V1}/company/"
    r = requests.get(
        url,
        params={"selections": "profile,employees", "id": company_id, "key": api_key},
        timeout=25,
    )
    r.raise_for_status()
    j = r.json()
    if "error" in j:
        raise RuntimeError(j["error"])
    return j


def _hof_workstats_page(api_key: str, offset: int, limit: int) -> List[Dict[str, Any]]:
    """
    Torn API v2 HoF endpoint.
    cat=workstats returns TOTAL working stats leaderboard.
    """
    url = f"{API_BASE_V2}/torn/hof"
    params = {"key": api_key, "cat": "workstats", "offset": int(offset), "limit": int(limit)}
    r = requests.get(url, params=params, timeout=25)
    r.raise_for_status()
    j = r.json()
    if "error" in j:
        raise RuntimeError(j["error"])

    data = j.get("hof") or j.get("data") or j.get("entries") or j.get("ranking") or j.get("rankings") or []
    if isinstance(data, dict):
        data = list(data.values())
    if not isinstance(data, list):
        return []

    out: List[Dict[str, Any]] = []
    for row in data:
        if not isinstance(row, dict):
            continue

        pid = row.get("user_id") or row.get("player_id") or row.get("id")
        name = row.get("name") or row.get("username") or ""
        val = row.get("value") or row.get("score") or row.get("total") or row.get("stat") or 0

        if pid is None:
            continue

        out.append(
            {
                "id": str(pid),
                "name": str(name),
                "total": int(_to_int(val)),
                # keep compatibility fields (UI prints them sometimes)
                "man": 0,
                "int": 0,
                "end": 0,
            }
        )
    return out


def hof_scan_workstats(
    api_key: str,
    min_total: int = 0,
    max_total: int = 10**12,
    max_pages: int = 10,   # IMPORTANT: counts API calls, not “pages”
    page_size: int = 25,
) -> List[Dict[str, Any]]:
    """
    Smart HoF scanner:
    - If you only scan offset=0.., you're stuck at the TOP (huge totals).
    - Ranges like 500..120000 return none.

    Fix:
    - Jump down using exponential offset until the page min drops into your band,
      then walk forward collecting matches.
    """
    min_total = int(min_total or 0)
    max_total = int(max_total or 10**12)
    if max_total < min_total:
        min_total, max_total = max_total, min_total

    calls = 0
    limit = max(1, int(page_size))
    offset = 0
    step_pages = 1

    def fetch(off: int) -> List[Dict[str, Any]]:
        nonlocal calls
        calls += 1
        return _hof_workstats_page(api_key, off, limit)

    page = fetch(offset)
    if not page:
        return []

    # Jump down until we get near max_total
    while calls < max_pages:
        page_min = min(int(r.get("total") or 0) for r in page)
        if page_min <= max_total:
            break
        offset += step_pages * limit
        step_pages *= 2
        page = fetch(offset)
        if not page:
            return []

    results: List[Dict[str, Any]] = []

    def add_matches(rows: List[Dict[str, Any]]):
        for r in rows:
            t = int(r.get("total") or 0)
            if min_total <= t <= max_total:
                results.append(r)

    add_matches(page)

    # Walk down collecting until we fall under min_total
    while calls < max_pages:
        page_min = min(int(r.get("total") or 0) for r in page) if page else 0
        if page_min < min_total:
            break
        offset += limit
        page = fetch(offset)
        if not page:
            break
        add_matches(page)

    results.sort(key=lambda r: int(r.get("total") or 0), reverse=True)
    return results
