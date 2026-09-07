import React from 'react';
import { Search, Users, Video, BarChart2, Shield, Activity } from 'lucide-react';
import { HealthStatus } from '../types';

export type NavTab = 'identify' | 'persons' | 'ingest' | 'stats';

interface NavbarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  health: HealthStatus | null;
  isOnline: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  health,
  isOnline,
}) => {
  return (
    <header className="navbar-container glass-panel">
      <div className="navbar-brand">
        <div className="brand-logo">
          <Shield className="brand-icon" size={24} />
          <div className="logo-pulse"></div>
        </div>
        <div className="brand-text">
          <span className="brand-title">FACE TRACK</span>
          <span className="brand-tag">FORENSIC INTELLIGENCE</span>
        </div>
      </div>

      <nav className="navbar-links">
        <button
          className={`nav-btn ${currentTab === 'identify' ? 'nav-active' : ''}`}
          onClick={() => onSelectTab('identify')}
        >
          <Search size={18} />
          <span>Identify</span>
        </button>

        <button
          className={`nav-btn ${currentTab === 'persons' ? 'nav-active' : ''}`}
          onClick={() => onSelectTab('persons')}
        >
          <Users size={18} />
          <span>Persons</span>
        </button>

        <button
          className={`nav-btn ${currentTab === 'ingest' ? 'nav-active' : ''}`}
          onClick={() => onSelectTab('ingest')}
        >
          <Video size={18} />
          <span>Ingestion</span>
        </button>

        <button
          className={`nav-btn ${currentTab === 'stats' ? 'nav-active' : ''}`}
          onClick={() => onSelectTab('stats')}
        >
          <BarChart2 size={18} />
          <span>Analytics</span>
        </button>
      </nav>

      <div className="navbar-status">
        <div className="status-indicator">
          <span className={`status-dot ${isOnline ? 'dot-online' : 'dot-offline'}`} />
          <span className="status-label">
            {isOnline ? 'System Online' : 'Connecting...'}
          </span>
        </div>
        {health && (
          <div className="model-badge" title={`Detector: ${health.models.detector} | Recognizer: ${health.models.recognizer}`}>
            <Activity size={12} />
            <span>SCRFD + ArcFace</span>
          </div>
        )}
      </div>
    </header>
  );
};
