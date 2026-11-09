"""
Generate BusWatch's synthetic dataset (8 weeks of weekdays).

    python data/generate_data.py            # writes data/output/*.csv
    python data/generate_data.py some/dir   # writes somewhere else (used by tests)

Every assumption lives in config.py. Same seed -> byte-identical files.
"""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # route names contain "↔"
from datetime import date, timedelta
from itertools import product
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import config as C  # noqa: E402
from utils.simulation import (  # noqa: E402
    buses_per_slot, departure_times, round_half_up, simulate_queue,
    stop_offsets, to_hhmm, to_minutes,
)

SERVICE_START = to_minutes(C.SERVICE_START)
SERVICE_END = to_minutes(C.SERVICE_END)
NUM_SLOTS = (SERVICE_END - SERVICE_START) // C.SLOT_MINUTES   # 48
SLOT_LABELS = [to_hhmm(SERVICE_START + i * C.SLOT_MINUTES) for i in range(NUM_SLOTS)]


def slot_of(minutes):
    """Slot index for a time in minutes since midnight."""
    return (minutes - SERVICE_START) // C.SLOT_MINUTES


# ---------------------------------------------------------------------------
# Routes and schedule
# ---------------------------------------------------------------------------
def route_departures(route, day="Mon"):
    """Departures on a given day: weekday timetable, or the weekend frequency (None = no service)."""
    if day in route["weekend_frequency"]:
        f = route["weekend_frequency"][day]
        return departure_times(f, [], SERVICE_START, SERVICE_END) if f else []
    overrides = [{"start": to_minutes(o["start"]), "end": to_minutes(o["end"]),
                  "frequency": o["frequency"]} for o in route["frequency_overrides"]]
    return departure_times(route["base_frequency"], overrides, SERVICE_START, SERVICE_END)


def seats_at(route, stop_index):
    return round_half_up(C.BUS_SEATS * route["seats_free"][stop_index])


def build_bus_schedule():
    rows = []
    for (service_day, days), (name, route) in product(C.SERVICE_DAYS.items(), C.ROUTES.items()):
        offsets = stop_offsets(route["minutes_between"])
        for trip, dep in enumerate(route_departures(route, days[0]), start=1):
            for k, stop in enumerate(route["stops"]):
                arrival = dep + offsets[k]
                if arrival >= SERVICE_END:
                    continue
                rows.append({
                    "service_day": service_day, "route": name, "trip": trip, "stop": stop, "stop_order": k + 1,
                    "arrival_time": to_hhmm(arrival), "capacity": C.BUS_SEATS,
                    "free_seats_at_stop": seats_at(route, k),
                })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Timetable
# ---------------------------------------------------------------------------
def build_timetable(rng):
    rows = []
    blocks = list(C.BLOCK_TO_STOP)
    # Regular weeks: one timetable per day pattern
    for pattern, spec in C.DAY_PATTERNS.items():
        for block in blocks:
            for room in range(1, C.ROOMS_PER_BLOCK + 1):
                taken = set(C.NO_CLASS_HOURS.get(pattern, []))   # hours already used in this room
                for a in C.ANCHOR_CLASSES:
                    if a["pattern"] == pattern and a["block"] == block and a["room"] == room:
                        start_h = to_minutes(a["start"]) // 60
                        end_h = to_minutes(a["end"]) // 60
                        taken.update(range(start_h, end_h + 1))
                        rows.append(dict(period="regular", days=pattern, block=block, room=room,
                                         start_time=a["start"], end_time=a["end"],
                                         students=a["students"]))
                for h in range(C.FIRST_CLASS_HOUR, C.LAST_CLASS_END_HOUR + 1):
                    if h in taken:
                        continue
                    p = spec["start_probability"] * (C.NOON_START_FACTOR if h == 12 else 1)
                    if rng.random() >= p:
                        continue
                    two = (rng.random() < C.TWO_HOUR_CLASS_SHARE
                           and h + 1 <= C.LAST_CLASS_END_HOUR and (h + 1) not in taken)
                    dur = 2 if two else 1
                    taken.update(range(h, h + dur))
                    lo, hi = C.CLASS_SIZE_RANGE
                    rows.append(dict(period="regular", days=pattern, block=block, room=room,
                                     start_time=f"{h:02d}:00",
                                     end_time=f"{h + dur - 1:02d}:{C.CLASS_END_MINUTE:02d}",
                                     students=int(rng.integers(lo, hi + 1))))
    # Exam week: two sessions a day per block (room 1 = exam hall)
    for day in C.WEEKDAYS:
        for block in blocks:
            for start, end in C.EXAM_SESSIONS:
                lo, hi = C.EXAM_SIZE_RANGE
                rows.append(dict(period="exam_week", days=day, block=block, room=1,
                                 start_time=start, end_time=end,
                                 students=int(rng.integers(lo, hi + 1))))
    tt = pd.DataFrame(rows)
    tt.insert(0, "class_id", [f"{'EX' if p == 'exam_week' else 'C'}{i + 1:03d}"
                              for i, p in enumerate(tt["period"])])
    tt.insert(5, "nearest_stop", tt["block"].map(C.BLOCK_TO_STOP))
    tt["room"] = tt["block"] + tt["room"].astype(str)
    return tt


