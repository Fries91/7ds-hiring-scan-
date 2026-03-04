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
    r = requests.get(
        f"{API_BASE_V1}/user/",
        params={"selections": "basic", "key": api_key},
        timeout=25,
    )
    r.raise_for_status()
    return r.json()


def company_profile(company_id: str, api_key: str) -> Dict[str, Any]:
    r = requests.get(
        f"{API_BASE_V1}/company/",
        params={"selections": "profile,employees", "id": company_id, "key": api_key},
        timeout=25,
    )
    r.raise_for_status()
    return r.json()


def _hof_workstats_page(api_key: str, offset: int, limit: int) -> List[Dict[str, Any]]:
    """
    Torn API v2 HoF endpoint.
    cat=workstats = TOTAL workstats leaderboard.
    """
    r = requests.get(
        f"{API_BASE_V2}/torn/hof",
        params={"key": api_key, "cat": "workstats", "offset": int(offset), "limit": int(limit)},
        timeout=25,
    )
    r.raise_for_status()
    j = r.json()

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

        total = _to_int(val)

        # HoF workstats is TOTAL-only; keep man/int/end for compatibility
        out.append({"id": str(pid), "name": str(name), "total": int(total), "man": 0, "int": 0, "end": 0})

    return out


def hof_scan_workstats(
    api_key: str,
    min_total: int = 0,
    max_total: int = 10**12,
    max_pages: int = 10,     # max API calls
    page_size: int = 25,
) -> List[Dict[str, Any]]:
    """
    Fix for ranges like 500..120000:
    - If you only scan offset=0, you're only scanning top HoF totals (huge numbers).
    - Filtering <=120k then returns 0.
    Solution:
    - Exponentially jump offsets until page totals drop into the desired zone,
      then walk forward collecting matching totals.
    """
    min_total = int(min_total or 0)
    max_total = int(max_total or 10**12)
    if max_total < min_total:
        min_total, max_total = max_total, min_total

    limit = max(1, int(page_size))
    calls = 0

    def fetch(off: int) -> List[Dict[str, Any]]:
        nonlocal calls
        calls += 1
        return _hof_workstats_page(api_key, off, limit)

    offset = 0
    page = fetch(offset)
    if not page:
        return []

    if calls >= max_pages:
        return [r for r in page if min_total <= int(r.get("total") or 0) <= max_total]

    # jump down until the lowest value on a page is <= max_total
    step_pages = 1
    while page and min(int(r.get("total") or 0) for r in page) > max_total and calls < max_pages:
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

    # walk forward until we drop below min_total
    while calls < max_pages:
        lowest = min(int(r.get("total") or 0) for r in page) if page else 0
        if lowest < min_total:
            break
        offset += limit
        page = fetch(offset)
        if not page:
            break
        add_matches(page)

    results.sort(key=lambda r: int(r.get("total") or 0), reverse=True)
    return results
