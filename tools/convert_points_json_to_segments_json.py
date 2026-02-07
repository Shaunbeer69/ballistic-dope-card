#!/usr/bin/env python3
import json
import math
import sys
from pathlib import Path

def points_to_segments(points):
    # points: list of {"v": float, "r": float}
    # We convert adjacent points (v1,r1)->(v2,r2) into a power law:
    # r = A * v^M   on [v1, v2)
    # M = ln(r2/r1)/ln(v2/v1)
    # A = r1 / v1^M
    pts = []
    for p in points:
        v = float(p.get("v", 0))
        r = float(p.get("r", 0))
        if v > 0 and r > 0 and math.isfinite(v) and math.isfinite(r):
            pts.append((v, r))
    pts.sort(key=lambda t: t[0])

    if len(pts) < 2:
        return []

    segs = []
    for i in range(len(pts) - 1):
        v1, r1 = pts[i]
        v2, r2 = pts[i + 1]
        if v2 <= v1 or r2 <= 0 or r1 <= 0:
            continue

        # compute exponent M and coefficient A
        M = math.log(r2 / r1) / math.log(v2 / v1)
        A = r1 / (v1 ** M)

        segs.append({
            "vLoFps": v1,
            "vHiFps": v2,
            "A": A,
            "M": M
        })

    # last segment extends to "infinity"
    v_last, r_last = pts[-1]
    if segs:
        # keep last segment’s A/M behavior
        segs.append({
            "vLoFps": v_last,
            "vHiFps": 1.0e9,
            "A": segs[-1]["A"],
            "M": segs[-1]["M"]
        })

    return segs

def main():
    if len(sys.argv) != 5:
        print("Usage: convert_points_json_to_segments_json.py <g1_points.json> <g7_points.json> <out_g1.json> <out_g7.json>")
        sys.exit(2)

    g1_in = Path(sys.argv[1])
    g7_in = Path(sys.argv[2])
    g1_out = Path(sys.argv[3])
    g7_out = Path(sys.argv[4])

    g1_points = json.loads(g1_in.read_text(encoding="utf-8"))
    g7_points = json.loads(g7_in.read_text(encoding="utf-8"))

    g1_segs = points_to_segments(g1_points)
    g7_segs = points_to_segments(g7_points)

    g1_payload = {"model": "G1", "units": "fps", "source": "converted-from-points", "segments": g1_segs}
    g7_payload = {"model": "G7", "units": "fps", "source": "converted-from-points", "segments": g7_segs}

    g1_out.parent.mkdir(parents=True, exist_ok=True)
    g7_out.parent.mkdir(parents=True, exist_ok=True)

    g1_out.write_text(json.dumps(g1_payload, indent=2), encoding="utf-8")
    g7_out.write_text(json.dumps(g7_payload, indent=2), encoding="utf-8")

    print(f"OK: {g1_out} segments={len(g1_segs)}")
    print(f"OK: {g7_out} segments={len(g7_segs)}")

if __name__ == "__main__":
    main()
