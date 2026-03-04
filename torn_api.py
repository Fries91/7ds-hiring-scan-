# torn_api.py
import re
import requests
from typing import Any, Dict, List, Optional

API_BASE_V2 = "https://api.torn.com/v2"


def _to_int(x: Any) -> int:
    """
    Torn often returns numbers as strings (sometimes with commas).
    """
    if x is None:
        return 0
    s = str(x)
    s = re.sub(r"[^\d]", "", s)
    return int(s) if s else 0


def me_basic(api_key: str) -> Dict[str, Any]:
    # v1 is fine for "me"
    url = "https://api.torn.com/user/"
    r = requests.get(url, params={"selections": "basic", "key": api_key}, timeout=25)
    r.raise_for_status()
    return r.json()


def company_profile(company_id: str, api_key: str) -> Dict[str, Any]:
    # v1 company endpoint is fine
    url = "https://api.torn.com/company/"
    r = requests.get(url, params={"selections": "profile,employees", "id": company_id, "key": api_key}, timeout=25)
    r.raise_for_status()
    return r.json()


def _hof_workstats_page(api_key: str, offset: int, limit: int) -> List[Dict[str, Any]]:
    """
    Torn API v2 HoF endpoint.
    cat=workstats returns the TOTAL working stats leaderboard.
    """
    url = f"{API_BASE_V2}/torn/hof"
    params = {
        "key": api_key,
        "cat": "workstats",
        "offset": int(offset),
        "limit": int(limit),
    }
    r = requests.get(url, params=params, timeout=25)
    r.raise_for_status()
    j = r.json()

    # Different wrappers exist depending on API changes; handle common shapes safely.
    data = j.get("hof") or j.get("data") or j.get("entries") or j.get("ranking") or j.get("rankings") or []
    if isinstance(data, dict):
        # sometimes it's keyed by rank/id
        data = list(data.values())
    if not isinstance(data, list):
        return []

    out: List[Dict[str, Any]] = []
    for row in data:
        if not isinstance(row, dict):
            continue

        # common key variations
        pid = row.get("user_id") or row.get("player_id") or row.get("id")
        name = row.get("name") or row.get("username") or ""
        val = row.get("value") or row.get("score") or row.get("total") or row.get("stat") or 0

        total = _to_int(val)
        if pid is None:
            continue

        out.append(
            {
                "id": str(pid),
                "name": str(name),
                "total": int(total),
                # keep compatibility if old UI expects these fields
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
    max_pages: int = 10,
    page_size: int = 25,
) -> List[Dict[str, Any]]:
    """
    Smart HoF scanner for TOTAL workstats.

    Problem you had:
      - If you only scan offset=0..(N pages), you only see the TOP players
        (huge totals), so ranges like 500..120000 return nothing.

    Fix:
      - Use an exponential "jump down" using offset until page minimum is <= max_total,
        then walk forward collecting rows within [min_total, max_total].
      - max_pages is the maximum number of API calls (keeps it safe for Render).
    """
    min_total = int(min_total or 0)
    max_total = int(max_total or 10**12)
    if max_total < min_total:
        min_total, max_total = max_total, min_total

    calls = 0
    limit = max(1, int(page_size))
    step_pages = 1
    offset = 0

    # Helper to fetch and count calls
    def fetch(off: int) -> List[Dict[str, Any]]:
        nonlocal calls
        calls += 1
        return _hof_workstats_page(api_key, off, limit)

    # 1) Exponential search downwards until we reach totals <= max_total
    page = fetch(offset)
    if not page:
        return []
    if calls >= max_pages:
        # return whatever matches in the first page (best effort)
        return [r for r in page if min_total <= int(r["total"]) <= max_total]

    # If the LOWEST total on this page is still above our max_total,
    # we must jump deeper (increase offset).
    while page and min(int(r["total"]) for r in page) > max_total and calls < max_pages:
        offset += step_pages * limit
        step_pages *= 2
        page = fetch(offset)

    if not page:
        return []

    # 2) Now we are around the zone where totals cross max_total.
    # Walk forward collecting until we drop below min_total.
    results: List[Dict[str, Any]] = []

    def add_matches(rows: List[Dict[str, Any]]):
        for r in rows:
            t = int(r.get("total") or 0)
            if min_total <= t <= max_total:
                results.append(r)

    add_matches(page)

    while calls < max_pages:
        # if this page's LOWEST total is already below min_total, going further down only decreases
        lowest = min(int(r["total"]) for r in page) if page else 0
        if lowest < min_total:
            break

        offset += limit
        page = fetch(offset)
        if not page:
            break
        add_matches(page)

    # sort descending total (HoF is already, but just in case)
    results.sort(key=lambda r: int(r.get("total") or 0), reverse=True)
    return results
