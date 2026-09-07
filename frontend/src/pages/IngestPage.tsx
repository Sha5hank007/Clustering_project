import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  UploadCloud,
  FileVideo,
  CheckCircle2,
  AlertCircle,
  Clock,
  Camera,
  RefreshCw,
  Play,
  Check,
  X,
} from 'lucide-react';
import { uploadVideoForIngest, getIngestJobs } from '../api/client';
import { IngestJob } from '../types';

export const IngestPage: React.FC = () => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [cameraId, setCameraId] = useState('entrance_cam');
  const [recordedAt, setRecordedAt] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchJobs = async () => {
    setIsLoadingJobs(true);
    try {
      const data = await getIngestJobs();
      setJobs(data);
    } catch (err) {
      console.error('Failed to fetch ingest jobs:', err);
    } finally {
      setIsLoadingJobs(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const timer = setInterval(fetchJobs, 10000);
    return () => clearInterval(timer);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setVideoFile(e.target.files[0]);
      setUploadSuccess(null);
      setUploadError(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setVideoFile(e.dataTransfer.files[0]);
      setUploadSuccess(null);
      setUploadError(null);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const job = await uploadVideoForIngest(
        videoFile,
        cameraId.trim() || 'default_cam',
        recordedAt || undefined
      );
      setUploadSuccess(`Video queued successfully! Job ID: #${job.job_id}`);
      setVideoFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      fetchJobs();
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload video for ingestion.');
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return <span className="status-badge badge-completed"><Check size={12} /> Completed</span>;
      case 'processing':
        return <span className="status-badge badge-processing"><RefreshCw size={12} className="spinning" /> In Progress</span>;
      case 'failed':
        return <span className="status-badge badge-failed"><X size={12} /> Failed</span>;
      default:
        return <span className="status-badge badge-queued"><Clock size={12} /> Queued</span>;
    }
  };

  return (
    <div className="page-container ingest-page animate-fade-in">
      <div className="page-header">
        <div className="page-title-group">
          <h2 className="page-title">Video Ingestion & Processing</h2>
          <p className="page-subtitle">
            Upload surveillance video footage for frame sampling (5fps), SCRFD tracking, and ArcFace centroid matching
          </p>
        </div>

        <button className="btn-secondary" onClick={fetchJobs} disabled={isLoadingJobs}>
          <RefreshCw size={14} className={isLoadingJobs ? 'spinning' : ''} />
          <span>Refresh Queue</span>
        </button>
      </div>

      <div className="ingest-grid">
        {/* Video Upload Form */}
        <section className="upload-section glass-panel">
          <div className="section-header">
            <Video size={18} />
            <h3>Upload Surveillance Video</h3>
          </div>

          <form onSubmit={handleUpload} className="ingest-form">
            <div
              className={`video-dropzone ${videoFile ? 'has-file' : ''}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mp4,.avi,.mov,.mkv,.webm"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />

              {videoFile ? (
                <div className="video-file-info">
                  <FileVideo size={40} className="video-icon" />
                  <span className="video-filename">{videoFile.name}</span>
                  <span className="video-filesize">
                    {(videoFile.size / (1024 * 1024)).toFixed(2)} MB
                  </span>
                  <span className="replace-hint">Click to replace file</span>
                </div>
              ) : (
                <div className="dropzone-prompt">
                  <UploadCloud size={40} className="upload-icon" />
                  <h4>Select Video File</h4>
                  <p>Drag and drop MP4, AVI, MKV, MOV, or WEBM footage</p>
                </div>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">
                  <Camera size={14} />
                  <span>Camera ID / Location</span>
                </label>
                <input
                  type="text"
                  value={cameraId}
                  onChange={(e) => setCameraId(e.target.value)}
                  placeholder="e.g. entrance_cam, lobby_01"
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <Clock size={14} />
                  <span>Recorded Date & Time (Optional)</span>
                </label>
                <input
                  type="datetime-local"
                  value={recordedAt}
                  onChange={(e) => setRecordedAt(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            {uploadError && (
              <div className="error-card glass-panel animate-fade-in">
                <AlertCircle size={18} className="error-icon" />
                <span>{uploadError}</span>
              </div>
            )}

            {uploadSuccess && (
              <div className="success-card glass-panel animate-fade-in">
                <CheckCircle2 size={18} className="success-icon" />
                <span>{uploadSuccess}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary glow-btn full-width"
              disabled={!videoFile || isUploading}
            >
              {isUploading ? (
                <>
                  <RefreshCw size={16} className="spinning" />
                  <span>Uploading & Queuing Video...</span>
                </>
              ) : (
                <>
                  <Play size={16} />
                  <span>Queue Video for Processing</span>
                </>
              )}
            </button>
          </form>
        </section>

        {/* Jobs Queue Section */}
        <section className="jobs-section glass-panel">
          <div className="section-header">
            <Clock size={18} />
            <h3>Processing Queue</h3>
            <span className="count-pill">{jobs.length} Jobs</span>
          </div>

          {jobs.length === 0 ? (
            <div className="empty-jobs">
              <FileVideo size={36} className="empty-icon" />
              <p>No video jobs in queue. Upload footage on the left to start processing.</p>
            </div>
          ) : (
            <div className="jobs-list">
              {jobs.map((job) => (
                <div key={job.job_id} className="job-card glass-panel animate-fade-in">
                  <div className="job-card-header">
                    <div className="job-title-group">
                      <span className="job-filename">{job.filename}</span>
                      <span className="job-camera">
                        <Camera size={12} /> {job.camera_id}
                      </span>
                    </div>
                    {getStatusBadge(job.status)}
                  </div>

                  <div className="job-card-metrics">
                    <div className="job-metric">
                      <span className="metric-name">Job ID</span>
                      <span className="metric-val">#{job.job_id}</span>
                    </div>
                    <div className="job-metric">
                      <span className="metric-name">Queued At</span>
                      <span className="metric-val">
                        {new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  {job.status === 'processing' && (
                    <div className="job-progress-bar-wrapper">
                      <div
                        className="job-progress-fill"
                        style={{ width: `${Math.round(job.progress * 100)}%` }}
                      ></div>
                    </div>
                  )}

                  {job.error && (
                    <div className="job-error-msg">
                      <AlertCircle size={13} />
                      <span>{job.error}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
