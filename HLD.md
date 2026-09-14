# High-Level Design: API Gateway with Anomaly Detection

## 1. System Overview

This system is a distributed API gateway that sits in front of backend
services, handling authentication, rate limiting, and traffic routing,
while streaming request metadata to a real-time anomaly detection
service. It was built incrementally to demonstrate core system design
concepts: edge authentication, distributed state coordination, graceful
degradation, and observability.

## 2. Components

| Component | Responsibility | Technology |
|---|---|---|
| API Gateway | Auth, rate limiting, routing, traffic logging | Node.js + Express |
| Backend Services | Business logic (mocked for this project) | Node.js + Express |
| Redis | Shared state: rate limit counters, traffic log stream | Redis 7 |
| Anomaly Detector | Reads live traffic, flags statistical outliers | Python |

## 3. Request Lifecycle

1. Client sends request to the gateway
2. Traffic logger records the request to a Redis Stream (async, non-blocking)
3. Rate limiter checks/decrements the client's token bucket (atomic Lua script in Redis)
4. Auth middleware verifies the JWT
5. Request is proxied to the appropriate backend service
6. Response is returned to the client
7. (Separately, continuously) Anomaly detector consumes the traffic stream and flags outliers

## 4. Scaling Strategy

**Horizontal scaling of the gateway**: the gateway itself is stateless -
all shared state (rate limit counters) lives in Redis, not in gateway
memory. This means multiple gateway instances can run behind a load
balancer with no coordination needed between them; any instance can
handle any request.

**Redis as the scaling bottleneck**: as gateway instances scale out,
Redis becomes the shared dependency every instance talks to. At scale,
a single Redis instance would need to be:
- **Sharded** by client IP using consistent hashing, so different IP
  ranges' rate-limit counters live on different Redis nodes, spreading
  load
- Or replaced with **Redis Cluster**, which handles this sharding
  automatically

**Anomaly detector scaling**: currently a single consumer reads the
traffic stream. At higher volume, this could be scaled using Redis
Streams' **consumer groups**, letting multiple detector instances each
process a partition of the traffic without duplicating work.

## 5. Failure Modes and Mitigations

| Failure | Impact without mitigation | Mitigation implemented |
|---|---|---|
| Redis becomes unreachable | Every request would fail if rate limiting is fail-closed | **Fail-open**: gateway lets requests through if Redis is down, trading strict rate limiting for availability |
| Redis client silently queues commands while disconnected | Requests hang indefinitely instead of failing fast, making fail-open logic unreachable | Configured `disableOfflineQueue` and a short `connectTimeout` so commands reject immediately when Redis is down |
| A backend service goes down | Gateway would return unclear errors or hang | (Not yet implemented) Circuit breaker pattern - stop forwarding to a known-dead service and fail fast with a clear error |
| One gateway instance crashes | That instance's in-flight requests fail | Stateless design means a load balancer can simply route around it; no session/state is lost since nothing lives in gateway memory |
| Anomaly detector crashes | Traffic monitoring stops silently | (Not yet implemented) Health check + auto-restart via Docker's `restart: unless-stopped` policy |

## 5.5 Empirical Load Test Results

A 60-second sustained load test (15 concurrent connections, ~2,700 req/sec
average) produced results that corrected an initial assumption:

| Container | CPU usage | Notes |
|---|---|---|
| gateway | 118.74% (>1 core) | Unexpectedly the highest - see analysis below |
| redis | 13.78% | Much lower than assumed |
| anomaly-detector | 14.86% | Stable, low overhead |
| service-a / service-b | <0.2% | Barely touched - most requests never reach them |

**Correctness held under sustained load**: 69 `2xx` responses out of
~163k total requests, matching the expected math (capacity 10 + refill
1/sec x 60s ~ 70) almost exactly - the token bucket algorithm is
correct not just for short bursts but for a full minute of continuous
pressure.

**Bottleneck finding**: Redis was assumed to be the likely bottleneck
(every request touches it for the rate-limit check), but the gateway's
own Node.js process consumed far more CPU. The likely cause: the
traffic-logging middleware (`morgan`) writes a log line for *every*
request, including all rejected `429`s - at ~2,700 req/sec, that's a
significant amount of stdout I/O, likely more expensive than the
Redis round-trip itself. **This means the current logging strategy is
a bigger scaling concern than the rate limiter or Redis.**

**Implication for production**: before worrying about sharding Redis,
this system would need either (a) sampled/reduced logging under high
load, (b) an async, batched logging approach instead of per-request
stdout writes, or (c) horizontally scaling gateway instances - since
the gateway process itself, not its dependencies, is the first thing
to saturate.

## 6. Known Limitations (honest, for interview discussion)

- The anomaly detector uses a statistical (z-score) approach, not a
  trained ML model - it catches obvious volume spikes but not subtler
  behavioral anomalies (e.g., a low-and-slow credential-stuffing attack)
- Self-baselining per IP means a consistently high-traffic IP simply
  raises its own "normal" bar over time - it won't catch sustained abuse
  that ramps up gradually rather than spiking
- No persistent storage for rate limit configuration or audit logs -
  everything resets if Redis restarts (acceptable for rate limits,
  not for a production audit trail)
- Load tested locally on a single machine, not in a distributed,
  multi-node deployment - real network latency between services isn't
  represented

## 7. What Would Change for Production

- Deploy gateway instances behind a real load balancer (AWS ALB, nginx)
- Redis Cluster or a managed Redis (AWS ElastiCache) with sharding
- Replace the statistical anomaly detector with a trained model
  (Isolation Forest or similar), retrained periodically on real traffic
- Add structured logging and metrics export (Prometheus/Grafana) instead
  of reading raw container logs
- Add circuit breakers for backend service calls
- Persistent, durable storage for audit-relevant events
