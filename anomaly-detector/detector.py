"""
Anomaly detector - Week 5 (v3: Isolation Forest)

Upgrades the earlier statistical (z-score) detector to a real
unsupervised ML model: Isolation Forest.

The core idea of Isolation Forest: it builds random decision trees
that repeatedly split the data on random features/thresholds. A point
that's genuinely different from the rest gets isolated into its own
tiny branch in very few splits, because it doesn't "blend in" with
everything else. A normal point takes many more splits to isolate,
since it looks like a lot of its neighbors. The model scores every
point by how quickly it got isolated - fast isolation = anomaly.

This is unsupervised: we never tell the model what an "attack" looks
like. It just learns the shape of normal traffic and flags whatever
doesn't fit that shape.

Instead of one number (request count) per window like the old
detector, we compute several FEATURES per (IP, time window):
  - request_count:     how many requests this IP made in the window
  - error_rate:         fraction of requests that were non-2xx
  - unique_path_ratio:  how many distinct paths relative to request count
                         (a bot hammering ONE endpoint looks different
                         from a real user browsing several pages)
  - burstiness:         how uneven the spacing between requests is
                         (a human clicking around is irregular; a
                         script firing at a fixed rate is very regular
                         -  low burstiness can itself be suspicious)
"""

import os
import time
import statistics
from collections import defaultdict, deque

import numpy as np
import redis
from sklearn.ensemble import IsolationForest

REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379')
WINDOW_SECONDS = 15       # size of each time window used for feature extraction
RETRAIN_INTERVAL = 15     # how often we recompute windows and retrain
MAX_TRAINING_WINDOWS = 200  # cap on how much history we train the model on
MIN_SAMPLES_TO_TRAIN = 10   # need at least this many windows before ML kicks in
CONTAMINATION = 0.1         # our rough prior: ~10% of windows might be anomalous

# ip -> deque of (timestamp, path, status) for the CURRENT open window
current_window = defaultdict(list)
# rolling buffer of past (ip, window_start, feature_vector) samples used for training
training_buffer = deque(maxlen=MAX_TRAINING_WINDOWS)

current_window_start = None


def extract_features(records):
    """Turn a list of (timestamp, path, status) tuples from one
    (ip, window) into a fixed-size numeric feature vector."""
    count = len(records)
    if count == 0:
        return None

    timestamps = sorted(r[0] for r in records)
    paths = [r[1] for r in records]
    statuses = [r[2] for r in records]

    error_count = sum(1 for s in statuses if not s.startswith('2'))
    error_rate = error_count / count

    unique_path_ratio = len(set(paths)) / count

    if count > 1:
        gaps = [timestamps[i + 1] - timestamps[i] for i in range(count - 1)]
        # low stdev in gaps = very regular/robotic timing = "burstiness" signal
        burstiness = statistics.pstdev(gaps) if len(gaps) > 1 else 0.0
    else:
        burstiness = 0.0

    return [count, error_rate, unique_path_ratio, burstiness]


def roll_window_and_train(now):
    """Close out the current time window, extract its features per IP,
    add them to the training buffer, retrain the model on the buffer,
    and score the just-closed window's IPs against it."""
    global current_window, current_window_start

    closed_ips = list(current_window.keys())
    if not closed_ips:
        current_window_start = now
        return

    new_samples = []  # (ip, feature_vector) for THIS window only
    for ip in closed_ips:
        features = extract_features(current_window[ip])
        if features is not None:
            training_buffer.append(features)
            new_samples.append((ip, features))

    current_window = defaultdict(list)
    current_window_start = now

    if len(training_buffer) < MIN_SAMPLES_TO_TRAIN:
        print(
            f"[ML] Collecting baseline data... {len(training_buffer)}/"
            f"{MIN_SAMPLES_TO_TRAIN} windows so far",
            flush=True,
        )
        return

    # Train fresh on the whole rolling buffer. This is intentionally
    # simple (retrain from scratch each cycle) rather than incremental -
    # Isolation Forest trains fast enough on this small a dataset that
    # it doesn't matter for a project at this scale.
    X_train = np.array(list(training_buffer))
    model = IsolationForest(contamination=CONTAMINATION, random_state=42)
    model.fit(X_train)

    # Score only the windows that just closed, not the whole buffer -
    # we only care about flagging NEW behavior, not re-flagging history.
    for ip, features in new_samples:
        X_sample = np.array([features])
        prediction = model.predict(X_sample)[0]      # -1 = anomaly, 1 = normal
        score = model.decision_function(X_sample)[0]  # lower = more anomalous

        if prediction == -1:
            count, error_rate, unique_path_ratio, burstiness = features
            print(
                f"[ML-ANOMALY] IP {ip} flagged by Isolation Forest "
                f"(score={score:.3f}): {int(count)} reqs, "
                f"error_rate={error_rate:.2f}, "
                f"unique_path_ratio={unique_path_ratio:.2f}, "
                f"burstiness={burstiness:.3f}",
                flush=True,
            )


def main():
    global current_window_start

    client = redis.from_url(REDIS_URL, decode_responses=True)
    print(
        "Anomaly detector (Isolation Forest) started, reading from "
        "'traffic_logs' stream...",
        flush=True,
    )

    last_id = '$'
    current_window_start = time.time()

    while True:
        try:
            response = client.xread({'traffic_logs': last_id}, block=1000, count=100)

            if response:
                _, entries = response[0]
                for entry_id, fields in entries:
                    last_id = entry_id
                    ip = fields.get('ip', 'unknown')
                    path = fields.get('path', '/')
                    status = fields.get('status', '000')
                    ts = float(fields.get('timestamp', time.time() * 1000)) / 1000
                    current_window[ip].append((ts, path, status))

            now = time.time()
            if now - current_window_start >= WINDOW_SECONDS:
                roll_window_and_train(now)

        except redis.exceptions.ConnectionError as err:
            print(f"Redis connection error, retrying: {err}", flush=True)
            time.sleep(2)


if __name__ == '__main__':
    main()
