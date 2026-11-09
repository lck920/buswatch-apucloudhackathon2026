"""
Train BusWatch's demand model: predict students_waiting per stop/route/slot.

    python model/predict.py

- Builds features from timetable.csv: students finishing class near each stop, and
  students starting class soon (they board at the outer stops: LRT, residences, mosque).
- Compares RandomForest vs HistGradientBoosting(poisson) on held-out weeks.
- Compares both against a historical-average baseline (same stop/route/day/slot).
- Saves model/demand_model.joblib, model/metrics.json and adds a
  `predicted_waiting` column to data/output/demand.csv. Each week's prediction
  comes from a model that never saw that week (out-of-week), so the
  supply-vs-demand chart is honest.
"""
import json
import os
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # route names contain "↔"

os.environ.setdefault("LOKY_MAX_CPU_COUNT", str(os.cpu_count() or 1))  # silences a Windows joblib warning
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.metrics import mean_absolute_error, r2_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import config as C  # noqa: E402
from utils.simulation import to_minutes  # noqa: E402

OUT = ROOT / "data" / "output"
SERVICE_START = to_minutes(C.SERVICE_START)


def finishing_table(tt):
    """Students finishing class per (period, weekday, stop, slot) from the timetable."""
    rows = []
    for _, c in tt.iterrows():
        slot = (to_minutes(c["end_time"]) + C.WALK_MINUTES - SERVICE_START) // C.SLOT_MINUTES  # hh:50 -> next hh:00
        for day in c["days"].split("/"):
            rows.append((int(c["period"] == "exam_week"), day, c["nearest_stop"], slot, c["students"]))
    f = pd.DataFrame(rows, columns=["is_exam_week", "day_of_week", "stop", "slot", "finishing_now"])
    return f.groupby(["is_exam_week", "day_of_week", "stop", "slot"], as_index=False).sum()


def starting_table(tt):
    """Students starting class per (period, weekday, origin stop, slot), split by PRE_CLASS_ORIGIN."""
    rows = []
    for _, c in tt.iterrows():
        slot = (to_minutes(c["start_time"]) - SERVICE_START) // C.SLOT_MINUTES
        for day in c["days"].split("/"):
            for stop, share in C.PRE_CLASS_ORIGIN.items():
                rows.append((int(c["period"] == "exam_week"), day, stop, slot, c["students"] * share))
    f = pd.DataFrame(rows, columns=["is_exam_week", "day_of_week", "stop", "slot", "starting"])
    return f.groupby(["is_exam_week", "day_of_week", "stop", "slot"], as_index=False).sum()


def build_features(df, tt):
    d = df.copy()
    d["slot"] = (d["time_slot"].map(to_minutes) - SERVICE_START) // C.SLOT_MINUTES
    fin = finishing_table(tt)
    d = d.merge(fin, on=["is_exam_week", "day_of_week", "stop", "slot"], how="left")
    prev = fin.assign(slot=fin["slot"] + 1).rename(columns={"finishing_now": "finishing_prev"})
    d = d.merge(prev, on=["is_exam_week", "day_of_week", "stop", "slot"], how="left")
    # Classes starting 30 / 60 minutes after this slot begins
    start = starting_table(tt)
    keys = ["is_exam_week", "day_of_week", "stop", "slot"]
    for name, ahead in (("starting_in_30", 1), ("starting_in_60", 2)):
        d = d.merge(start.assign(slot=start["slot"] - ahead).rename(columns={"starting": name}), on=keys, how="left")
    cols = ["finishing_now", "finishing_prev", "starting_in_30", "starting_in_60"]
    d[cols] = d[cols].fillna(0)

    X = pd.DataFrame({
        "day_of_week": d["day_of_week"].map({k: i for i, k in enumerate(C.DAYS)}),
        "time_slot": d["slot"],
        "finishing_now": d["finishing_now"],
        "finishing_prev": d["finishing_prev"],
        "starting_in_30": d["starting_in_30"],
        "starting_in_60": d["starting_in_60"],
        "buses_scheduled": d["buses_arrived"],
        "capacity_scheduled": d["total_capacity"],
        "is_rainy": d["is_rainy"],
        "is_exam_week": d["is_exam_week"],
        "rain_x_finishing_now": d["is_rainy"] * d["finishing_now"],
        "rain_x_finishing_prev": d["is_rainy"] * d["finishing_prev"],
    })
    for s in C.STOPS:
        X[f"stop={s}"] = (d["stop"] == s).astype(int)
    for r in C.ROUTES:
        X[f"route={r}"] = (d["route"] == r).astype(int)
    return X


def make_models():
    return {
        "RandomForest": RandomForestRegressor(n_estimators=200, min_samples_leaf=3,
                                              n_jobs=-1, random_state=C.RANDOM_SEED),
        "HistGradientBoosting (Poisson)": HistGradientBoostingRegressor(
            loss="poisson", max_iter=400, learning_rate=0.05, random_state=C.RANDOM_SEED),
    }


