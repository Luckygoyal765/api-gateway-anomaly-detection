CREATE TABLE IF NOT EXISTS security_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    http_method VARCHAR(10) DEFAULT 'GET',
    endpoint VARCHAR(255) NOT NULL,
    status_code INT NOT NULL,
    flagged_anomaly BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_ip_time ON security_audit_logs(ip_address, created_at DESC);