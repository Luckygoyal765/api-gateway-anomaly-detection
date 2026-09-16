import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import './App.css';

function App() {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('http://localhost:8080/stats');
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const data = await res.json();
        
        setStats(data);
        setError(null);

        // Retain last 10 points for time-series chart
        const timeLabel = new Date(data.timestamp).toLocaleTimeString();
        setHistory((prev) => [
          ...prev.slice(-9),
          { time: timeLabel, rps: data.requestsPerSecond, blocked: data.blockedRequests }
        ]);

      } catch (err) {
        setError(err.message);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  // Triggers alert on ML anomalies, high error rates, or heavy rate-limiting
  const isAnomalyDetected = stats && (
    (stats.anomaliesCount && stats.anomaliesCount > 0) ||
    stats.blockedRequests > 15 ||
    stats.errorRate > 0.5
  );

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: '1000px', margin: '0 auto' }}>
      <h1>API Gateway Metrics Dashboard</h1>
      
      {/* ERROR BANNER */}
      {error && (
        <div style={{ color: '#ff4d4f', padding: '1rem', border: '1px solid #ff4d4f', borderRadius: '8px', marginBottom: '1rem' }}>
          <strong>Error connecting to gateway stats:</strong> {error}
        </div>
      )}

      {/* ANOMALY ALERT BANNER */}
      {isAnomalyDetected && (
        <div style={alertBannerStyle}>
          ⚠️ <strong>ANOMALY DETECTED:</strong> {stats?.anomaliesCount || 0} threat event(s) flagged by Isolation Forest detector in the last 60 seconds!
        </div>
      )}

      {stats ? (
        <>
          {/* METRIC CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
            <div style={cardStyle}>
              <span style={labelStyle}>Total Requests (60s Window)</span>
              <span style={numberStyle}>{stats.totalRequests}</span>
            </div>
            <div style={cardStyle}>
              <span style={labelStyle}>Requests / Second</span>
              <span style={numberStyle}>{stats.requestsPerSecond}</span>
            </div>
            <div style={cardStyle}>
              <span style={labelStyle}>Blocked Requests (429)</span>
              <span style={{ ...numberStyle, color: stats.blockedRequests > 0 ? '#ff4d4f' : '#4caf50' }}>
                {stats.blockedRequests}
              </span>
            </div>
            <div style={cardStyle}>
              <span style={labelStyle}>Error Rate</span>
              <span style={{ ...numberStyle, color: stats.errorRate > 0.2 ? '#ff4d4f' : '#4caf50' }}>
                {(stats.errorRate * 100).toFixed(1)}%
              </span>
            </div>
            <div style={cardStyle}>
              <span style={labelStyle}>Unique IPs</span>
              <span style={numberStyle}>{stats.uniqueIPs}</span>
            </div>
            <div style={cardStyle}>
              <span style={labelStyle}>Unique Endpoints</span>
              <span style={numberStyle}>{stats.uniquePaths}</span>
            </div>
          </div>

          {/* REAL-TIME TIME-SERIES CHART */}
          <div style={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '1.5rem', marginTop: '1.5rem' }}>
            <h3 style={{ color: '#fff', marginTop: 0, marginBottom: '1rem' }}>Live Traffic Trends</h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="time" stroke="#aaa" />
                <YAxis stroke="#aaa" />
                <Tooltip contentStyle={{ backgroundColor: '#222', border: '1px solid #555', color: '#fff' }} />
                <Line type="monotone" dataKey="rps" name="Req/Sec" stroke="#4caf50" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="blocked" name="Blocked (429)" stroke="#ff4d4f" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* LIVE ML ANOMALY DETECTIONS TABLE */}
          {stats.anomalies && stats.anomalies.length > 0 && (
            <div style={{ backgroundColor: '#1a1a1a', border: '1px solid #ff4d4f', borderRadius: '8px', padding: '1.5rem', marginTop: '1.5rem' }}>
              <h3 style={{ color: '#ff4d4f', marginTop: 0, marginBottom: '1rem' }}>🚨 Live ML Anomaly Detections</h3>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', color: '#fff' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #444', color: '#aaa' }}>
                    <th style={{ padding: '0.5rem' }}>IP Address</th>
                    <th style={{ padding: '0.5rem' }}>ML Score</th>
                    <th style={{ padding: '0.5rem' }}>Requests</th>
                    <th style={{ padding: '0.5rem' }}>Error Rate</th>
                    <th style={{ padding: '0.5rem' }}>Burstiness</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.anomalies.map((alert, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #333' }}>
                      <td style={{ padding: '0.5rem', fontFamily: 'monospace' }}>{alert.ip}</td>
                      <td style={{ padding: '0.5rem', color: '#ff4d4f', fontWeight: 'bold' }}>
                        {alert.score !== null ? alert.score : 'Fallback Rule'}
                      </td>
                      <td style={{ padding: '0.5rem' }}>{alert.requests}</td>
                      <td style={{ padding: '0.5rem' }}>{(alert.error_rate * 100).toFixed(1)}%</td>
                      <td style={{ padding: '0.5rem' }}>{alert.burstiness}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <p>Loading live telemetry metrics...</p>
      )}
    </div>
  );
}

const cardStyle = {
  border: '1px solid #333',
  borderRadius: '8px',
  padding: '1.5rem',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#1a1a1a',
  color: '#ffffff'
};

const labelStyle = {
  fontSize: '0.9rem',
  color: '#aaa',
  marginBottom: '0.5rem'
};

const numberStyle = {
  fontSize: '2.5rem',
  fontWeight: 'bold',
  color: '#4caf50'
};

const alertBannerStyle = {
  backgroundColor: '#5c0011',
  color: '#ffccc7',
  border: '1px solid #a8071a',
  padding: '1rem 1.2rem',
  borderRadius: '8px',
  marginBottom: '1rem',
  fontSize: '1rem'
};

export default App;