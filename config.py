"""
BusWatch configuration: the ONE place for every synthetic-data assumption.

Everything the generator, model, export script and website use comes from here.
When you collect real survey / stop-observation numbers, change the values below,
re-run the pipeline (see README "Calibrating"), and the whole site updates.

Times are "HH:MM" strings, minutes are integers, shares are 0..1.
"""

# --------------------------------------------------------------------------
# General
# --------------------------------------------------------------------------
RANDOM_SEED = 42                 # fixed seed -> identical files on every run
START_DATE = "2026-01-05"        # must be a Monday
NUM_WEEKS = 8                    # 7 days a week
EXAM_WEEK = 8                    # week number (1-based) that is exam week

SERVICE_START = "07:00"          # first bus / first time slot
SERVICE_END = "19:00"            # service ends (exclusive)
SLOT_MINUTES = 30                # 07:00-19:00 in 30-min slots = 24 slots/day (one per departure)

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
DAYS = WEEKDAYS + ["Sat", "Sun"]
# Bus timetables, like the tabs in APSpace
SERVICE_DAYS = {"Mon - Fri": WEEKDAYS, "Saturday": ["Sat"], "Sunday": ["Sun"]}

# --------------------------------------------------------------------------
# Campus: stops and academic blocks (APU, Bukit Jalil)
# --------------------------------------------------------------------------
# APU is the campus; the other stops are where students come from (LRT, the
# M Vertica / Parkhill residences, the mosque).
STOPS = ["APU", "LRT - Bukit Jalil", "M Vertica", "Parkhill", "Mosque"]
ENROLLED_STUDENTS = 10_000       # size of the school (used for sanity checks and the home page)

# Each academic block -> nearest bus stop (all teaching happens on campus)
BLOCK_TO_STOP = {b: "APU" for b in "ABCDEF"}
ROOMS_PER_BLOCK = 4

# --------------------------------------------------------------------------
# Buses and routes
# --------------------------------------------------------------------------
BUS_SEATS = 40

# One direct shuttle per path (like APSpace): APU <-> each outer stop. Each shuttle is a loop:
# it leaves the outer stop on :00 / :30, drops everyone at APU, and takes APU students back.
# minutes_between: minutes after the departure time that the bus is at each stop. Both ends run their
#   own timetable on :00 / :30 (like APSpace), so this is 0 at both ends.
# travel_minutes: driving time from one end to the other (used by the live tracker).
# seats_free: share of the 40 seats free when the bus reaches each stop (empty at both ends).
# Buses leave every 30 minutes (on :00 and :30); extra buses double up on those departures.
# frequency_overrides: weekday windows where the bus runs at a different frequency.
#   The bus frequency in force at a departure decides when the NEXT bus leaves.
# weekend_frequency: minutes between buses on Sat / Sun (None = no service).
# round_trip_minutes: how long one trip ties up a bus and driver (used for cost).
# Simplification: students boarding at APU ride the same bus back out; we don't
# model the return leg separately.
LRT, MV, PH, MOSQUE = "APU ↔ LRT - Bukit Jalil", "APU ↔ M Vertica", "APU ↔ Parkhill", "APU ↔ Mosque"
LUNCH_BREAK = {"start": "12:00", "end": "13:00", "frequency": 60, "reason": "Driver lunch break"}
ROUTES = {
    LRT: {
        "stops": ["LRT - Bukit Jalil", "APU"],
        "minutes_between": [0, 0],
        "travel_minutes": 8,
        "base_frequency": 30,
        "frequency_overrides": [
            {"start": "17:00", "end": "18:00", "frequency": 60, "reason": "Driver shift change"},
        ],
        "weekend_frequency": {"Sat": 60, "Sun": 60},
        "round_trip_minutes": 25,
        "seats_free": [1.0, 1.0],
        "colour": "#465fff",
    },
    MV: {
        "stops": ["M Vertica", "APU"],
        "minutes_between": [0, 0],
        "travel_minutes": 20,
        "base_frequency": 30,
        # Deliberately under-served at peak: the residence drivers' lunch break skips the 12:30 bus
        "frequency_overrides": [LUNCH_BREAK],
        "weekend_frequency": {"Sat": 60, "Sun": 60},
        "round_trip_minutes": 45,
        "seats_free": [1.0, 1.0],
        "colour": "#8b5cf6",
    },
    PH: {
        "stops": ["Parkhill", "APU"],
        "minutes_between": [0, 0],
        "travel_minutes": 10,
        "base_frequency": 30,
        "frequency_overrides": [LUNCH_BREAK],
        "weekend_frequency": {"Sat": 60, "Sun": 60},
        "round_trip_minutes": 25,
        "seats_free": [1.0, 1.0],
        "colour": "#06b6d4",
    },
    MOSQUE: {
        "stops": ["Mosque", "APU"],
        "minutes_between": [0, 0],
        "travel_minutes": 5,
        "base_frequency": 30,
        "frequency_overrides": [],
        "weekend_frequency": {"Sat": 60, "Sun": None},
        "round_trip_minutes": 15,
        "seats_free": [1.0, 1.0],
        "colour": "#ec4899",
    },
}

