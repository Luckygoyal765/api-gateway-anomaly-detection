# High-Level Design: Production API Gateway with ML Anomaly Detection & Resilience

## 1. System Overview

This system is an enterprise-grade, distributed API Gateway architecture that sits in front of downstream microservices (`service-a`, `service-b`). It handles ingress load balancing, JWT authentication, atomic Redis rate limiting, and request proxying with circuit breakers, while streaming real-time telemetry to an asynchronous Machine Learning anomaly detection pipeline. The entire stack is instrumented for end-to-end distributed tracing, Prometheus metrics collection, Grafana operational dashboards, and persistent PostgreSQL audit logging.

---

## Architecture & Service Boundaries


```

```
                         [ Client / Load Test (k6) ]
                                      │
                                      ▼
                           ┌─────────────────────┐
                           │ NGINX Ingress Proxy │ (Port 8080)
                           │  - Ingress Routing  │
                           │  - Maps X-Request-ID│
                           └──────────┬──────────┘
                                      │
                                      ▼
                   ┌─────────────────────────────────────┐
                   │         Express API Gateway         │  (Port 8080 internal)
                   │  - JWT Verification (/auth)          │
                   │  - Token Bucket / Sliding Window    │
                   │  - Distributed Tracing Context      │
                   │  - Opossum Circuit Breakers         │
                   └──────────┬──────────────┬───────────┘
                              │              │
      ┌───────────────────────┘              └──────────────────────┐
      ▼                                                             ▼

```

┌────────────────────────────────┐                            ┌───────────────────┐
│        Redis Store             │                            │ Downstream Services│
│  - Atomic Token Bucket Keys    │                            │  - Service A: 4001│
│  - 'traffic_logs' Stream       │                            │  - Service B: 4002│
│  - 'ml_anomalies' List         │                            └───────────────────┘
└─────────┬──────────────┬───────┘
│              │
▼              ▼
┌──────────────────┐   ┌───────────────────────────┐          ┌───────────────────┐
│ Python ML Engine │   │ Async PostgreSQL Worker   │─────────►│ PostgreSQL DB     │
│ - Isolation Forest   │ - Flushes Audit Trails    │          │ - Persistent Logs │
│ - 15s Windows    │   │ - Binds X-Request-ID      │          └───────────────────┘
└──────────────────┘   └───────────────────────────┘
│
▼
┌─────────────────────────────────┐                           ┌───────────────────┐
│  Prometheus Metrics Engine      │──────────────┬───────────►│ Grafana Dashboard │
│  - Scrapes /metrics every 5s    │              │            │ - RPS / Latency   │
└─────────────────────────────────┘              │            │ - Circuit States  │
│            └───────────────────┘
▼
┌───────────────────────────┐
│   Express Stats API       │
│   - Real-time Telemetry   │
└───────────────────────────┘

```

---

## 2. Components & Technology Stack

| Component | Responsibility | Tech Stack |
| :--- | :--- | :--- |
| **Ingress Proxy** | TLS termination, client IP mapping, initial `X-Request-ID` trace generation | NGINX |
| **API Gateway** | Auth, rate limiting, request tracing, circuit breaker proxying | Node.js + Express |
| **Circuit Breakers** | Short-circuit failing services, fast fallback, automatic recovery | Opossum |
| **In-Memory Store** | Sliding-window/token bucket state, Redis Streams telemetry pipeline | Redis 7 |
| **Backend Services** | Downstream core business logic (`service-a`, `service-b`) | Node.js + Express |
| **Audit Logging** | Persistent audit records, latency, status codes, trace mapping | PostgreSQL + Node Async Worker |
| **Anomaly Detector** | Ingests Redis streams, fits Isolation Forest model on traffic features | Python, Scikit-Learn, NumPy |
| **Observability** | Scrapes `/metrics`, exposes system metrics, visualizes latency/errors | Prometheus & Grafana |
| **Load Testing** | Validates rate limits, fault injection, and SLA latency thresholds | Grafana k6 |

---

## 3. Request Lifecycle & Distributed Tracing

