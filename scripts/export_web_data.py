"""
Export the generated data + model metrics to web/data/*.json for the website.

    python scripts/export_web_data.py

These JSON files are the website's offline fallback (and meta.json carries
config.py to the browser, so config.py stays the single source of truth).
"""
import json
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # route names contain "↔"
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import config as C  # noqa: E402

OUT = ROOT / "data" / "output"
WEB = ROOT / "web" / "data"

# demand.json column -> CSV column. Each is a plain array (columnar = small file).
DEMAND_COLUMNS = ["students_waiting", "new_arrivals", "buses_arrived", "total_capacity",
                  "boarded", "left_behind", "missed_bus", "avg_wait_minutes", "predicted_waiting"]


def write(name, obj):
    path = WEB / name
    path.write_text(json.dumps(obj, separators=(",", ":")))
    print(f"  {name:18s} {path.stat().st_size / 1024:8.1f} KB")


def main():
    WEB.mkdir(parents=True, exist_ok=True)
    df = pd.read_csv(OUT / "demand.csv")
    if "predicted_waiting" not in df:
        sys.exit("Run model/predict.py first (predicted_waiting missing).")

    # Per-date info stored once; rows point at a date index.
    days = df.drop_duplicates("date")[["date", "week", "day_of_week", "is_rainy", "is_exam_week"]]
    date_index = {d: i for i, d in enumerate(days["date"])}
    slots = sorted(df["time_slot"].unique())
    stops, routes = list(C.STOPS), list(C.ROUTES)

    demand = {
        "dates": days.to_dict("list"),
        "stops": stops, "routes": routes, "time_slots": slots,
        "rows": {
            "date": df["date"].map(date_index).tolist(),
            "slot": df["time_slot"].map({s: i for i, s in enumerate(slots)}).tolist(),
            "stop": df["stop"].map(stops.index).tolist(),
            "route": df["route"].map(routes.index).tolist(),
            **{c: df[c].tolist() for c in DEMAND_COLUMNS},
        },
    }

    meta = {
        "data_label": "Simulated data",
        "start_date": C.START_DATE, "num_weeks": C.NUM_WEEKS, "exam_week": C.EXAM_WEEK,
        "service_start": C.SERVICE_START, "service_end": C.SERVICE_END,
        "slot_minutes": C.SLOT_MINUTES, "time_slots": slots, "weekdays": C.WEEKDAYS,
        "days": C.DAYS, "service_days": C.SERVICE_DAYS, "events": C.EVENTS,
        "cost_per_bus_hour": C.COST_PER_BUS_HOUR,
        "stops": stops, "block_to_stop": C.BLOCK_TO_STOP, "enrolled_students": C.ENROLLED_STUDENTS, "stop_locations": C.STOP_LOCATIONS,
        "routes": C.ROUTES, "stop_route_share": C.STOP_ROUTE_SHARE,
        "bus_seats": C.BUS_SEATS, "bus_take_share": C.BUS_TAKE_SHARE,
        "day_patterns": {k: v["days"] for k, v in C.DAY_PATTERNS.items()},
        "queue": {"give_up_share": C.GIVE_UP_SHARE, "max_headway": C.MAX_HEADWAY,
                  "max_wait": C.MAX_WAIT},
        "thresholds": {**C.LOAD_THRESHOLDS, "underused_utilisation": C.UNDERUSED_UTILISATION,
                       "overload_missed": C.OVERLOAD_MISSED},
        "rain": {"probability": C.RAIN_PROBABILITY, "uplift_range": C.RAIN_UPLIFT_RANGE},
        "colours": C.COLOURS,
    }

    print("Writing web/data/")
    write("demand.json", demand)
    write("timetable.json", pd.read_csv(OUT / "timetable.csv").to_dict("records"))
    write("bus_schedule.json", pd.read_csv(OUT / "bus_schedule.csv").to_dict("records"))
    write("metrics.json", json.loads((ROOT / "model" / "metrics.json").read_text()))
    write("meta.json", meta)


if __name__ == "__main__":
    main()
