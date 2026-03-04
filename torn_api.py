import requests
from typing import Any, Dict, List, Optional

API_BASE = "https://api.torn.com"


class TornAPIError(Exception):
    pass


def _get(url: str, params: Dict[str, Any], timeout: int = 25) -> Dict[str, Any]:
    r = requests.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and "error" in data:
        raise TornAPIError(str(data["error"]))
    return data


def me_basic(api_key: str) -> Dict[str, Any]:
    # v2 user endpoint
    return _get(f"{API_BASE}/v2/user", {"key": api_key})


def company_profile(api_key: str, company_id: str) -> Dict[str, Any]:
    # v2 company endpoint
    return _get(f"{API_BASE}/v2/company/{company_id}", {"key": api_key})


def hof_page_workstats(api_key: str, limit: int, offset: int) -> List[Dict[str, Any]]:
    # v2 HoF endpoint
    data = _get(
        f"{API_BASE}/v2/torn/hof",
        {"key": api_key, "cat": "workstats", "limit": int(limit), "offset": int(offset)},
    )

    if isinstance(data, dict):
        if isinstance(data.get("hof"), list):
            return data["hof"]
        if isinstance(data.get("workstats"), list):
            return data["workstats"]
        if isinstance(data.get("entries"), list):
            return data["entries"]

    raise TornAPIError(f"Unexpected HoF payload shape: {list(data.keys()) if isinstance(data, dict) else type(data)}")


def _entry_value(e: Dict[str, Any]) -> Optional[int]:
    v = e.get("value")
    try:
        return int(v)
    except Exception:
        return None


def _entry_rank(e: Dict[str, Any]) -> Optional[int]:
    r = e.get("rank")
    try:
        return int(r)
    except Exception:
        return None


def hof_scan_workstats(api_key: str, min_value: int, max_value: int, page_size: int = 100) -> Dict[str, Any]:
    min_value = int(min_value)
    max_value = int(max_value)
    if min_value > max_value:
        min_value, max_value = max_value, min_value

    page_size = max(10, min(int(page_size), 250))

    # Exponential search to find a high offset beyond the range
    lo = 0
    hi = 0
    step = 1000
    last_page = None

    for _ in range(25):
        page = hof_page_workstats(api_key, limit=5, offset=hi)
        if not page:
            break
        last_page = page
        tail_val = _entry_value(page[-1])
        if tail_val is None:
            break
        if tail_val < min_value:
            break
        lo = hi
        hi += step
        step *= 2

    if last_page is None:
        return {"min": min_value, "max": max_value, "count": 0, "results": []}

    # Binary search for first page where head_val <= max_value
    left = 0
    right = hi
    best = 0
    for _ in range(20):
        mid = (left + right) // 2
        mid = (mid // page_size) * page_size
        page = hof_page_workstats(api_key, limit=page_size, offset=mid)
        if not page:
            right = mid - page_size
            continue
        head_val = _entry_value(page[0])
        tail_val = _entry_value(page[-1])
        if head_val is None or tail_val is None:
            break
        if head_val > max_value:
            left = mid + page_size
        else:
            best = mid
            right = mid - page_size

    start_offset = max(0, best - page_size)

    # Walk forward collecting
    results = []
    offset = start_offset
    seen = set()

    while True:
        page = hof_page_workstats(api_key, limit=page_size, offset=offset)
        if not page:
            break

        stop = False
        for e in page:
            val = _entry_value(e)
            if val is None:
                continue
            if val < min_value:
                stop = True
                break
            if min_value <= val <= max_value:
                tid = e.get("id") or e.get("user_id") or e.get("player_id")
                tid = str(tid) if tid is not None else ""
                if tid and tid in seen:
                    continue
                if tid:
                    seen.add(tid)
                results.append(
                    {"id": tid, "name": e.get("name", ""), "rank": _entry_rank(e), "value": val}
                )

        if stop:
            break

        offset += page_size
        if len(results) >= 5000:
            break

    results.sort(key=lambda x: x["value"], reverse=True)
    return {"min": min_value, "max": max_value, "count": len(results), "results": results}