def classes_on(tt, day_name, is_exam):
    """Classes running on a given weekday (regular or exam timetable)."""
    period = "exam_week" if is_exam else "regular"
    sub = tt[tt["period"] == period]
    return sub[sub["days"].str.split("/").apply(lambda ds: day_name in ds)]


def finishing_by_stop(classes):
    """Students finishing class per stop per slot: a class ending hh:50 counts in the next hh:00 slot."""
    out = {s: np.zeros(NUM_SLOTS) for s in C.STOPS}
    for _, c in classes.iterrows():
        slot = slot_of(to_minutes(c["end_time"]) + C.WALK_MINUTES)   # ends hh:50 -> next hh:00 slot
        if 0 <= slot < NUM_SLOTS:
            out[c["nearest_stop"]][slot] += c["students"]
    return out


def starting_by_stop(classes):
    """Students heading to class per outer stop per slot (before PRE_CLASS_BUS_SHARE)."""
    out = {s: np.zeros(NUM_SLOTS) for s in C.STOPS}
    n = len(C.PRE_CLASS_SPREAD)
    for _, c in classes.iterrows():
        start = slot_of(to_minutes(c["start_time"]))
        for k, share in enumerate(C.PRE_CLASS_SPREAD):
            slot = start - n + k            # [0.4, 0.6] -> 2 slots and 1 slot before the start
            if 0 <= slot < NUM_SLOTS:
                for stop, o in C.PRE_CLASS_ORIGIN.items():
                    out[stop][slot] += c["students"] * o * share
    return out


# ---------------------------------------------------------------------------
# Demand
# ---------------------------------------------------------------------------
def expected_demand(finishing, starting, day_name, is_exam, rain_factor):
    """Expected new students per slot per stop (before noise)."""
    exp = {}
    for stop in C.STOPS:
        e = np.full(NUM_SLOTS, float(C.BACKGROUND_PER_SLOT[stop]))
        for name, spike in C.SPIKES.items():
            factor = C.EXAM_WEEK_SPIKE_FACTOR[name] if is_exam else 1.0
            for i in range(slot_of(to_minutes(spike["start"])), slot_of(to_minutes(spike["end"]))):
                e[i] += spike["per_stop"][stop] * factor
        # Class leavers walk to the stop: spread over this slot and the next
        fin = finishing[stop] * C.BUS_TAKE_SHARE
        for k, share in enumerate(C.ARRIVAL_SPREAD):
            e[k:] += fin[:NUM_SLOTS - k] * share
        e += starting[stop] * C.PRE_CLASS_BUS_SHARE
        exp[stop] = e * C.DAY_FACTOR[day_name] * rain_factor
    return exp


