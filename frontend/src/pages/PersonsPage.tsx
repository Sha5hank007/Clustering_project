import React, { useState, useEffect } from 'react';
import {
  Users,
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  X,
  Clock,
  Camera,
  Layers,
  ChevronLeft,
} from 'lucide-react';
import { PersonCard } from '../components/PersonCard';
import { SightingTimeline } from '../components/SightingTimeline';
import { CropGrid } from '../components/CropGrid';
import { getPersons, getPerson, updatePersonLabel, deletePerson } from '../api/client';
import { Person, PersonDetail } from '../types';

export const PersonsPage: React.FC = () => {
  const [persons, setPersons] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [labeledOnly, setLabeledOnly] = useState(false);
  
  // Selected Person detail modal
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [selectedPersonDetail, setSelectedPersonDetail] = useState<PersonDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'timeline' | 'crops'>('timeline');

  const fetchPersonsList = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getPersons({
        search: searchQuery.trim() || undefined,
        labeled_only: labeledOnly,
      });
      setPersons(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load persons directory.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPersonsList();
  }, [labeledOnly]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchPersonsList();
  };

  const handleOpenDetail = async (id: number) => {
    setSelectedPersonId(id);
    setIsDetailLoading(true);
    try {
      const detail = await getPerson(id);
      setSelectedPersonDetail(detail);
    } catch (err: any) {
      alert(`Could not load person details: ${err.message}`);
      setSelectedPersonId(null);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleCloseDetail = () => {
    setSelectedPersonId(null);
    setSelectedPersonDetail(null);
  };

  const handleUpdateLabel = async (id: number, newLabel: string) => {
    await updatePersonLabel(id, newLabel);
    setPersons((prev) =>
      prev.map((p) => (p.id === id ? { ...p, label: newLabel || null } : p))
    );
    if (selectedPersonDetail && selectedPersonDetail.id === id) {
      setSelectedPersonDetail({
        ...selectedPersonDetail,
        label: newLabel || null,
      });
    }
  };

  const handleDeletePerson = async (id: number) => {
    await deletePerson(id);
    setPersons((prev) => prev.filter((p) => p.id !== id));
    if (selectedPersonId === id) {
      handleCloseDetail();
    }
  };

  return (
    <div className="page-container persons-page animate-fade-in">
      <div className="page-header">
        <div className="page-title-group">
          <h2 className="page-title">Known Persons Database</h2>
          <p className="page-subtitle">
            All facial identity centroids stored in pgvector with multi-camera sighting history
          </p>
        </div>

        <button className="btn-secondary" onClick={fetchPersonsList} disabled={isLoading}>
          <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-bar glass-panel">
        <form onSubmit={handleSearchSubmit} className="search-form">
          <div className="search-input-box">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search by person name / label..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => {
                  setSearchQuery('');
                  fetchPersonsList();
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button type="submit" className="btn-primary-sm">
            Search
          </button>
        </form>

        <div className="filter-options">
          <button
            type="button"
            className={`filter-pill ${labeledOnly ? 'active' : ''}`}
            onClick={() => setLabeledOnly(!labeledOnly)}
          >
            <Filter size={13} />
            <span>Labeled Only</span>
          </button>
          <span className="total-badge">{persons.length} Persons</span>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="error-card glass-panel animate-fade-in">
          <AlertCircle size={24} className="error-icon" />
          <div className="error-details">
            <h4>Error Loading Database</h4>
            <p>{error}</p>
          </div>
          <button className="btn-secondary-sm" onClick={fetchPersonsList}>
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="loading-grid glass-panel">
          <div className="spinner"></div>
          <p>Querying PostgreSQL & pgvector centroids...</p>
        </div>
      )}

      {/* Grid of Persons */}
      {!isLoading && !error && persons.length > 0 && (
        <div className="persons-grid">
          {persons.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              onSelect={handleOpenDetail}
              onUpdateLabel={handleUpdateLabel}
              onDelete={handleDeletePerson}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && persons.length === 0 && (
        <div className="empty-state glass-panel animate-fade-in">
          <Users size={48} className="empty-icon" />
          <h3>No Persons Found</h3>
          <p>
            {searchQuery || labeledOnly
              ? 'No identity records match your search criteria.'
              : 'No persons recorded in the database yet. Upload a video in the Ingestion tab or identify a suspect.'}
          </p>
        </div>
      )}

      {/* Detail Modal */}
      {selectedPersonId && (
        <div className="modal-backdrop" onClick={handleCloseDetail}>
          <div className="modal-container glass-panel animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <button className="modal-back-btn" onClick={handleCloseDetail}>
                  <ChevronLeft size={20} />
                </button>
                <div>
                  <h3 className="modal-title">
                    {selectedPersonDetail?.label || `Person #${selectedPersonId}`}
                  </h3>
                  <span className="modal-sub">ID: #{selectedPersonId} • ArcFace 512-d Centroid</span>
                </div>
              </div>
              <button className="modal-close-btn" onClick={handleCloseDetail}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              {isDetailLoading ? (
                <div className="modal-loading">
                  <div className="spinner"></div>
                  <p>Loading sighting history...</p>
                </div>
              ) : selectedPersonDetail ? (
                <div className="detail-content">
                  <div className="detail-summary-bar">
                    <div className="detail-stat">
                      <span className="stat-label">Total Sightings</span>
                      <span className="stat-value">{selectedPersonDetail.sighting_count}</span>
                    </div>
                    <div className="detail-stat">
                      <span className="stat-label">First Seen</span>
                      <span className="stat-value">
                        {new Date(selectedPersonDetail.first_seen).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="detail-stat">
                      <span className="stat-label">Last Seen</span>
                      <span className="stat-value">
                        {new Date(selectedPersonDetail.last_seen).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="detail-tabs">
                    <button
                      className={`detail-tab-btn ${detailTab === 'timeline' ? 'active' : ''}`}
                      onClick={() => setDetailTab('timeline')}
                    >
                      <Clock size={14} />
                      <span>Timeline Events ({selectedPersonDetail.sightings.length})</span>
                    </button>
                    <button
                      className={`detail-tab-btn ${detailTab === 'crops' ? 'active' : ''}`}
                      onClick={() => setDetailTab('crops')}
                    >
                      <Layers size={14} />
                      <span>Archived Crops</span>
                    </button>
                  </div>

                  <div className="detail-tab-view">
                    {detailTab === 'timeline' ? (
                      <SightingTimeline sightings={selectedPersonDetail.sightings} />
                    ) : (
                      <CropGrid sightings={selectedPersonDetail.sightings} />
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