# Map positions (latitude, longitude) for the live tracker. APPROXIMATE: replace with the exact
# GPS points of each pick-up spot.
STOP_LOCATIONS = {
    "APU": [3.0553, 101.7006],
    "LRT - Bukit Jalil": [3.0582, 101.6921],
    "M Vertica": [3.1130, 101.7367],
    "Parkhill": [3.0612, 101.6745],
    "Mosque": [3.0617, 101.6875],
}

# Students waiting at APU split by where they are going (survey: "Where do you take the shuttle to?")
STOP_ROUTE_SHARE = {
    "APU":               {LRT: 0.32, MV: 0.22, PH: 0.22, MOSQUE: 0.24},
    "LRT - Bukit Jalil": {LRT: 1.0},
    "M Vertica":         {MV: 1.0},
    "Parkhill":          {PH: 1.0},
    "Mosque":            {MOSQUE: 1.0},
}

# --------------------------------------------------------------------------
# Class timetable
# --------------------------------------------------------------------------
FIRST_CLASS_HOUR = 8             # classes start on the hour ...
LAST_CLASS_END_HOUR = 17         # ... and the last one ends at 17:50
CLASS_END_MINUTE = 50            # classes end at hh:50
CLASS_SIZE_RANGE = (30, 120)     # students per class (uniform)
TWO_HOUR_CLASS_SHARE = 0.35      # share of classes lasting 2 hours

# Chance that a free room gets a class starting at a given hour.
# Mon/Wed share one timetable, Tue/Thu another, Friday is lighter.
DAY_PATTERNS = {
    "Mon/Wed": {"days": ["Mon", "Wed"], "start_probability": 0.55},
    "Tue/Thu": {"days": ["Tue", "Thu"], "start_probability": 0.50},
    "Fri":     {"days": ["Fri"],        "start_probability": 0.35},
    "Sat":     {"days": ["Sat"],        "start_probability": 0.12},   # part-time classes; none on Sunday
}
# Hours when no class may run: Friday prayers (12:00-13:59)
NO_CLASS_HOURS = {"Fri": [12, 13]}
NOON_START_FACTOR = 0.4          # fewer classes start at 12:00 (lunch)

# Big lectures we force into the timetable (they exist on every real campus).
# Their students reach APU for the 12:00 bus on Mon/Wed, right as the residence shuttles' lunch break starts.
ANCHOR_CLASSES = [
    {"pattern": "Mon/Wed", "block": "A", "room": 1, "start": "10:00", "end": "11:50", "students": 180},
    {"pattern": "Mon/Wed", "block": "B", "room": 1, "start": "11:00", "end": "11:50", "students": 160},
]

# Exam week: normal classes stop, two exam sessions a day per block.
EXAM_SESSIONS = [("09:00", "11:50"), ("14:00", "16:50")]
EXAM_SIZE_RANGE = (150, 300)     # students per block per session

