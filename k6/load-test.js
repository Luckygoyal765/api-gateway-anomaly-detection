import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '15s', target: 10 },
    { duration: '30s', target: 30 },
    { duration: '15s', target: 60 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    // Flag real failures (like 500/502 errors), ignoring expected 401/429 codes
    'http_req_failed{status:500}': ['rate<0.01'],
    // P95 latency threshold
    'http_req_duration': ['p(95)<350'],
  },
};

const BASE_URL = 'http://localhost:8080';
const JWT_TOKEN = __ENV.JWT_TOKEN || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6Imx1Y2t5IiwiaWF0IjoxNzg5Nzk0NzgwLCJleHAiOjE3ODk3OTgzODB9.gavYdnoNUGmMVvo2ShthOQrx1gp_z1ALnjQY1dsosjc";

export default function () {
  const authParams = {
    headers: {
      'Authorization': `Bearer ${JWT_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };

  // Scenario 1: Authorized Endpoint
  const resAuth = http.get(`${BASE_URL}/api/service-a/products`, authParams);
  check(resAuth, {
    'authorized status is 200 or 429': (r) => r.status === 200 || r.status === 429,
  });

  // Scenario 2: Unauthenticated Endpoint (No Auth Header sent)
  const resUnauth = http.get(`${BASE_URL}/api/service-b/status`);
  check(resUnauth, {
    'unauthorized status is 401': (r) => r.status === 401,
  });

  sleep(0.1);
}