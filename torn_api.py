import requests
from typing import Any, Dict, Optional

API_BASE = "https://api.torn.com"

class TornAPIError(Exception):
    pass

def _get(url: str, params: Dict[str, Any], timeout: int = 25) -> Dict[str, Any]:
    r = requests.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    # Torn returns {"error":{...}} on API errors
    if isinstance(data, dict) and "error" in data:
        raise TornAPIError(str(data["error"]))
    return data

def get_company(company_id: str, key: str) -> Dict[str, Any]:
    """
    v1 style endpoint:
      /company/{id}?selections=employees,profile&key=...
    If Torn changes fields, the UI will still render what it can.
    """
    url = f"{API_BASE}/company/{company_id}"
    return _get(url, {"selections": "employees,profile", "key": key})

def get_user_workstats(user_id: str, key: str) -> Dict[str, Any]:
    """
    v1 user endpoint:
      /user/{id}?selections=workstats,basic&key=...
    Requires the provided key to have access to that user’s workstats.
    """
    url = f"{API_BASE}/user/{user_id}"
    return _get(url, {"selections": "basic,workstats", "key": key})

def normalize_workstats(user_payload: Dict[str, Any]) -> Dict[str, Optional[int]]:
    """
    Tries to extract MAN/INT/END from common Torn API shapes.
    """
    ws = user_payload.get("workstats") or user_payload.get("workingstats") or {}
    # Common keys seen in tools & docs: manual_labor, intelligence, endurance
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

def _to_int(x) -> Optional[int]:
    try:
        if x is None:
            return None
        return int(x)
    except Exception:
        return None
