import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function capitalize(value?: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

const BrandMark = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8V6a3 3 0 0 1 3-3h2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2" />
    <circle cx="12" cy="10" r="2.6" />
    <path d="M7.5 17c.8-2.1 2.5-3.2 4.5-3.2s3.7 1.1 4.5 3.2" />
  </svg>
);

export default function Navbar() {
  const { user, logout, isAdmin, isManager } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);        // mobile menu
  const [accountOpen, setAccountOpen] = useState(false);  // account popover
  const [scrolled, setScrolled] = useState(false);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, visible: false });
  const [indicatorReady, setIndicatorReady] = useState(false);

  const linksRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  const canManage = isAdmin || isManager;
  const links = [
    { to: '/', label: 'Dashboard' },
    { to: '/ingest', label: 'Upload' },
    { to: '/streams', label: 'Streams' },
    ...(canManage ? [{ to: '/cameras', label: 'Cameras' }] : []),
    { to: '/persons', label: 'People' },
    { to: '/identify', label: 'Identify' },
    ...(canManage ? [{ to: '/admin', label: 'Admin' }] : []),
  ];

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname === to || location.pathname.startsWith(`${to}/`);

  const handleLogout = () => {
    setAccountOpen(false);
    setMenuOpen(false);
    logout();
    navigate('/login');
  };

  // Slide the highlight pill under the active link
  useLayoutEffect(() => {
    const update = () => {
      const el = linksRef.current?.querySelector<HTMLElement>('.nv-link.is-active');
      if (!el) {
        setIndicator(i => ({ ...i, visible: false }));
        return;
      }
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth, visible: true });
    };
    update();
    const raf = requestAnimationFrame(() => setIndicatorReady(true));
    window.addEventListener('resize', update);
    (document as any).fonts?.ready?.then(update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
    };
  }, [location.pathname, links.length]);

  // Hairline + stronger blur once the page scrolls
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close menus when navigating
  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  // Close account popover on outside click / Escape
  useEffect(() => {
    if (!accountOpen && !menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (accountOpen && accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAccountOpen(false); setMenuOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountOpen, menuOpen]);

  // Lock page scroll while the mobile menu is open
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [menuOpen]);

  const initial = (user?.email || '?').charAt(0).toUpperCase();

  return (
    <>
      <style>{styles}</style>
      <header className={`nv${scrolled ? ' is-scrolled' : ''}${menuOpen ? ' is-menu-open' : ''}`}>
        <nav className="nv-inner" aria-label="Main navigation">
          <Link to="/" className="nv-brand" aria-label="FaceTrack home">
            <BrandMark />
            <span>FaceTrack</span>
          </Link>

          <div className="nv-links" ref={linksRef}>
            <span
              className={`nv-indicator${indicatorReady ? ' is-ready' : ''}`}
              style={{
                transform: `translateX(${indicator.left}px)`,
                width: indicator.width,
                opacity: indicator.visible ? 1 : 0,
              }}
              aria-hidden="true"
            />
            {links.map(link => (
              <Link
                key={link.to}
                to={link.to}
                className={`nv-link${isActive(link.to) ? ' is-active' : ''}`}
                aria-current={isActive(link.to) ? 'page' : undefined}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="nv-account" ref={accountRef}>
            <button
              type="button"
              className="nv-avatar-btn"
              onClick={() => setAccountOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              aria-label="Account"
            >
              <span className="nv-avatar">{initial}</span>
            </button>

            {accountOpen && (
              <div className="nv-popover" role="menu">
                <div className="nv-popover-head">
                  <span className="nv-avatar nv-avatar--lg">{initial}</span>
                  <div className="nv-popover-text">
                    <span className="nv-popover-email" title={user?.email}>{user?.email}</span>
                    <span className="nv-popover-role">{capitalize(user?.role)}</span>
                  </div>
                </div>
                <div className="nv-popover-divider" />
                <button type="button" role="menuitem" className="nv-popover-item" onClick={handleLogout}>
                  Sign out
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className={`nv-burger${menuOpen ? ' is-open' : ''}`}
            onClick={() => setMenuOpen(o => !o)}
            aria-expanded={menuOpen}
            aria-controls="nv-mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            <span /><span />
          </button>
        </nav>

        <div id="nv-mobile-menu" className="nv-mobile" hidden={!menuOpen}>
          <ul className="nv-mobile-links">
            {links.map((link, index) => (
              <li key={link.to} style={{ animationDelay: `${60 + index * 35}ms` }}>
                <Link to={link.to} className={`nv-mobile-link${isActive(link.to) ? ' is-active' : ''}`}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="nv-mobile-account" style={{ animationDelay: `${60 + links.length * 35}ms` }}>
            <span className="nv-avatar nv-avatar--lg">{initial}</span>
            <div className="nv-popover-text">
              <span className="nv-popover-email">{user?.email}</span>
              <span className="nv-popover-role">{capitalize(user?.role)}</span>
            </div>
            <button type="button" className="nv-mobile-signout" onClick={handleLogout}>Sign out</button>
          </div>
        </div>
      </header>
    </>
  );
}

const styles = `
.nv {
  --nv-text: #1d1d1f;
  --nv-muted: #6e6e73;
  --nv-faint: #86868b;
  --nv-line: rgba(0, 0, 0, 0.08);
  --nv-accent: #0071e3;
  --nv-red: #e30000;
  --nv-ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  --nv-height: 52px;
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(251, 251, 253, 0.72);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid transparent;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  transition: background 0.3s var(--nv-ease), border-color 0.3s var(--nv-ease);
}
.nv.is-scrolled { background: rgba(251, 251, 253, 0.8); border-bottom-color: var(--nv-line); }
.nv.is-menu-open { background: rgba(251, 251, 253, 0.98); }

.nv-inner {
  display: flex;
  align-items: center;
  gap: 24px;
  max-width: 1120px;
  height: var(--nv-height);
  margin: 0 auto;
  padding: 0 24px;
}

/* Brand */
.nv-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--nv-text);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.02em;
  text-decoration: none;
  flex-shrink: 0;
  transition: opacity 0.2s var(--nv-ease);
}
.nv-brand:hover { opacity: 0.7; }

/* Desktop links */
.nv-links {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 0 auto;
}
.nv-indicator {
  position: absolute;
  top: 50%;
  left: 0;
  height: 30px;
  margin-top: -15px;
  border-radius: 980px;
  background: rgba(0, 0, 0, 0.06);
  pointer-events: none;
}
.nv-indicator.is-ready {
  transition: transform 0.45s cubic-bezier(0.3, 1, 0.4, 1), width 0.45s cubic-bezier(0.3, 1, 0.4, 1), opacity 0.2s var(--nv-ease);
}
.nv-link {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 13px;
  border-radius: 980px;
  color: var(--nv-muted);
  font-size: 14px;
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.2s var(--nv-ease);
}
.nv-link:hover { color: var(--nv-text); }
.nv-link.is-active { color: var(--nv-text); font-weight: 500; }
.nv-link:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.35); }

/* Account */
.nv-account { position: relative; flex-shrink: 0; }
.nv-avatar-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  cursor: pointer;
}
.nv-avatar-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.35); }
.nv-avatar {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(180deg, #a1a1a6 0%, #8e8e93 100%);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
  transition: transform 0.2s var(--nv-ease);
}
.nv-avatar-btn:hover .nv-avatar { transform: scale(1.06); }
.nv-avatar--lg { width: 40px; height: 40px; font-size: 17px; }

.nv-popover {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 264px;
  padding: 6px;
  border-radius: 16px;
  /* Solid on purpose: backdrop blur can't work inside the already-blurred nav bar */
  background: #fff;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.06),
    0 4px 12px rgba(0, 0, 0, 0.06),
    0 24px 56px -16px rgba(0, 0, 0, 0.28);
  transform-origin: top right;
  animation: nv-pop 0.22s cubic-bezier(0.3, 1.1, 0.5, 1);
}
@keyframes nv-pop { from { opacity: 0; transform: scale(0.94) translateY(-4px); } }
.nv-popover-head { display: flex; align-items: center; gap: 12px; padding: 12px 10px; }
.nv-popover-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.nv-popover-email {
  font-size: 15px;
  font-weight: 500;
  color: var(--nv-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nv-popover-role { font-size: 13px; color: var(--nv-faint); }
.nv-popover-divider { height: 1px; margin: 4px 10px; background: var(--nv-line); }
.nv-popover-item {
  display: block;
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 10px;
  background: none;
  color: var(--nv-text);
  font: inherit;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s var(--nv-ease);
}
.nv-popover-item:hover, .nv-popover-item:focus-visible { outline: none; background: rgba(0, 0, 0, 0.05); }

/* Burger (mobile) */
.nv-burger {
  display: none;
  position: relative;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  flex-shrink: 0;
}
.nv-burger span {
  position: absolute;
  left: 9px;
  width: 18px;
  height: 1.5px;
  border-radius: 2px;
  background: var(--nv-text);
  transition: transform 0.35s cubic-bezier(0.3, 1, 0.4, 1), top 0.35s cubic-bezier(0.3, 1, 0.4, 1);
}
.nv-burger span:first-child { top: 14px; }
.nv-burger span:last-child { top: 21px; }
.nv-burger.is-open span:first-child { top: 17.5px; transform: rotate(45deg); }
.nv-burger.is-open span:last-child { top: 17.5px; transform: rotate(-45deg); }

/* Mobile menu */
.nv-mobile {
  position: fixed;
  top: var(--nv-height);
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px 32px 40px;
  overflow-y: auto;
  background: rgba(251, 251, 253, 0.98);
  animation: nv-menu 0.35s var(--nv-ease);
}
.nv-mobile[hidden] { display: none; }
@keyframes nv-menu { from { opacity: 0; } }
.nv-mobile-links { list-style: none; margin: 0; padding: 0; }
.nv-mobile-links li, .nv-mobile-account { animation: nv-item 0.45s var(--nv-ease) both; }
@keyframes nv-item { from { opacity: 0; transform: translateY(-8px); } }
.nv-mobile-link {
  display: block;
  padding: 10px 0;
  color: var(--nv-text);
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  text-decoration: none;
  transition: opacity 0.2s var(--nv-ease);
}
.nv-mobile-link:not(.is-active) { opacity: 0.55; }
.nv-mobile-link:hover { opacity: 1; }
.nv-mobile-account {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--nv-line);
}
.nv-mobile-account .nv-popover-text { flex: 1; }
.nv-mobile-signout {
  padding: 8px 4px;
  border: none;
  background: none;
  color: var(--nv-accent);
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}

/* Breakpoint */
@media (max-width: 860px) {
  .nv-inner { padding: 0 12px 0 16px; justify-content: space-between; }
  .nv-links, .nv-account { display: none; }
  .nv-burger { display: block; }
}
@media (min-width: 861px) {
  .nv-mobile { display: none !important; }
}

@media (prefers-reduced-motion: reduce) {
  .nv *, .nv *::after { animation: none !important; transition: none !important; }
}
`;