# Distributed API Gateway with AI-Based Anomaly Detection

A real, working API gateway system built from scratch to understand and
demonstrate system design fundamentals: authentication at the edge,
distributed rate limiting, service proxying, and statistical anomaly
detection on live traffic - all running as independent, containerized
services.

## What this project demonstrates

- **API Gateway pattern**: single entry point that authenticates, rate
  limits, and routes requests to backend services
- **Distributed rate limiting**: a self-implemented token bucket
  algorithm backed by Redis, using an atomic Lua script to avoid race
  conditions under concurrent load
- **Fail-open design**: the gateway degrades gracefully instead of
  going down when Redis is unavailable (a deliberate, defensible
  trade-off - see "Design decisions" below)
- **Real-time anomaly detection**: a Python service that reads a live
  Redis Stream of traffic logs and flags statistically unusual request
  patterns using a self-baselining z-score approach
- **Container orchestration**: five independent services (gateway, two
  backend services, Redis, anomaly detector) running together via
  Docker Compose, communicating over Docker's internal network

## Architecture

```
Client apps
    |
    v
Load balancer (conceptual - see HLD notes)
    |
    v
API Gateway  ---traffic logs--->  Redis Stream  --->  Anomaly Detector
    |                                                  (self-baselining
    | (auth + rate limit +                             z-score, flags
    |  proxy routing)                                  outliers)
    v
Backend services (service-a, service-b)
```

## Run it

```bash
docker compose up --build
```

This starts five containers:
- `gateway` on http://localhost:8080
- `service-a` (products) on http://localhost:4001
- `service-b` (orders) on http://localhost:4002
- `redis` on http://localhost:6379
- `anomaly-detector` (no exposed port - reads from Redis Stream)

## Try it

**1. Get a token:**
```bash
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "lucky"}'
```

**2. Call a backend service through the gateway:**
```bash
curl http://localhost:8080/api/service-a/products \
  -H "Authorization: Bearer <paste-token-here>"
```

**3. Confirm auth is enforced (should get a 401):**
```bash
curl http://localhost:8080/api/service-a/products
```

**4. See the rate limiter kick in** (bucket capacity: 10, refill: 1/sec):
```bash
for i in {1..15}; do curl -s -o /dev/null -w "%{http_code}\n" \
  http://localhost:8080/api/service-a/products \
  -H "Authorization: Bearer <token>"; done
```
Expect ~10 `200`s followed by `429`s.

**5. Trigger the anomaly detector** - load test with a burst of
concurrent traffic (needs `autocannon`: `npm install -g autocannon`):
```bash
npx autocannon -d 10 -c 20 -H "Authorization: Bearer <token>" \
  http://localhost:8080/api/service-a/products
```
Watch the logs (`docker compose logs -f anomaly-detector`) for a line like:
```
[ANOMALY] IP ... flagged: 26734 requests in the last 15s vs its own
baseline avg=5819.0 (z-score=3.59)
```

## Design decisions worth discussing

**Fail-open rate limiting**: if Redis becomes unreachable, the gateway
lets requests through rather than blocking all traffic. This trades
safety for availability - a defensible choice for most APIs, though a
security-critical system might choose fail-closed instead.

**Atomic Lua script for the token bucket**: a naive read-then-write
implementation has a race condition under concurrent requests. The
Redis client is also configured to fail fast (`disableOfflineQueue`,
short `connectTimeout`) rather than silently queueing commands while
disconnected - without this, the fail-open path never actually
triggers because requests just hang instead of erroring out.

**Self-baselining anomaly detection**: rather than comparing one IP's
traffic to other IPs (which needs multiple real clients to be useful),
each IP is compared against its own recent history. This is both more
practical for local testing and a legitimate production technique -
many real anomaly detectors baseline per-entity rather than only
cross-sectionally.

## What's next

- Upgrade the statistical (z-score) anomaly detector to a real ML
  model (Isolation Forest) trained on request patterns
- Build a React + TypeScript dashboard to visualize traffic, rate
  limit status, and flagged anomalies in real time
- Load test more rigorously and document throughput/latency numbers
- Deploy to AWS and add a proper HLD write-up covering horizontal
  scaling and sharding strategy for the rate limiter
