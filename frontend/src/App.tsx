import React, { useState, useEffect } from 'react';
import { Navbar, NavTab } from './components/Navbar';
import { IdentifyPage } from './pages/IdentifyPage';
import { PersonsPage } from './pages/PersonsPage';
import { IngestPage } from './pages/IngestPage';
import { StatsPage } from './pages/StatsPage';
import { checkHealth } from './api/client';
import { HealthStatus } from './types';

export function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('identify');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [isOnline, setIsOnline] = useState(false);

  const fetchHealthStatus = async () => {
    try {
      const status = await checkHealth();
      setHealth(status);
      setIsOnline(true);
    } catch {
      setIsOnline(false);
    }
  };

  useEffect(() => {
    fetchHealthStatus();
    const interval = setInterval(fetchHealthStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app-root">
      <Navbar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        health={health}
        isOnline={isOnline}
      />

      <main className="app-main-content">
        {currentTab === 'identify' && <IdentifyPage />}
        {currentTab === 'persons' && <PersonsPage />}
        {currentTab === 'ingest' && <IngestPage />}
        {currentTab === 'stats' && <StatsPage />}
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <span>Face Track • SCRFD Face Detection & ArcFace Embedding Pipeline</span>
          <span className="footer-dot">•</span>
          <span>PostgreSQL + pgvector</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
