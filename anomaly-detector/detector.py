"""
Anomaly detector - Week 3 (v2: self-baselining)

Instead of comparing one IP's traffic to OTHER IPs (which needs multiple
real clients to be useful), this version compares each IP against its
OWN recent history. We split the last HISTORY_SECONDS of an IP's
activity into fixed-size time buckets, treat the most recent bucket as
"right now", and everything before it as "this IP's normal baseline".
If right-now is a statistical outlier compared to that IP's own past
behavior, we flag it.

This is genuinely how a lot of real anomaly detection works - self
baselining per entity (per-user, per-IP, per-service) rather than
only comparing peers to each other.
"""

import os
import time
import statistics
from collections import defaultdict, deque

import redis

REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379')
HISTORY_SECONDS = 180     # how far back we keep history per IP
BUCKET_SECONDS = 15       # size of each time bucket within that history
CHECK_INTERVAL = 5        # how often we recompute
Z_SCORE_THRESHOLD = 2.5   # flag if current bucket is this many std devs above baseline
MIN_REQUESTS_TO_FLAG = 5  # ignore tiny counts - avoids flagging normal noise
MIN_BASELINE_BUCKETS = 2  # need at least this many prior buckets with data to trust a baseline

# ip -> deque of timestamps (seconds) of its requests, up to HISTORY_SECONDS old
request_log = defaultdict(deque)


def prune_old_entries(now):
    cutoff = now - HISTORY_SECONDS
    for ip, timestamps in request_log.items():
        while timestamps and timestamps[0] < cutoff:
            timestamps.popleft()


def bucket_counts(timestamps, now):
    """Split timestamps into fixed-size buckets covering the history
    window, oldest first. The LAST bucket is 'right now'; everything
    before it is baseline."""
    num_buckets = HISTORY_SECONDS // BUCKET_SECONDS
    buckets = [0] * num_buckets
    window_start = now - HISTORY_SECONDS

    for ts in timestamps:
        offset = ts - window_start
        idx = int(offset // BUCKET_SECONDS)
        if 0 <= idx < num_buckets:
            buckets[idx] += 1

    return buckets


def compute_and_flag_anomalies():
    now = time.time()
    prune_old_entries(now)

    for ip, timestamps in request_log.items():
        if not timestamps:
            continue

        buckets = bucket_counts(timestamps, now)
        current = buckets[-1]
        baseline = [b for b in buckets[:-1] if b > 0]

        if len(baseline) < MIN_BASELINE_BUCKETS or current < MIN_REQUESTS_TO_FLAG:
            # Not enough history to know what "normal" looks like for
            # this IP yet, or too few requests to bother flagging.
            continue

        mean = statistics.mean(baseline)
        stdev = statistics.pstdev(baseline) or 1  # avoid divide-by-zero

        z_score = (current - mean) / stdev
        if z_score >= Z_SCORE_THRESHOLD:
            print(
                f"[ANOMALY] IP {ip} flagged: {current} requests in the last "
                f"{BUCKET_SECONDS}s vs its own baseline avg={mean:.1f} "
                f"(z-score={z_score:.2f})",
                flush=True,
            )


def main():
    client = redis.from_url(REDIS_URL, decode_responses=True)
    print("Anomaly detector started, reading from 'traffic_logs' stream...", flush=True)

    last_id = '$'
    last_check = time.time()

    while True:
        try:
            response = client.xread({'traffic_logs': last_id}, block=1000, count=100)

            if response:
                _, entries = response[0]
                for entry_id, fields in entries:
                    last_id = entry_id
                    ip = fields.get('ip', 'unknown')
                    request_log[ip].append(time.time())

            if time.time() - last_check >= CHECK_INTERVAL:
                compute_and_flag_anomalies()
                last_check = time.time()

        except redis.exceptions.ConnectionError as err:
            print(f"Redis connection error, retrying: {err}", flush=True)
            time.sleep(2)


if __name__ == '__main__':
    main()