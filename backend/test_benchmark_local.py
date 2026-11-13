"""Local smoke test: real-data detector + ground-truth benchmark."""
import sys, time
sys.path.insert(0, "backend")

t0 = time.time()
from real_data.detector import get_reference, model_info
ref = get_reference()
print(f"Reference model built in {time.time()-t0:.1f}s")
print(f"  reference records: {ref.reference_records:,} (typical state, all SCADA)")
print(f"  trained rows: {ref.trained_records:,}")
print(f"  hour buckets: {len(ref.stats['flow'])}")
print(f"  pressure sensors: {len(ref.press_sensors)}")

t0 = time.time()
from real_data.evaluate import run_benchmark
report = run_benchmark()
print(f"Benchmark ran in {time.time()-t0:.1f}s")
m = report["metrics"]
print("\n=== METRICS ===")
for k, v in m.items():
    print(f"  {k}: {v}")
print("\n=== EVENTS ===")
for e in report["events"]:
    lat = e["latency_min"]
    print(f"  {e['pipe']:>5} start={e['start']} dur={e['duration_hours']:>7}h max={e['max_rate_m3h']:>6} m3/h "
          f"detected={'YES' if e['detected'] else 'no ':3} latency={str(lat):>8} pre_alarm={e['pre_alarms']} "
          f"peak={e['peak_score']:.2f} sensor={e['reacted_sensor']}")
