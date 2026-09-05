import React, { useState } from 'react';
import { User, Clock, Eye, Edit3, Check, X, Trash2, ShieldCheck, ChevronRight } from 'lucide-react';
import { Person } from '../types';

interface PersonCardProps {
  person: Person;
  similarity?: number;
  onSelect?: (id: number) => void;
  onUpdateLabel?: (id: number, newLabel: string) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
  isCompact?: boolean;
}

export const PersonCard: React.FC<PersonCardProps> = ({
  person,
  similarity,
  onSelect,
  onUpdateLabel,
  onDelete,
  isCompact = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [labelInput, setLabelInput] = useState(person.label || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSaveLabel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onUpdateLabel) return;
    setIsSaving(true);
    try {
      await onUpdateLabel(person.id, labelInput.trim());
      setIsEditing(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLabelInput(person.label || '');
    setIsEditing(false);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete) return;
    if (window.confirm(`Are you sure you want to delete Person #${person.id}? All associated sighting records will be deleted.`)) {
      setIsDeleting(true);
      try {
        await onDelete(person.id);
      } catch (err) {
        console.error(err);
        setIsDeleting(false);
      }
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const d = new Date(dateString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div
      className={`person-card glass-panel ${onSelect ? 'clickable-card' : ''} ${
        isCompact ? 'compact' : ''
      }`}
      onClick={() => onSelect && onSelect(person.id)}
    >
      <div className="card-top">
        <div className="avatar-wrapper">
          {person.thumbnail_url ? (
            <img
              src={person.thumbnail_url}
              alt={person.label || `Person ${person.id}`}
              className="person-avatar-img"
              onError={(e) => {
                // fallback to icon on error
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="avatar-placeholder">
              <User size={28} className="placeholder-icon" />
            </div>
          )}
          {similarity !== undefined && (
            <div className="match-pill">
              <ShieldCheck size={12} />
              <span>{(similarity * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>

        <div className="person-header-info">
          {isEditing ? (
            <div className="inline-edit-box" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="Assign Name / Label"
                className="edit-label-input"
                autoFocus
              />
              <button
                className="icon-btn-confirm"
                onClick={handleSaveLabel}
                disabled={isSaving}
                title="Save label"
              >
                <Check size={14} />
              </button>
              <button
                className="icon-btn-cancel"
                onClick={handleCancelEdit}
                title="Cancel"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="label-display-row">
              <h3 className="person-name">
                {person.label ? (
                  person.label
                ) : (
                  <span className="unlabeled-text">Person #{person.id}</span>
                )}
              </h3>
              {onUpdateLabel && (
                <button
                  className="edit-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                  }}
                  title="Edit label / name"
                >
                  <Edit3 size={14} />
                </button>
              )}
            </div>
          )}
          <span className="person-id-tag">ID: #{person.id}</span>
        </div>
      </div>

      <div className="card-metrics">
        <div className="metric-pill">
          <Eye size={13} />
          <span>{person.sighting_count} {person.sighting_count === 1 ? 'sighting' : 'sightings'}</span>
        </div>
        <div className="metric-pill">
          <Clock size={13} />
          <span>Last seen: {formatDate(person.last_seen)}</span>
        </div>
      </div>

      <div className="card-footer">
        <span className="first-seen-sub">First seen: {formatDate(person.first_seen)}</span>
        <div className="card-actions">
          {onDelete && (
            <button
              className="action-btn-danger"
              onClick={handleDelete}
              disabled={isDeleting}
              title="Delete Person"
            >
              <Trash2 size={15} />
            </button>
          )}
          {onSelect && (
            <button className="action-btn-view" title="View sighting timeline">
              <span>Details</span>
              <ChevronRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
