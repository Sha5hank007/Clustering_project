import React, { useRef, useState } from 'react';
import { UploadCloud, Image as ImageIcon, X, AlertCircle } from 'lucide-react';

interface ImageUploadProps {
  onImageSelected: (file: File) => void;
  isLoading: boolean;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  onImageSelected,
  isLoading,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const validateAndSet = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (JPG, PNG, WEBP, etc.)');
      return;
    }
    setError(null);
    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    onImageSelected(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSet(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      validateAndSet(e.target.files[0]);
    }
  };

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFile(null);
    setPreview(null);
    setError(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div className="upload-wrapper">
      <div
        className={`upload-zone glass-panel ${dragActive ? 'drag-active' : ''} ${
          preview ? 'has-preview' : ''
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => !isLoading && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="file-input-hidden"
          onChange={handleChange}
          disabled={isLoading}
        />

        {preview ? (
          <div className="preview-container">
            <img src={preview} alt="Suspect Query Preview" className="preview-image" />
            <button
              type="button"
              className="clear-preview-btn"
              onClick={clearSelection}
              title="Remove image"
              disabled={isLoading}
            >
              <X size={18} />
            </button>
            <div className="preview-overlay">
              <span>Click or drop new image to replace</span>
            </div>
          </div>
        ) : (
          <div className="upload-prompt">
            <div className="upload-icon-circle">
              <UploadCloud size={36} className="upload-icon" />
            </div>
            <h3 className="upload-headline">Drag & Drop Suspect Photo</h3>
            <p className="upload-subtext">
              Supports JPG, PNG, WEBP — SCRFD detects face & ArcFace matches known centroids
            </p>
            <div className="upload-action-pill">
              <ImageIcon size={14} />
              <span>Browse File System</span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="upload-error-banner animate-fade-in">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
