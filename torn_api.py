import requests
from typing import Any, Dict, List

API_V1 = "https://api.torn.com"
API_V2 = "https://api.torn.com/v2"


def _get(url: str, params: Dict[str, Any], timeout: int = 25) -> Dict[str, Any]:
    r = requests.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    return r.json()


def me_basic(api_key: str) -> Dict[str, Any]:
    url = f"{API_V1}/user/"
    params = {"selections": "basic,profile", "key": api_key}
    return _get(url, params)


def company_profile(company_id: str, api_key: str) -> Dict[str, Any]:
    url = f"{API_V1}/company/{company_id}"
    params = {"selections": "profile,employees", "key": api_key}
    return _get(url, params)


def hof_page(cat: str, offset: int, limit: int, api_key: str) -> Dict[str, Any]:
    url = f"{API_V2}/torn/hof"
    params = {"cat": cat, "offset": int(offset), "limit": int(limit), "key": api_key}
    return _get(url, params)


def hof_scan_workstats(
    api_key: str,
    min_man: int,
    max_man: int,
    min_int: int,
    max_int: int,
    min_end: int,
    max_end: int,
    max_pages: int = 10,
    page_size: int = 25,
) -> List[Dict[str, Any]]:
    """
    Scans HoF working stats pages and filters locally.
    If Torn changes/denies the 'workingstats' cat, your server will return a clean error.
    """
    out: List[Dict[str, Any]] = []
    offset = 0

    for _ in range(int(max_pages)):
        data = hof_page("workingstats", offset=offset, limit=page_size, api_key=api_key)

        # v2 shapes vary; normalize
        entries = []
        if isinstance(data, dict):
            if isinstance(data.get("entries"), list):
                entries = data["entries"]
            elif isinstance(data.get("hof"), dict) and isinstance(data["hof"].get("entries"), list):
                entries = data["hof"]["entries"]

        if not entries:
            break

        for r in entries:
            uid = str(r.get("user_id") or r.get("id") or "")
            name = r.get("name") or r.get("username") or ""
            man = int(r.get("manual_labor") or r.get("man") or 0)
            inte = int(r.get("intelligence") or r.get("int") or 0)
            end = int(r.get("endurance") or r.get("end") or 0)
            if not uid or not name:
                continue

            if (min_man <= man <= max_man) and (min_int <= inte <= max_int) and (min_end <= end <= max_end):
                out.append({"id": uid, "name": name, "man": man, "int": inte, "end": end, "total": man + inte + end})

        offset += page_size

    out.sort(key=lambda x: int(x.get("total") or 0), reverse=True)
    return out
