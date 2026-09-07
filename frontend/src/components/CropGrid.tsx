import React, { useState } from 'react';
import { Camera, Clock, ZoomIn, X, Image as ImageIcon } from 'lucide-react';
import { Sighting } from '../types';

interface CropGridProps {
  sightings: Sighting[];
}

export const CropGrid: React.FC<CropGridProps> = ({ sightings }) => {
  const [activeCrop, setActiveCrop] = useState<string | null>(null);

  const sightingsWithCrops = sightings.filter((s) => Boolean(s.crop_url));

  if (sightingsWithCrops.length === 0) {
    return (
      <div className="empty-crop-grid glass-panel">
        <ImageIcon size={32} className="empty-icon" />
        <p>No face crop images archived for this person.</p>
      </div>
    );
  }

  return (
    <div className="crop-grid-wrapper">
      <div className="crop-grid">
        {sightingsWithCrops.map((sighting, idx) => (
          <div
            key={sighting.id || idx}
            className="crop-grid-card glass-panel"
            onClick={() => setActiveCrop(sighting.crop_url!)}
          >
            <div className="crop-grid-image-container">
              <img
                src={sighting.crop_url!}
                alt={`Crop at ${sighting.camera_id}`}
                className="crop-grid-img"
              />
              <div className="crop-grid-hover-overlay">
                <ZoomIn size={18} />
              </div>
            </div>
            <div className="crop-grid-meta">
              <span className="crop-grid-camera">
                <Camera size={11} />
                {sighting.camera_id}
              </span>
              <span className="crop-grid-date">
                <Clock size={11} />
                {new Date(sighting.seen_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>

      {activeCrop && (
        <div className="lightbox-overlay" onClick={() => setActiveCrop(null)}>
          <div className="lightbox-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="lightbox-close-btn" onClick={() => setActiveCrop(null)}>
              <X size={20} />
            </button>
            <img src={activeCrop} alt="Full Resolution Crop" className="lightbox-img" />
          </div>
        </div>
      )}
    </div>
  );
};
