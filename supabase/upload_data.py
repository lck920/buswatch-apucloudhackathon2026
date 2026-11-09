"""
Upload the generated data to Supabase (clears each table first).

    python supabase/upload_data.py

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (see .env.example).
The service role key bypasses RLS, so keep it on your laptop only: never in web/.

"""
import json
import math
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # route names contain "↔"
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "output"
BATCH = 1000


def load_env():
    """Tiny .env reader (KEY=value lines), so we don't need python-dotenv."""
    env = {}
    path = ROOT / ".env"
    if not path.exists():
        sys.exit("Missing .env - copy .env.example to .env and fill it in.")
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if not env.get(k):
            sys.exit(f"{k} is empty in .env")
    return env


def clean(records):
    """NaN -> None so it becomes JSON null."""
    return [{k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in r.items()}
            for r in records]


def main():
    env = load_env()
    base = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/"
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}",
               "Content-Type": "application/json", "Prefer": "return=minimal"}

    metrics = json.loads((ROOT / "model" / "metrics.json").read_text())
    tables = {
        # table: (records, filter that matches every row - Supabase refuses DELETE without one)
        "demand": (pd.read_csv(OUT / "demand.csv").to_dict("records"), "id=gte.0"),
        "timetable": (pd.read_csv(OUT / "timetable.csv").to_dict("records"), "class_id=not.is.null"),
        "bus_schedule": (pd.read_csv(OUT / "bus_schedule.csv").to_dict("records"), "id=gte.0"),
        "model_metrics": ([{"id": 1, "metrics": metrics}], "id=gte.0"),
    }

    for table, (records, match_all) in tables.items():
        r = requests.delete(base + f"{table}?{match_all}", headers=headers, timeout=60)
        r.raise_for_status()
        records = clean(records)
        for i in range(0, len(records), BATCH):
            r = requests.post(base + table, headers=headers, json=records[i:i + BATCH], timeout=60)
            if not r.ok:
                sys.exit(f"Upload to {table} failed ({r.status_code}): {r.text[:300]}")
        print(f"  {table:14s} {len(records):6,d} rows uploaded")
    print("Done. Open the site: the badge should say 'Live: Supabase'.")


if __name__ == "__main__":
    main()
