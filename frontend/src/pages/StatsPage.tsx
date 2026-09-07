import React, { useState, useEffect } from 'react';
import {
  BarChart2,
  Users,
  Eye,
  Camera,
  Clock,
  Cpu,
  RefreshCw,
  AlertCircle,
  Sliders,
  ShieldCheck,
} from 'lucide-react';
import { getStats } from '../api/client';
import { SystemStats } from '../types';

export const StatsPage: React.FC = () => {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatsData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getStats();
      setStats(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load system statistics.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatsData();
  }, []);

  return (
    <div className="page-container stats-page animate-fade-in">
      <div className="page-header">
        <div className="page-title-group">
          <h2 className="page-title">Intelligence & System Analytics</h2>
          <p className="page-subtitle">
            Real-time biometric database counts, camera distribution, and AI detection pipeline metrics
          </p>
        </div>

        <button className="btn-secondary" onClick={fetchStatsData} disabled={isLoading}>
          <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
          <span>Refresh Analytics</span>
        </button>
      </div>

      {error && (
        <div className="error-card glass-panel animate-fade-in">
          <AlertCircle size={24} className="error-icon" />
          <div className="error-details">
            <h4>Failed to Load Analytics</h4>
            <p>{error}</p>
          </div>
          <button className="btn-secondary-sm" onClick={fetchStatsData}>
            Retry
          </button>
        </div>
      )}

      {isLoading && (
        <div className="loading-grid glass-panel">
          <div className="spinner"></div>
          <p>Calculating database metrics and camera aggregates...</p>
        </div>
      )}

      {stats && !isLoading && (
        <div className="stats-layout animate-fade-in">
          {/* Key Stat Cards */}
          <div className="metrics-cards-grid">
            <div className="metric-stat-card glass-panel">
              <div className="metric-icon-box blue-accent">
                <Users size={24} />
              </div>
              <div className="metric-info">
                <span className="metric-label">Total Known Persons</span>
                <span className="metric-number">{stats.total_persons}</span>
                <span className="metric-sub">{stats.labeled_persons} labeled with names</span>
              </div>
            </div>

            <div className="metric-stat-card glass-panel">
              <div className="metric-icon-box purple-accent">
                <Eye size={24} />
              </div>
              <div className="metric-info">
                <span className="metric-label">Total Sightings</span>
                <span className="metric-number">{stats.total_sightings}</span>
                <span className="metric-sub">Across all camera streams</span>
              </div>
            </div>

            <div className="metric-stat-card glass-panel">
              <div className="metric-icon-box green-accent">
                <Clock size={24} />
              </div>
              <div className="metric-info">
                <span className="metric-label">Sightings Last 24h</span>
                <span className="metric-number">{stats.sightings_last_24h}</span>
                <span className="metric-sub">Recent activity volume</span>
              </div>
            </div>

            <div className="metric-stat-card glass-panel">
              <div className="metric-icon-box amber-accent">
                <Camera size={24} />
              </div>
              <div className="metric-info">
                <span className="metric-label">Monitored Cameras</span>
                <span className="metric-number">{stats.cameras_count}</span>
                <span className="metric-sub">Active surveillance points</span>
              </div>
            </div>
          </div>

          <div className="stats-split-grid">
            {/* Camera distribution */}
            <div className="camera-dist-card glass-panel">
              <div className="card-section-header">
                <Camera size={18} />
                <h3>Sightings by Camera</h3>
              </div>

              {Object.keys(stats.camera_breakdown).length === 0 ? (
                <div className="empty-sub">
                  <p>No camera sightings recorded yet.</p>
                </div>
              ) : (
                <div className="camera-bars-list">
                  {Object.entries(stats.camera_breakdown).map(([camId, count]) => {
                    const percentage = stats.total_sightings > 0
                      ? (count / stats.total_sightings) * 100
                      : 0;
                    return (
                      <div key={camId} className="camera-bar-item">
                        <div className="camera-bar-label">
                          <span className="camera-name">{camId}</span>
                          <span className="camera-count">{count} sightings ({percentage.toFixed(0)}%)</span>
                        </div>
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{ width: `${Math.max(percentage, 4)}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* AI Model & Pipeline Info */}
            <div className="models-info-card glass-panel">
              <div className="card-section-header">
                <Cpu size={18} />
                <h3>Deep Learning Models & Tuning</h3>
              </div>

              <div className="pipeline-specs-list">
                <div className="spec-row">
                  <span className="spec-title">Face Detector</span>
                  <span className="spec-val">SCRFD ({stats.model_detector})</span>
                </div>
                <div className="spec-row">
                  <span className="spec-title">Face Embedder</span>
                  <span className="spec-val">ArcFace ({stats.model_recognizer})</span>
                </div>
                <div className="spec-row">
                  <span className="spec-title">Vector Dimensionality</span>
                  <span className="spec-val">512-d L2 Normalized</span>
                </div>
                <div className="spec-row">
                  <span className="spec-title">Ingest Match Threshold</span>
                  <span className="spec-val">{(stats.match_threshold * 100).toFixed(0)}% Cosine Similarity</span>
                </div>
                <div className="spec-row">
                  <span className="spec-title">Query Match Threshold</span>
                  <span className="spec-val">{(stats.query_threshold * 100).toFixed(0)}% Cosine Similarity</span>
                </div>
              </div>

              <div className="database-engine-badge">
                <ShieldCheck size={16} />
                <span>PostgreSQL 16 + pgvector HNSW Indexing</span>
              </div>
            </div>
          </div>

          {/* Recent Events Feed */}
          {stats.recent_sightings && stats.recent_sightings.length > 0 && (
            <div className="recent-activity-card glass-panel">
              <div className="card-section-header">
                <Clock size={18} />
                <h3>Recent Sighting Detections</h3>
              </div>

              <div className="recent-feed-grid">
                {stats.recent_sightings.map((item) => (
                  <div key={item.id} className="feed-item glass-panel">
                    {item.crop_url ? (
                      <img
                        src={item.crop_url}
                        alt={item.person_label || `Person ${item.person_id}`}
                        className="feed-crop"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="feed-crop-placeholder">
                        <Users size={16} />
                      </div>
                    )}
                    <div className="feed-meta">
                      <span className="feed-name">{item.person_label || `Person #${item.person_id}`}</span>
                      <div className="feed-details">
                        <span className="feed-cam">
                          <Camera size={11} /> {item.camera_id}
                        </span>
                        <span className="feed-time">
                          <Clock size={11} /> {new Date(item.seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
