import React, { useState } from 'react';
import {
  ShieldAlert,
  Search,
  Sparkles,
  AlertCircle,
  RefreshCw,
  Clock,
  Camera,
  Grid,
  List,
} from 'lucide-react';
import { ImageUpload } from '../components/ImageUpload';
import { PersonCard } from '../components/PersonCard';
import { SightingTimeline } from '../components/SightingTimeline';
import { CropGrid } from '../components/CropGrid';
import { identifyFace, updatePersonLabel } from '../api/client';
import { IdentificationResponse } from '../types';

export const IdentifyPage: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<IdentificationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'timeline' | 'grid'>('timeline');

  const handleImageSelected = (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setResult(null);
  };

  const handleIdentify = async () => {
    if (!file) return;
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await identifyFace(file);
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred during facial identification.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  const handleUpdateLabel = async (personId: number, newLabel: string) => {
    await updatePersonLabel(personId, newLabel);
    if (result && result.person_id === personId) {
      setResult({
        ...result,
        label: newLabel || `Person #${personId}`,
      });
    }
  };

  return (
    <div className="page-container identify-page animate-fade-in">
      <div className="page-header">
        <div className="page-title-group">
          <h2 className="page-title">Forensic Face Identification</h2>
          <p className="page-subtitle">
            Upload a suspect photo to extract 512-d ArcFace embeddings and query sighting history
          </p>
        </div>
      </div>

      <div className="identify-layout">
        {/* Left / Top panel: Upload & Query Controls */}
        <section className="query-panel glass-panel">
          <div className="section-header-compact">
            <Search size={16} />
            <span>Target Image</span>
          </div>

          <ImageUpload onImageSelected={handleImageSelected} isLoading={isLoading} />

          {file && !result && (
            <div className="query-action-row animate-fade-in">
              <button
                className="btn-primary glow-btn"
                onClick={handleIdentify}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <RefreshCw size={16} className="spinning" />
                    <span>Analyzing Embeddings...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    <span>Run Forensic Search</span>
                  </>
                )}
              </button>
            </div>
          )}

          {isLoading && (
            <div className="identifying-indicator glass-panel animate-fade-in">
              <div className="radar-spinner"></div>
              <div className="identifying-text">
                <strong>Detecting facial keypoints (SCRFD)...</strong>
                <span>Matching against database person centroids</span>
              </div>
            </div>
          )}

          {error && (
            <div className="error-card glass-panel animate-fade-in">
              <AlertCircle size={24} className="error-icon" />
              <div className="error-details">
                <h4>Match Query Failed</h4>
                <p>{error}</p>
              </div>
              <button className="btn-secondary-sm" onClick={handleReset}>
                Try Another Photo
              </button>
            </div>
          )}
        </section>

        {/* Right / Results Panel */}
        {result && (
          <section className="results-panel animate-fade-in">
            <div className="results-header glass-panel">
              <div className="match-banner">
                <ShieldAlert size={24} className="match-shield-icon" />
                <div className="match-banner-text">
                  <h3>Identity Match Confirmed</h3>
                  <p>
                    Cosine similarity score is{' '}
                    <strong>{(result.similarity * 100).toFixed(1)}%</strong>
                  </p>
                </div>
              </div>

              <div className="results-actions">
                <div className="view-toggle">
                  <button
                    className={`toggle-btn ${viewMode === 'timeline' ? 'active' : ''}`}
                    onClick={() => setViewMode('timeline')}
                    title="Timeline View"
                  >
                    <List size={16} />
                    <span>Timeline</span>
                  </button>
                  <button
                    className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                    onClick={() => setViewMode('grid')}
                    title="Crops Gallery"
                  >
                    <Grid size={16} />
                    <span>Crops</span>
                  </button>
                </div>

                <button className="btn-secondary" onClick={handleReset}>
                  <RefreshCw size={14} />
                  <span>New Search</span>
                </button>
              </div>
            </div>

            {/* Profile summary card */}
            <div className="matched-person-wrapper">
              <PersonCard
                person={{
                  id: result.person_id,
                  label: result.label,
                  sighting_count: result.total_sightings,
                  first_seen: result.first_seen,
                  last_seen: result.last_seen,
                  thumbnail_url: result.sightings[0]?.crop_url,
                }}
                similarity={result.similarity}
                onUpdateLabel={handleUpdateLabel}
              />
            </div>

            {/* Sighting History Section */}
            <div className="sighting-history-box glass-panel">
              <div className="history-header">
                <div className="history-title">
                  <Clock size={18} />
                  <h3>Recorded Sighting History</h3>
                  <span className="count-pill">{result.sightings.length} events</span>
                </div>
              </div>

              {viewMode === 'timeline' ? (
                <SightingTimeline sightings={result.sightings} />
              ) : (
                <CropGrid sightings={result.sightings} />
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
