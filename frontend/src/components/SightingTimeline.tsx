import React, { useState } from 'react';
import { Camera, Clock, Award, Image as ImageIcon, ZoomIn, X } from 'lucide-react';
import { Sighting } from '../types';

interface SightingTimelineProps {
  sightings: Sighting[];
}

export const SightingTimeline: React.FC<SightingTimelineProps> = ({ sightings }) => {
  const [selectedCrop, setSelectedCrop] = useState<string | null>(null);

  const formatDate = (dateString: string) => {
    try {
      const d = new Date(dateString);
      return {
        date: d.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        time: d.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      };
    } catch {
      return { date: dateString, time: '' };
    }
  };

  if (!sightings || sightings.length === 0) {
    return (
      <div className="empty-timeline glass-panel">
        <Clock size={32} className="empty-icon" />
        <p>No sighting history recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="timeline-container">
      <div className="timeline-track">
        {sightings.map((sighting, idx) => {
          const { date, time } = formatDate(sighting.seen_at);
          return (
            <div key={sighting.id || idx} className="timeline-item animate-fade-in" style={{ animationDelay: `${idx * 0.05}s` }}>
              <div className="timeline-node">
                <div className="node-dot" />
                <div className="node-line" />
              </div>

              <div className="timeline-content glass-panel">
                <div className="timeline-header">
                  <div className="camera-badge">
                    <Camera size={14} />
                    <span>{sighting.camera_id}</span>
                  </div>
                  <div className="timestamp-group">
                    <Clock size={13} />
                    <span className="time-date">{date}</span>
                    <span className="time-exact">{time}</span>
                  </div>
                </div>

                <div className="timeline-body">
                  {sighting.crop_url ? (
                    <div
                      className="crop-preview-wrapper"
                      onClick={() => setSelectedCrop(sighting.crop_url!)}
                      title="Click to zoom face crop"
                    >
                      <img
                        src={sighting.crop_url}
                        alt={`Face at ${sighting.camera_id}`}
                        className="sighting-crop-img"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      <div className="zoom-hint">
                        <ZoomIn size={14} />
                      </div>
                    </div>
                  ) : (
                    <div className="crop-placeholder-box">
                      <ImageIcon size={20} />
                      <span>No crop saved</span>
                    </div>
                  )}

                  <div className="sighting-metadata">
                    {sighting.quality_score !== undefined && sighting.quality_score !== null && (
                      <div className="quality-pill" title="Detection Sharpness & Pose Quality Score">
                        <Award size={13} />
                        <span>Quality: {(sighting.quality_score).toFixed(2)}</span>
                      </div>
                    )}
                    {sighting.bbox && sighting.bbox.length === 4 && (
                      <div className="bbox-pill">
                        <span>Box: [{sighting.bbox.map(v => Math.round(v)).join(', ')}]</span>
                      </div>
                    )}
                    <div className="sighting-id-sub">
                      <span>Event #{sighting.id}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Zoom Modal */}
      {selectedCrop && (
        <div className="lightbox-overlay" onClick={() => setSelectedCrop(null)}>
          <div className="lightbox-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button
              className="lightbox-close-btn"
              onClick={() => setSelectedCrop(null)}
            >
              <X size={20} />
            </button>
            <img src={selectedCrop} alt="Enlarged Face Crop" className="lightbox-img" />
            <span className="lightbox-caption">High-Resolution Face Crop</span>
          </div>
        </div>
      )}
    </div>
  );
};
