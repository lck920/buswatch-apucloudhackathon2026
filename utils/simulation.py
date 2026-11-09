"""
BusWatch queue engine.

Shared by the data generator (Python) and ported line-for-line to
web/js/simulation.js for the browser What-If simulator. If you change a
formula here, change it there too; tests/test_parity.mjs checks they agree.

All times are "minutes since midnight". Rounding is round-half-up (not Python's
banker's rounding) so JavaScript gives identical numbers.
"""
import math


def round_half_up(x):
    """Round to the nearest whole number, .5 always goes up (like JS Math.round for x >= 0)."""
    return math.floor(x + 0.5)


def round1(x):
    """Round half up to 1 decimal place."""
    return math.floor(x * 10 + 0.5) / 10


def to_minutes(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def to_hhmm(minutes):
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def departure_times(base_frequency, overrides, service_start, service_end):
    """First-stop departure times. The frequency in force at each departure
    (base, or an override window containing it) decides when the next bus leaves."""
    deps = []
    t = service_start
    while t < service_end:
        deps.append(t)
        freq = base_frequency
        for o in overrides:
            if o["start"] <= t < o["end"]:
                freq = o["frequency"]
        t += freq
    return deps


def stop_offsets(minutes_between):
    """Cumulative minutes from the first stop to each stop."""
    out, total = [], 0
    for m in minutes_between:
        total += m
        out.append(total)
    return out


def buses_per_slot(departures, offset, service_start, slot_minutes, num_slots):
    """How many buses reach a stop (offset minutes after departure) in each slot."""
    counts = [0] * num_slots
    for d in departures:
        slot = (d + offset - service_start) // slot_minutes
        if 0 <= slot < num_slots:
            counts[slot] += 1
    return counts


def simulate_queue(new_arrivals, buses, seats_per_bus, give_up_share, slot_minutes,
                   max_headway, max_wait):
    """Run one day of the queue at one stop for one route.

    new_arrivals: fresh students per slot; buses: buses arriving per slot.
    Returns a list of dicts (one per slot)."""
    n = len(new_arrivals)
    out = []
    carry = 0           # students still waiting from earlier slots
    carry_missed = 0    # ... of whom this many have already watched a full bus leave
    half = 60 // slot_minutes // 2
    for i in range(n):
        waiting = carry + new_arrivals[i]
        capacity = buses[i] * seats_per_bus
        boarded = min(waiting, capacity)
        if buses[i] == 0:
            # No bus this slot: nobody is "left behind", they just keep waiting
            left = missed = 0
        else:
            left = waiting - boarded
            # Left behind for the FIRST time (those who already missed a bus are at the
            # front and board first), so each student counts once.
            missed = left - max(0, carry_missed - capacity)

        # Headway from the slots with a bus in the surrounding hour.
        # Two buses doubling up on one departure add seats, not frequency.
        lo, hi = max(0, i - half), min(n - 1, i + half - 1)
        window_slots = hi - lo + 1
        count = 0
        for j in range(lo, hi + 1):
            count += 1 if buses[j] > 0 else 0
        if count == 0:
            headway = max_headway
        else:
            headway = min(max_headway, slot_minutes * window_slots / count)

        if waiting == 0:
            wait = 0.0
        else:
            # half a headway on average, plus a full extra headway for those left behind
            wait = headway / 2 + headway * (left / waiting)
            wait = min(max_wait, wait)
        out.append({
            "students_waiting": waiting,
            "buses_arrived": buses[i],
            "total_capacity": capacity,
            "boarded": boarded,
            "left_behind": left,
            "missed_bus": missed,
            "avg_wait_minutes": round1(wait),
        })
        if buses[i] == 0:
            carry = waiting          # everyone waits on; nobody gives up without seeing a full bus
        else:
            give_up = round_half_up(left * give_up_share)
            carry = left - give_up
            carry_missed = carry
    return out
