# Production API Gateway with ML Anomaly Detection & Resilience

An enterprise-grade, distributed API Gateway architecture built to demonstrate high-throughput edge management: JWT authentication, atomic Redis rate limiting, circuit breaker proxying, distributed tracing, PostgreSQL audit logging, and Isolation Forest ML anomaly detection.

---

## Architecture


```

```
                         [ Client / k6 Load Tester ]
                                      │
                                      ▼
                           ┌─────────────────────┐
                           │ NGINX Ingress Proxy │  (Port 8080)
                           │  - TLS & IP Mapping │
                           │  - X-Request-ID     │
                           └──────────┬──────────┘
                                      │
                                      ▼
                   ┌─────────────────────────────────────┐
                   │         Express API Gateway         │  (Port 8080 internal)
                   │  - JWT Auth (/auth)                 │
                   │  - Atomic Token Bucket / Sliding    │
                   │  - Opossum Circuit Breakers         │
                   └──────────┬──────────────┬───────────┘
                              │              │
      ┌───────────────────────┘              └──────────────────────┐
      ▼                                                             ▼

```

┌────────────────────────────────┐                            ┌───────────────────┐
│        Redis 7 Store           │                            │ Downstream        │
│  - Atomic Lua Rate Limit Keys   │                            │ Microservices     │
│  - 'traffic_logs' Stream       │                            │ - Service A: 4001 │
│  - 'ml_anomalies' List         │                            │ - Service B: 4002 │
└─────────┬──────────────┬───────┘                            └───────────────────┘
│              │
▼              ▼
┌──────────────────┐   ┌───────────────────────────┐          ┌───────────────────┐
│ Python ML Engine │   │ Async PostgreSQL Worker   │─────────►│ PostgreSQL DB     │
│ - Isolation      │   │ - Flushes Audit Trails    │          │ - Persistent Logs │
│   Forest Model   │   │ - Binds X-Request-ID      │          └───────────────────┘
└──────────────────┘   └───────────────────────────┘
│
▼
┌─────────────────────────────────┐                           ┌───────────────────┐
│ Prometheus Metrics Engine       │──────────────┬───────────►│ Grafana Dashboard │
│ - Scrapes /metrics every 5s     │              │            │ - RPS / Latency   │
└─────────────────────────────────┘              │            │ - Circuit States  │
│            └───────────────────┘
▼
┌───────────────────────────┐
│   Express Stats API       │
│   - Real-Time Telemetry   │
└───────────────────────────┘

```

---

## Key System Design Features

* **Ingress & Load Balancing (NGINX):** Edge reverse proxy handling TLS termination, client IP normalization, and distributed trace ID (`X-Request-ID`) injection.
* **Atomic Redis Rate Limiting:** Self-implemented Token Bucket and Sliding Window Log algorithms executed via atomic Redis Lua scripts to eliminate race conditions under high concurrency.
* **Fail-Open Resilience Strategy:** If Redis becomes unreachable, the rate limiter catches exceptions and degrades gracefully to fail-open mode, prioritizing system availability over strict enforcement.
* **Fault Tolerance (Circuit Breakers):** Downstream proxy routes to microservices (`service-a`, `service-b`) are guarded by **Opossum circuit breakers**. If service latency or error rates exceed 50%, the circuit trips `OPEN` to prevent cascading thread pool starvation.
* **Isolation Forest ML Anomaly Detection:** Real-time Python service consuming Redis traffic streams, fitting an Isolation Forest machine learning model on request feature vectors to identify malicious traffic bursts.
* **Async Audit Trail (PostgreSQL Worker):** Non-blocking telemetry pipeline where proxy events are buffered in Redis Streams and flushed to PostgreSQL asynchronously by a background worker node.
* **Full Observability (Prometheus & Grafana):** Custom gateway metrics (`http_requests_total`, `request_duration_seconds`, `circuit_breaker_state`) exposed at `/metrics`, scraped by Prometheus, and visualized on Grafana dashboards.
* **End-to-End Distributed Tracing:** `X-Request-ID` headers propagated seamlessly from NGINX ingress through the Express API gateway to downstream microservices and PostgreSQL audit logs.

---

## Tech Stack

* **Gateway & Backend Services:** Node.js, Express, Opossum, `express-http-proxy`, `prom-client`
* **Storage & Streams:** Redis 7, PostgreSQL
* **Ingress & Proxy:** NGINX
* **Machine Learning Engine:** Python 3.11, Scikit-Learn, NumPy
* **Observability & Testing:** Prometheus, Grafana, k6

---

## Running the Architecture

```bash
docker compose up --build

```

### Stack Endpoints

* **Ingress Gateway:** `http://localhost:8080`
* **Prometheus Metrics:** `http://localhost:9090`
* **Grafana Dashboard:** `http://localhost:3000` (admin/admin)
* **Stats API:** `http://localhost:4000/stats`
* **Service A (Products):** `http://localhost:4001`
* **Service B (Orders):** `http://localhost:4002`

---

## Verification Steps

### 1. Obtain JWT Authentication Token

```bash
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "lucky"}'

```

### 2. Verify Proxied Request & Trace ID Pass-Through

```bash
curl -i http://localhost:8080/api/service-a/products \
  -H "Authorization: Bearer <TOKEN>" \
  -H "X-Request-ID: trace-id-test-12345"

```

*Response Header contains `X-Request-ID: trace-id-test-12345` alongside JSON payload.*

### 3. Rate Limiter Trigger Test

```bash
for i in {1..15}; do curl -s -o /dev/null -w "%{http_code}\n" \
  http://localhost:8080/api/service-a/products \
  -H "Authorization: Bearer <TOKEN>"; done

```

*Expects 10 `200 OK` responses followed by `429 Too Many Requests` status codes.*

### 4. Execute k6 Load Test Suite

```bash
k6 run tests/load_test.js

```

*Evaluates rate limits, latency thresholds (`p95 < 350ms`), and fault handling under Virtual User (VU) concurrency.*

---

## Documentation

For full architectural deep dives, failover mechanics, sharding strategies, and interview talking points, refer to:

* **[High-Level Design Document (`HLD.md`)](https://www.google.com/search?q=./HLD.md&utm_source=gemini)