def baseline_predict(train, test):
    """Historical average for the same stop, route, weekday and slot (normal weeks only)."""
    keys = ["stop", "route", "day_of_week", "time_slot"]
    hist = train[train["is_exam_week"] == 0].groupby(keys)["students_waiting"].mean()
    return test[keys].merge(hist.rename("b").reset_index(), on=keys, how="left")["b"].fillna(0).to_numpy()


def scores(y, p, rainy):
    return {"mae": float(mean_absolute_error(y, p)), "r2": float(r2_score(y, p)),
            "mae_rainy": float(mean_absolute_error(y[rainy], p[rainy])) if rainy.any() else None}


def main():
    df = pd.read_csv(OUT / "demand.csv")
    df = df.drop(columns=["predicted_waiting"], errors="ignore")
    tt = pd.read_csv(OUT / "timetable.csv")
    X = build_features(df, tt)
    y = df["students_waiting"].to_numpy()

    # ---- Evaluate each candidate + baseline on each held-out week ----
    results = {name: [] for name in [*make_models(), "Baseline (historical average)"]}
    for w in C.TEST_WEEKS:
        tr, te = (df["week"] != w).to_numpy(), (df["week"] == w).to_numpy()
        rainy = df.loc[te, "is_rainy"].to_numpy() == 1
        for name, m in make_models().items():
            m.fit(X[tr], y[tr])
            results[name].append({"week": w, **scores(y[te], m.predict(X[te]), rainy)})
        b = baseline_predict(df[tr], df[te])
        results["Baseline (historical average)"].append({"week": w, **scores(y[te], b, rainy)})

    def avg(rows, k):
        vals = [r[k] for r in rows if r[k] is not None]
        return float(np.mean(vals)) if vals else None

    summary = {name: {"mae": avg(r, "mae"), "r2": avg(r, "r2"), "mae_rainy": avg(r, "mae_rainy"),
                      "per_week": r} for name, r in results.items()}

    print(f"{'Model':34s} {'week':>5s} {'MAE':>7s} {'R2':>7s} {'MAE rainy':>10s}")
    for name, s in summary.items():
        for r in s["per_week"]:
            rain = f"{r['mae_rainy']:.2f}" if r["mae_rainy"] is not None else "  (none)"
            print(f"{name:34s} {r['week']:5d} {r['mae']:7.2f} {r['r2']:7.3f} {rain:>10s}")
        print(f"{name:34s} {'avg':>5s} {s['mae']:7.2f} {s['r2']:7.3f} "
              f"{(s['mae_rainy'] or 0):10.2f}\n")

    candidates = [n for n in make_models()]
    best = min(candidates, key=lambda n: summary[n]["mae"])
    base = summary["Baseline (historical average)"]
    wins = sum(m["mae"] < b["mae"] for m, b in zip(summary[best]["per_week"], base["per_week"]))
    print(f"Chosen: {best} (beats baseline on {wins}/{len(C.TEST_WEEKS)} weeks)")

    # ---- Out-of-week predictions for every week (honest chart values) ----
    pred = np.zeros(len(df))
    for w in sorted(df["week"].unique()):
        tr, te = (df["week"] != w).to_numpy(), (df["week"] == w).to_numpy()
        m = make_models()[best].fit(X[tr], y[tr])
        pred[te] = m.predict(X[te])
    df["predicted_waiting"] = np.clip(pred, 0, None).round(1)
    df.to_csv(OUT / "demand.csv", index=False)

    # ---- Final model on all data, plus feature importance ----
    final = make_models()[best].fit(X, y)
    joblib.dump(final, ROOT / "model" / "demand_model.joblib", compress=3)
    last = (df["week"] == C.TEST_WEEKS[-1]).to_numpy()
    imp = permutation_importance(final, X[last], y[last], n_repeats=3, random_state=C.RANDOM_SEED)
    grouped = {}
    for col, v in zip(X.columns, imp.importances_mean):
        key = col.split("=")[0]   # stop=APU -> stop
        grouped[key] = grouped.get(key, 0) + float(v)
    total = sum(max(v, 0) for v in grouped.values()) or 1
    importance = sorted(({"feature": k, "importance": round(max(v, 0) / total, 4)}
                         for k, v in grouped.items()), key=lambda r: -r["importance"])

    metrics = {
        "chosen_model": best,
        "target": "students_waiting",
        "test_weeks": C.TEST_WEEKS,
        "models": summary,
        "chosen": {k: summary[best][k] for k in ("mae", "r2", "mae_rainy")},
        "baseline": {k: base[k] for k in ("mae", "r2", "mae_rainy")},
        "weeks_beating_baseline": wins,
        "feature_importance": importance,
        "note": ("Because the timetable repeats every week, the historical average is a strong "
                 "baseline. The model's advantage is that it can forecast a new timetable or "
                 "weather it has not seen before."),
    }
    (ROOT / "model" / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print("Feature importance:", ", ".join(f"{r['feature']} {r['importance']:.0%}" for r in importance[:6]))
    print("Saved model/demand_model.joblib, model/metrics.json, predicted_waiting in demand.csv")


if __name__ == "__main__":
    main()
