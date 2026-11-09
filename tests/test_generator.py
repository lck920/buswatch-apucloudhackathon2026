"""Generator test: two runs must produce byte-identical files, and the row count must match.

    python tests/test_generator.py
"""
import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ["demand.csv", "timetable.csv", "bus_schedule.csv"]


def digest(folder):
    return {f: hashlib.md5((Path(folder) / f).read_bytes()).hexdigest() for f in FILES}


with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
    for d in (a, b):
        subprocess.run([sys.executable, str(ROOT / "data" / "generate_data.py"), d],
                       check=True, capture_output=True)
    assert digest(a) == digest(b), "Generator is not deterministic"
    rows = sum(1 for _ in open(Path(a) / "demand.csv")) - 1
    assert rows == 8 * 7 * 24 * 8, rows   # 8 weeks x 7 days x 24 half-hour slots x 4 shuttles x 2 stops

print("OK: generator is deterministic, demand.csv has 10,752 rows")