def main(out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(C.RANDOM_SEED)

    timetable = build_timetable(rng)
    schedule = build_bus_schedule()

    # Buses per slot and seats for every day/route/stop
    supply = {}
    for day_name in C.DAYS:
        for name, route in C.ROUTES.items():
            deps = route_departures(route, day_name)
            for k, (stop, off) in enumerate(zip(route["stops"], stop_offsets(route["minutes_between"]))):
                supply[(day_name, name, stop)] = (
                    buses_per_slot(deps, off, SERVICE_START, C.SLOT_MINUTES, NUM_SLOTS), seats_at(route, k))

    start = date.fromisoformat(C.START_DATE)
    assert start.weekday() == 0, "START_DATE must be a Monday"
    rows = []
    for week in range(1, C.NUM_WEEKS + 1):
        for d, day_name in enumerate(C.DAYS):
            day = start + timedelta(weeks=week - 1, days=d)
            is_exam = week == C.EXAM_WEEK
            is_rainy = rng.random() < C.RAIN_PROBABILITY
            rain_factor = rng.uniform(*C.RAIN_UPLIFT_RANGE) if is_rainy else 1.0

            classes = classes_on(timetable, day_name, is_exam)
            exp = expected_demand(finishing_by_stop(classes), starting_by_stop(classes),
                                  day_name, is_exam, rain_factor)

            # Noise per stop, then split the stop's students between its routes
            arrivals = {}
            for stop in C.STOPS:
                wobble = rng.lognormal(0.0, C.NOISE_SIGMA, NUM_SLOTS)
                total = rng.poisson(exp[stop] * wobble)
                # Only routes running today; nobody waits for a bus that has no service
                shares = {r: v for r, v in C.STOP_ROUTE_SHARE[stop].items()
                          if route_departures(C.ROUTES[r], day_name)}
                for r in C.STOP_ROUTE_SHARE[stop]:
                    arrivals[(r, stop)] = [0] * NUM_SLOTS
                if not shares:
                    continue
                p = np.array(list(shares.values())) / sum(shares.values())
                split = np.array([rng.multinomial(t, p) for t in total])
                for j, r in enumerate(shares):
                    arrivals[(r, stop)] = [int(x) for x in split[:, j]]

            # Route-specific rushes (Friday prayers)
            for ev in C.EVENTS:
                if day_name in ev["days"]:
                    for i in range(slot_of(to_minutes(ev["start"])), slot_of(to_minutes(ev["end"]))):
                        arrivals[(ev["route"], ev["stop"])][i] += int(rng.poisson(ev["per_slot"] * rain_factor))

            for name, route in C.ROUTES.items():
                for stop in route["stops"]:
                    buses, seats = supply[(day_name, name, stop)]
                    new = arrivals[(name, stop)]
                    sim = simulate_queue(new, buses, seats, C.GIVE_UP_SHARE, C.SLOT_MINUTES,
                                         C.MAX_HEADWAY, C.MAX_WAIT)
                    for i, s in enumerate(sim):
                        rows.append({
                            "timestamp": f"{day.isoformat()}T{SLOT_LABELS[i]}:00",
                            "date": day.isoformat(), "week": week, "day_of_week": day_name,
                            "time_slot": SLOT_LABELS[i], "stop": stop, "route": name,
                            "students_waiting": s["students_waiting"], "new_arrivals": new[i],
                            "buses_arrived": s["buses_arrived"], "total_capacity": s["total_capacity"],
                            "boarded": s["boarded"], "left_behind": s["left_behind"], "missed_bus": s["missed_bus"],
                            "avg_wait_minutes": s["avg_wait_minutes"],
                            "is_rainy": int(is_rainy), "is_exam_week": int(is_exam),
                        })

    demand = pd.DataFrame(rows)
    demand.to_csv(out_dir / "demand.csv", index=False)
    timetable.to_csv(out_dir / "timetable.csv", index=False)
    schedule.to_csv(out_dir / "bus_schedule.csv", index=False)
    print(f"Wrote {len(demand):,} demand rows, {len(timetable)} classes, "
          f"{len(schedule)} schedule rows to {out_dir}")
    print_sanity(demand)
    return demand


def print_sanity(df):
    """Print the sanity targets from the brief so we can tune config.py."""
    load = df["students_waiting"] / df["total_capacity"].where(df["total_capacity"] > 0)
    minute = df["time_slot"].str[-2:]
    mid = minute == "30"
    change = (minute == "00") & (df["is_exam_week"] == 0)
    util = df["boarded"].sum() / df["total_capacity"].sum()
    print("\nSanity targets")
    print(f"  Bus utilisation (boarded / seats offered): {util:.1%}   target 35-45%")
    print(f"  Slots with someone left behind:            {(df['left_behind'] > 0).mean():.1%}   target ~20-30%")
    print(f"  Half-hour slots (:30) with load < 0.5:     {(load[mid] < 0.5).mean():.1%}   target: most")
    print(f"  Class-change slots (:00) overflowing:      {(load[change] > 1).mean():.1%}   (vs {(load[mid] > 1).mean():.1%} at :30)")
    wk = df[df["day_of_week"].isin(C.WEEKDAYS) & (df["is_exam_week"] == 0)]
    days = wk["date"].nunique()
    print(f"  Weekday boardings / day:                   {wk['boarded'].sum() / days:,.0f}   "
          f"(~{wk['boarded'].sum() / days / 2:,.0f} riders, 2 trips each, of {C.ENROLLED_STUDENTS:,} students)")
    print(f"  Weekday students who miss a full bus / day: {wk['missed_bus'].sum() / days:,.0f}")
    b = df[(df["route"] == C.MV) & df["day_of_week"].isin(["Mon", "Wed"]) & (df["is_exam_week"] == 0)]
    by_slot = b.groupby("time_slot")["missed_bus"].sum() / b["date"].nunique()
    top = by_slot.sort_values(ascending=False).head(4)
    print(f"  {C.MV} Mon/Wed: worst slots (students who miss a full bus / day):")
    for slot, v in top.items():
        print(f"    {slot}  {v:6.1f}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / "data" / "output")
