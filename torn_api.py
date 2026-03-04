import requests
from typing import Any, Dict, List, Optional, Tuple

API = "https://api.torn.com"


def _get(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    r = requests.get(url, params=params, timeout=25)
    r.raise_for_status()
    return r.json()


def me_basic(api_key: str) -> Dict[str, Any]:
    url = f"{API}/user/"
    data = _get(url, {"selections": "basic", "key": api_key})
    if "error" in data:
        raise Exception(data["error"].get("error") or "Torn error")
    return data


def company_profile(company_id: str, api_key: str) -> Dict[str, Any]:
    url = f"{API}/company/{company_id}"
    data = _get(url, {"selections": "profile,employees", "key": api_key})
    if "error" in data:
        raise Exception(data["error"].get("error") or "Torn error")
    return data


def _hof_entries_from_response(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    # Common shapes:
    # data["hof"] = [ ... ]
    # data["hof"]["entries"] = [ ... ]
    # data["hof"]["rankings"] = [ ... ]
    hof = data.get("hof")
    if isinstance(hof, list):
        return [x for x in hof if isinstance(x, dict)]
    if isinstance(hof, dict):
        entries = hof.get("entries") or hof.get("rankings") or hof.get("list") or []
        if isinstance(entries, list):
            return [x for x in entries if isinstance(x, dict)]
    return []


def _norm_workstats_entry(e: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    pid = e.get("user_id") or e.get("player_id") or e.get("id")
    if not pid:
        return None

    name = e.get("name") or e.get("username") or ""

    man = e.get("man") or e.get("manual_labor") or 0
    inte = e.get("int") or e.get("intel") or e.get("intelligence") or 0
    endu = e.get("end") or e.get("endu") or e.get("endurance") or 0
    total = e.get("total") or e.get("workstats_total") or 0

    try:
        man = int(man)
    except Exception:
        man = 0
    try:
        inte = int(inte)
    except Exception:
        inte = 0
    try:
        endu = int(endu)
    except Exception:
        endu = 0
    try:
        total = int(total)
    except Exception:
        total = man + inte + endu

    if total <= 0:
        total = man + inte + endu

    return {
        "id": str(pid),
        "name": str(name),
        "man": man,
        "int": inte,
        "end": endu,
        "total": total,
    }


def hof_scan_workstats(api_key: str, max_pages: int = 10, page_size: int = 25) -> List[Dict[str, Any]]:
    """
    Basic scan (top pages only). Good for "find top talent" scans.
    """
    out: List[Dict[str, Any]] = []
    base = f"{API}/v2/torn/hof"
    offset = 0

    for _ in range(int(max_pages)):
        params = {"cat": "workstats", "limit": int(page_size), "offset": int(offset), "key": api_key}
        data = _get(base, params)
        if "error" in data:
            raise Exception(data["error"].get("error") or "Torn error")

        entries = _hof_entries_from_response(data)
        if not entries:
            break

        for e in entries:
            ne = _norm_workstats_entry(e)
            if ne:
                out.append(ne)

        offset += int(page_size)

    return out


def hof_search_workstats_total_range(
    api_key: str,
    min_total: int,
    max_total: int,
    page_size: int = 25,
    hard_max_pages: int = 400,
    hard_max_rows: int = 500,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    RANGE-AWARE search:
    HoF is sorted by total descending (big -> small).

    Strategy:
    - Keep paging until we reach totals <= max_total (so range can begin)
    - Collect rows within [min_total, max_total]
    - Stop once page bottom total < min_total (because all next pages will be even smaller)
    - Hard caps prevent runaway scans.
    """
    base = f"{API}/v2/torn/hof"

    min_total = int(min_total)
    max_total = int(max_total)
    if max_total < min_total:
        min_total, max_total = max_total, min_total

    offset = 0
    pages = 0
    collected: List[Dict[str, Any]] = []

    reached_max_band = False  # we have reached totals <= max_total yet?
    last_page_min_total: Optional[int] = None
    last_page_max_total: Optional[int] = None

    while pages < int(hard_max_pages) and len(collected) < int(hard_max_rows):
        params = {"cat": "workstats", "limit": int(page_size), "offset": int(offset), "key": api_key}
        data = _get(base, params)
        if "error" in data:
            raise Exception(data["error"].get("error") or "Torn error")

        entries = _hof_entries_from_response(data)
        if not entries:
            break

        page_norm: List[Dict[str, Any]] = []
        for e in entries:
            ne = _norm_workstats_entry(e)
            if ne:
                page_norm.append(ne)

        if not page_norm:
            break

        totals = [int(x.get("total") or 0) for x in page_norm]
        page_max = max(totals) if totals else 0
        page_min = min(totals) if totals else 0
        last_page_max_total = page_max
        last_page_min_total = page_min

        # if our range's max_total is lower than page_min, we're still above the band
        if page_min <= max_total:
            reached_max_band = True

        # collect only after we reached the upper bound band,
        # but still safe to just check the filter always
        for r in page_norm:
            t = int(r.get("total") or 0)
            if t < min_total:
                continue
            if t > max_total:
                continue
            collected.append(r)
            if len(collected) >= int(hard_max_rows):
                break

        pages += 1
        offset += int(page_size)

        # If we've reached the band and the bottom of this page is already below min_total,
        # then all future pages will be below min_total too -> stop.
        if reached_max_band and page_min < min_total:
            break

        # If we haven't even reached totals <= max_total yet, keep paging.
        # (This is what fixes 500-120000!)
        # Otherwise we keep paging until we drop below min_total.

    meta = {
        "pages_scanned": pages,
        "page_size": int(page_size),
        "offset_last": offset,
        "last_page_max_total": last_page_max_total,
        "last_page_min_total": last_page_min_total,
        "hard_max_pages": int(hard_max_pages),
        "hard_max_rows": int(hard_max_rows),
    }
    return collected, meta
