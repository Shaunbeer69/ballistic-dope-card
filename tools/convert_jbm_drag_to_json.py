#!/usr/bin/env python3
import json
import math
import re
import sys
from pathlib import Path

NUM_RE = re.compile(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?")
A0_FPS = 1116.45  # speed of sound at sea level (fps)

def parse_two_columns(path: Path):
    rows = []
    for line in path.read_text(errors="ignore").splitlines():
        nums = NUM_RE.findall(line)
        if len(nums) < 2:
            continue
        m = float(nums[0])
        r = float(nums[1])
        if m > 0 and r > 0:
            rows.append((m, r))
    return rows

def mach_to_fps(m):
    return m * A0_FPS

def write_json(rows, out_path: Path):
    data = [{"v": mach_to_fps(m), "r": r} for (m, r) in rows]
    data.sort(key=lambda x: x["v"])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, indent=2))
    print(f"Wrote {len(data)} rows → {out_path}")

def main():
    if len(sys.argv) != 5:
        print("Usage: convert_jbm_drag_to_json.py g1.txt g7.txt g1.json g7.json")
        sys.exit(1)

    g1 = Path(sys.argv[1])
    g7 = Path(sys.argv[2])
    out1 = Path(sys.argv[3])
    out7 = Path(sys.argv[4])

    write_json(parse_two_columns(g1), out1)
    write_json(parse_two_columns(g7), out7)

if __name__ == "__main__":
    main()