1. **Ingress Entry:** Client sends an HTTP request to NGINX on port 8080. NGINX checks for an existing `X-Request-ID` header; if missing, it generates a unique `$request_id` and forwards it.
2. **Gateway Processing:** Express Gateway captures the `X-Request-ID` via correlation middleware, attaching it to both `req.requestId` and the client response header.
3. **Telemetry Streaming:** The traffic logger asynchronously emits request metadata (`timestamp`, `client_ip`, `route`, `request_id`) to a Redis Stream without blocking the primary execution thread.
4. **Rate Limit Verification:** The rate limiter evaluates client requests against atomic Redis Lua scripts (Token Bucket / Sliding Window Log).
5. **Circuit Breaker Proxy Execution:** Downstream proxy requests to `service-a` or `service-b` are executed inside **Opossum Circuit Breakers**:
   * **Closed State:** Traffic proxies normally with `X-Request-ID` forwarded downstream.
   * **Open State:** If downstream errors or latencies exceed 50%, the circuit trips `OPEN` for 10s, short-circuiting calls with an immediate `503 Service Unavailable` fallback response.
6. **Async Audit Trail Persistence:** Background worker processes harvest telemetry streams and write trace-bound audit events into PostgreSQL.

---

## 4. Resilience, Scaling & Failure Recovery Strategy

### Resilience & Fault-Tolerance Matrix

| Failure Mode | Detection | Mitigation Strategy | System Behavior |
| :--- | :--- | :--- | :--- |
| **Redis Down / Unreachable** | Gateway `redis.on('error')` | Fallback to memory / **Fail-Open** | Traffic proceeds; availability prioritized over strict rate limits |
| **Downstream Outage (Service A/B)** | Opossum error threshold (>50%) | Circuit Breaker Trips `OPEN` | Returns instant `503` fallback; prevents thread pool starvation |
| **PostgreSQL Outage** | Async Worker DB connection loss | Buffer logs in Redis Stream | Non-blocking API path; logs flush upon DB reconnect |
| **ML Engine Outage** | Health probe failure | Gateway bypasses scoring pipeline | Core routing, rate limiting, and proxying continue unhindered |

### Horizontal Scaling Strategy
* **Stateless Gateway Tier:** Gateway nodes maintain no local session state. Multiple gateway containers scale horizontally behind NGINX load balancing.
* **Atomic Redis State Sharding:** Distributed nodes execute atomic Lua scripts to prevent Check-Then-Set race conditions. Rate-limit keys are sharded across Redis Cluster nodes using client IP hash tags (`{ip:192.168.1.1}:rate_limit`).
* **Trace Propagation:** Every node propagates `X-Request-ID` across HTTP boundaries, ensuring distributed log correlation across scaled gateway instances.

---

## 5. Empirical Performance & Validation Results

### k6 Load Testing Verification
Automated k6 load tests were executed under heavy virtual user (VU) concurrency to validate performance thresholds:

* **Sustained Traffic:** Evaluated over 20,000+ requests with up to 60 concurrent Virtual Users (VUs).
* **Threshold Validation:**
  * **Latency Target:** `p(95) < 350ms` (Passed)
  * **Failure SLA:** `http_req_failed{status:500} < 0.01` (Passed)
* **Circuit Breaker Trip & Recovery:** Verified fast fallback behavior during simulated service downtime (`503` returned instantly) followed by automatic `half-open` recovery to `200 OK` once downstream containers restarted.

---

## 6. Interview Talking Points & Architecture Highlights

1. **Why Fail-Open for Rate Limiting?**
   > *"For an API Gateway, availability takes precedence over strict rate enforcement. If Redis experiences a total outage, our middleware catches the exception, logs a Prometheus counter metric, and allows requests through so legitimate users aren't locked out."*

2. **How do you handle cascading failures when downstream services fail?**
   > *"We wrap proxy calls in Opossum circuit breakers. If a downstream service slows down or drops requests above a 50% threshold, the circuit trips OPEN. Subsequent calls short-circuit immediately with a fast 503 fallback, saving thread resources and gateway memory."*

3. **How do you achieve end-to-end trace correlation in a microservice environment?**
   > *"NGINX assigns or forwards an `X-Request-ID` at ingress. Our Express gateway context middleware captures this ID, passes it to Redis streams, forwards it downstream via http-proxy-middleware headers, and embeds it into PostgreSQL audit tables."*

