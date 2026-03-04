import requests
from typing import Any, Dict, List

API = "https://api.torn.com"


def _get(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    r = requests.get(url, params=params, timeout=25)
    r.raise_for_status()
    return r.json()


def me_basic(api_key: str) -> Dict[str, Any]:
    # enough to validate api key + get player id/name
    url = f"{API}/user/"
    data = _get(url, {"selections": "basic", "key": api_key})
    if "error" in data:
        raise Exception(data["error"].get("error") or "Torn error")
    return data


def company_profile(company_id: str, api_key: str) -> Dict[str, Any]:
    # company profile + employees
    url = f"{API}/company/{company_id}"
    data = _get(url, {"selections": "profile,employees", "key": api_key})
    if "error" in data:
        raise Exception(data["error"].get("error") or "Torn error")
    return data


def hof_scan_workstats(api_key: str, max_pages: int = 10, page_size: int = 25) -> List[Dict[str, Any]]:
    """
    Pulls HoF working stats pages and returns normalized list:
    [{id,name,man,int,end,total}, ...]
    NOTE: We do NOT filter here. App filters by TOTAL.
    """
    out: List[Dict[str, Any]] = []

    # Torn v2 HoF endpoint (workstats category)
    # We keep offset paging. Some Torn responses vary slightly; we normalize.
    base = f"{API}/v2/torn/hof"

    offset = 0
    for _ in range(int(max_pages)):
        params = {
            "cat": "workstats",
            "limit": int(page_size),
            "offset": int(offset),
            "key": api_key,
        }
        data = _get(base, params)
        if "error" in data:
            raise Exception(data["error"].get("error") or "Torn error")

        # Common shapes:
        # data["hof"] = [ ... ]  OR data["hof"]["entries"] = [ ... ]
        entries = None
        hof = data.get("hof")
        if isinstance(hof, list):
            entries = hof
        elif isinstance(hof, dict):
            entries = hof.get("entries") or hof.get("rankings") or hof.get("list")
        if not isinstance(entries, list) or not entries:
            break

        for e in entries:
            if not isinstance(e, dict):
                continue
            pid = e.get("user_id") or e.get("player_id") or e.get("id")
            name = e.get("name") or e.get("username") or ""

            # workstats fields vary; normalize to man/int/end + total
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

            if not pid:
                continue

            out.append(
                {
                    "id": str(pid),
                    "name": str(name),
                    "man": man,
                    "int": inte,
                    "end": endu,
                    "total": total,
                }
            )

        offset += int(page_size)

    return out