# --------------------------------------------------------------------------
# Demand rules
# --------------------------------------------------------------------------
BUS_TAKE_SHARE = 0.24            # share of students leaving a class who take the shuttle (most have another class or walk)
# Students walk WALK_MINUTES to the stop. A class ending at hh:50 puts this share into
# the next hh:00 slot (they catch the :00 bus) and the rest into the hh:30 slot.
WALK_MINUTES = 10
ARRIVAL_SPREAD = [0.7, 0.3]

# Trickle of students per slot at each stop (LRT has a steady flow all day)
BACKGROUND_PER_SLOT = {"APU": 4, "LRT - Bukit Jalil": 5, "M Vertica": 3, "Parkhill": 3, "Mosque": 3}

# Students going TO class board at the outer stops before it starts.
PRE_CLASS_BUS_SHARE = 0.24       # share of students starting a class who come by shuttle (most are already on campus)
PRE_CLASS_SPREAD = [0.4, 0.6]    # class at hh:00 -> 40% take the (hh-1):00 bus, 60% the (hh-1):30 bus
PRE_CLASS_ORIGIN = {"LRT - Bukit Jalil": 0.28, "M Vertica": 0.25, "Parkhill": 0.25, "Mosque": 0.22}

# Rushes tied to ONE route (added after the stop's route split), e.g. Friday prayers
EVENTS = [
    {"name": "Friday prayers (to the mosque)", "days": ["Fri"], "start": "12:00", "end": "13:00",
     "stop": "APU", "route": MOSQUE, "per_slot": 12},
    {"name": "Friday prayers (back to campus)", "days": ["Fri"], "start": "13:30", "end": "14:30",
     "stop": "Mosque", "route": MOSQUE, "per_slot": 12},
]

# Extra spikes: students per slot per stop during each window (end exclusive).
SPIKES = {
    "morning": {"start": "07:30", "end": "08:15", "per_stop": {
        "APU": 2, "LRT - Bukit Jalil": 10, "M Vertica": 10, "Parkhill": 10, "Mosque": 6}},
    "lunch": {"start": "12:00", "end": "13:00", "per_stop": {
        "APU": 10, "LRT - Bukit Jalil": 3, "M Vertica": 4, "Parkhill": 4, "Mosque": 3}},
    "home": {"start": "17:00", "end": "18:30", "per_stop": {
        "APU": 16, "LRT - Bukit Jalil": 2, "M Vertica": 2, "Parkhill": 2, "Mosque": 2}},
}
EXAM_WEEK_SPIKE_FACTOR = {"morning": 1.0, "lunch": 0.5, "home": 0.6}

DAY_FACTOR = {"Mon": 1.08, "Tue": 1.0, "Wed": 1.06, "Thu": 1.0, "Fri": 0.85, "Sat": 0.45, "Sun": 0.30}

RAIN_PROBABILITY = 0.30          # share of days with rain
RAIN_UPLIFT_RANGE = (1.20, 1.30) # demand multiplier on rainy days

NOISE_SIGMA = 0.15               # log-normal wobble on expected demand

# --------------------------------------------------------------------------
# Queue behaviour
# --------------------------------------------------------------------------
GIVE_UP_SHARE = 0.25             # left-behind students who give up each slot
MAX_HEADWAY = 60                 # minutes, used when no bus comes in the hour
MAX_WAIT = 90                    # cap on avg_wait_minutes

# --------------------------------------------------------------------------
# Dashboard thresholds and colours
# --------------------------------------------------------------------------
LOAD_THRESHOLDS = {"busy": 0.8, "overflow": 1.0}   # load = waiting / seats offered
UNDERUSED_UTILISATION = 0.50     # an hour with < 50% of seats used is "under-used"
COST_PER_BUS_HOUR = 90           # RM per bus-hour (driver + fuel), used to price schedule changes
OVERLOAD_MISSED = 15             # students per day who miss a full bus in one shuttle-slot (both ends) to flag it

COLOURS = {
    "background": "#101828", "card": "#161f30", "accent": "#465fff",
    "ok": "#12b76a", "busy": "#f79009", "overflow": "#f04438",
}

# --------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------
TEST_WEEKS = [5, 6, 7]           # held-out normal weeks, evaluated one at a time
