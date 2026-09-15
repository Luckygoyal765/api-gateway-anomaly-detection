"""
Anomaly detector - Week 5 (v5: handles zero-variance baseline)

Fixes a real issue found after the v4 train/score separation fix:
Isolation Forest needs VARIANCE in its training data to build any
meaningful splits. If every baseline window looks identical (e.g. from
uniform manual curl testing), the model has nothing to learn from and
will silently pass everything through, including real attacks - not
because the model is broken, but because it was never given anything
to compare against.

Fix: before trusting the ML model, check if the baseline actually has
variance. If it doesn't, fall back to a simple, explicit rule instead
of blindly trusting a model with no discriminative power. This is a
local-testing edge case - real traffic naturally varies - but a
production system should never silently trust a degenerate model.
"""

import os
import time
import json
import statistics
from collections import defaultdict, deque

import numpy as np
import redis
from sklearn.ensemble import IsolationForest

REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379')
WINDOW_SECONDS = 15
BASELINE_MIN = 10
MAX_BASELINE = 200
CONTAMINATION = 0.05
MIN_VARIANCE = 1e-6  # below this, treat a feature as having no real variance

current_window = defaultdict(list)
baseline_buffer = deque(maxlen=MAX_BASELINE)
current_window_start = None
model_activated = False
client_redis = None


def extract_features(records):
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
        burstiness = statistics.pstdev(gaps) if len(gaps) > 1 else 0.0
    else:
        burstiness = 0.0

    return [count, error_rate, unique_path_ratio, burstiness]


def has_sufficient_variance(X_train):
    """Isolation Forest can't discriminate anything if every training
    point is identical. Check if AT LEAST ONE feature has real spread."""
    return bool(np.any(np.std(X_train, axis=0) > MIN_VARIANCE))


def flag_anomaly(tag, ip, now, features, score=None):
    count, error_rate, unique_path_ratio, burstiness = features
    score_str = f"score={score:.3f}" if score is not None else "score=n/a (fallback rule)"
    print(
        f"[{tag}] IP {ip} flagged ({score_str}): {int(count)} reqs, "
        f"error_rate={error_rate:.2f}, unique_path_ratio={unique_path_ratio:.2f}, "
        f"burstiness={burstiness:.3f}",
        flush=True,
    )
    record = json.dumps({
        'ip': ip,
        'timestamp': int(now * 1000),
        'score': round(float(score), 3) if score is not None else None,
        'requests': int(count),
        'error_rate': round(error_rate, 3),
        'unique_path_ratio': round(unique_path_ratio, 3),
        'burstiness': round(burstiness, 4),
    })
    client_redis.lpush('ml_anomalies', record)
    client_redis.ltrim('ml_anomalies', 0, 49)


def roll_window_and_train(now):
    global current_window, current_window_start, model_activated

    closed_ips = list(current_window.keys())
    closed_data = current_window
    current_window = defaultdict(list)
    current_window_start = now

    if not closed_ips:
        return

    new_samples = []
    for ip in closed_ips:
        features = extract_features(closed_data[ip])
        if features is not None:
            new_samples.append((ip, features))

    if len(baseline_buffer) < BASELINE_MIN:
        for ip, features in new_samples:
            baseline_buffer.append(features)
        print(
            f"[ML] Building baseline... {len(baseline_buffer)}/{BASELINE_MIN} windows",
            flush=True,
        )
        return

    if not model_activated:
        print(
            f"[ML] Baseline ready ({len(baseline_buffer)} windows) - "
            f"now scoring new traffic against it.",
            flush=True,
        )
        model_activated = True

    X_train = np.array(list(baseline_buffer))

    if not has_sufficient_variance(X_train):
        # The model has nothing to learn from - fall back to a simple,
        # explicit safety net instead of trusting a degenerate model.
        baseline_counts = [f[0] for f in baseline_buffer]
        baseline_max = max(baseline_counts)
        for ip, features in new_samples:
            count, error_rate = features[0], features[1]
            if count > max(baseline_max * 5, 10) or error_rate > 0.8:
                flag_anomaly('FALLBACK-ANOMALY', ip, now, features)
            else:
                baseline_buffer.append(features)
        return

    model = IsolationForest(contamination=CONTAMINATION, random_state=42)
    model.fit(X_train)

    for ip, features in new_samples:
        X_sample = np.array([features])
        prediction = model.predict(X_sample)[0]
        score = model.decision_function(X_sample)[0]

        if prediction == -1:
            flag_anomaly('ML-ANOMALY', ip, now, features, score)
        else:
            baseline_buffer.append(features)


def main():
    global current_window_start, client_redis

    client_redis = redis.from_url(REDIS_URL, decode_responses=True)
    print(
        "Anomaly detector (Isolation Forest, v5) started, reading from "
        "'traffic_logs' stream...",
        flush=True,
    )

    last_id = '$'
    current_window_start = time.time()

    while True:
        try:
            response = client_redis.xread({'traffic_logs': last_id}, block=1000, count=100)

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