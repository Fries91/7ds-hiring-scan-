import requests
from typing import Any, Dict, Optional, List, Tuple

API_V1_BASE = "https://api.torn.com"
API_V2_BASE = "https://api.torn.com/v2"


class TornAPIError(Exception):
    pass


def _get(url: str, params: Dict[str, Any], timeout: int = 25) -> Dict[str, Any]:
    r = requests.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and "error" in data:
        raise TornAPIError(str(data["error"]))
    return data


def get_user_basic(key: str) -> Dict[str, Any]:
    url = f"{API_V1_BASE}/user/"
    return _get(url, {"selections": "basic", "key": key})


def get_user_events(key: str) -> Dict[str, Any]:
    url = f"{API_V1_BASE}/user/"
    return _get(url, {"selections": "events", "key": key})


def get_company_employees(company_id: str, key: str) -> Dict[str, Any]:
    url = f"{API_V1_BASE}/company/{company_id}"
    payload = _get(url, {"selections": "employees,profile", "key": key})

    company = payload.get("company", payload) if isinstance(payload, dict) else {}
    employees_obj = company.get("employees") or company.get("employee") or {}
    employees = []

    if isinstance(employees_obj, dict):
        for k, v in employees_obj.items():
            if not isinstance(v, dict):
                continue
            uid = str(v.get("id") or k or "")
            employees.append(
                {
                    "id": uid,
                    "name": v.get("name") or v.get("username") or "",
                    "position": v.get("position") or v.get("job") or v.get("role") or "",
                    "days_in_company": v.get("days_in_company") or v.get("days") or None,
                    "status": v.get("status") or "",
                }
            )
    elif isinstance(employees_obj, list):
        for v in employees_obj:
            if not isinstance(v, dict):
                continue
            uid = str(v.get("id") or "")
            employees.append(
                {
                    "id": uid,
                    "name": v.get("name") or v.get("username") or "",
                    "position": v.get("position") or v.get("job") or v.get("role") or "",
                    "days_in_company": v.get("days_in_company") or v.get("days") or None,
                    "status": v.get("status") or "",
                }
            )

    employees.sort(key=lambda x: (x.get("position") or "", x.get("name") or ""))
    return {
        "company_id": str(company_id),
        "company_name": company.get("name") or company.get("company_name") or f"Company {company_id}",
        "employees": employees,
    }


def get_user_workstats(user_id: str, key: str) -> Dict[str, Any]:
    url = f"{API_V1_BASE}/user/{user_id}"
    return _get(url, {"selections": "basic,workstats", "key": key})


def _to_int(x) -> Optional[int]:
    try:
        if x is None:
            return None
        return int(x)
    except Exception:
        return None


def normalize_workstats(user_payload: Dict[str, Any]) -> Dict[str, Optional[int]]:
    ws = user_payload.get("workstats") or user_payload.get("workingstats") or {}
    man = ws.get("manual_labor") or ws.get("manual") or ws.get("man")
    inte = ws.get("intelligence") or ws.get("int") or ws.get("inte")
    end = ws.get("endurance") or ws.get("end")
    total = None
    try:
        if man is not None and inte is not None and end is not None:
            total = int(man) + int(inte) + int(end)
    except Exception:
        total = None
    return {"man": _to_int(man), "int": _to_int(inte), "end": _to_int(end), "total": total}


def _hof_fetch_page(key: str, offset: int, limit: int) -> Dict[str, Any]:
    url = f"{API_V2_BASE}/torn/hof"
    return _get(url, {"key": key, "cat": "workstats", "limit": limit, "offset": offset})


def _hof_extract_entries(payload: dict) -> List[dict]:
    if not isinstance(payload, dict):
        return []
    for k in ("hof", "hall_of_fame", "rankings", "entries", "data"):
        v = payload.get(k)
        if isinstance(v, list):
            return v
    if isinstance(payload.get("hall_of_fame"), dict):
        for k in ("entries", "rankings", "hof"):
            v = payload["hall_of_fame"].get(k)
            if isinstance(v, list):
                return v
    return []


def search_hof_workstats_v2(key: str, min_val: int, max_val: int, limit_results: int = 100) -> Tuple[List[Dict[str, Any]], int]:
    if min_val > max_val:
        min_val, max_val = max_val, min_val

    found: List[Dict[str, Any]] = []
    scanned_pages = 0

    page_limit = 100
    max_pages = 30  # safety cap

    for i in range(max_pages):
        scanned_pages += 1
        off = i * page_limit
        payload = _hof_fetch_page(key, off, page_limit)
        entries = _hof_extract_entries(payload)
        if not entries:
            break

        vals = []
        for e in entries:
            uid = str(e.get("user_id") or e.get("id") or e.get("userid") or "")
            name = e.get("name") or e.get("username") or ""
            rank = e.get("rank") or e.get("position") or e.get("place") or None
            raw_val = e.get("value") if e.get("value") is not None else (e.get("score") if e.get("score") is not None else e.get("workstats"))

            try:
                val = int(raw_val)
            except Exception:
                continue

            vals.append(val)
            if min_val <= val <= max_val:
                found.append({"id": uid, "name": name, "rank": rank, "value": val})
                if len(found) >= limit_results:
                    return found, scanned_pages

        # Early stop if descending and we fell below min
        if vals and max(vals) < min_val:
            break

    return found, scanned_pages
