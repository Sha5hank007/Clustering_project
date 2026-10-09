import { useEffect, useState } from 'react';

interface AuthenticatedImageProps {
  src: string | undefined;
  alt: string;
  style?: React.CSSProperties;
  className?: string;
}

type Status = 'loading' | 'loaded' | 'error' | 'empty';

const STYLE_ID = 'authenticated-image-styles';

const css = `
.aimg {
  position: relative;
  display: block;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.04);
  isolation: isolate;
}
.aimg.is-loading::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, rgba(255,255,255,0) 20%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 80%);
  background-size: 200% 100%;
  animation: aimg-shimmer 1.4s ease-in-out infinite;
  z-index: 1;
}
@keyframes aimg-shimmer {
  from { background-position: 150% 0; }
  to { background-position: -50% 0; }
}
.aimg .aimg-img {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
  filter: blur(8px);
  transform: scale(1.03);
  transition:
    opacity 0.5s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.6s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}
.aimg.is-loaded .aimg-img {
  opacity: 1;
  filter: none;
  transform: none;
}
.aimg-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #c7c7cc;
  animation: aimg-fade 0.3s ease both;
}
.aimg-fallback svg { width: 34%; max-width: 40px; height: auto; }
@keyframes aimg-fade { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .aimg.is-loading::before { animation: none; }
  .aimg .aimg-img { filter: none; transform: none; transition: opacity 0.2s linear; }
}
`;

if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
}

const PersonGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8.5" r="3.75" />
    <path d="M4.5 20c.9-3.6 3.9-5.75 7.5-5.75s6.6 2.15 7.5 5.75" />
  </svg>
);

const BrokenGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M3 15l4.5-4.5L11 14l3-3 7 7" />
    <path d="M4 4l16 16" />
  </svg>
);

export default function AuthenticatedImage({ src, alt, style, className = '' }: AuthenticatedImageProps) {
  const [imageSrc, setImageSrc] = useState<string>();
  const [status, setStatus] = useState<Status>(src ? 'loading' : 'empty');

  useEffect(() => {
    let objectUrl: string | undefined;
    const controller = new AbortController();

    if (!src) {
      setImageSrc(undefined);
      setStatus('empty');
      return () => controller.abort();
    }

    setStatus('loading');
    setImageSrc(undefined);

    fetch(src, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
      .then(response => {
        if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        objectUrl = URL.createObjectURL(blob);
        setImageSrc(objectUrl);
        // status flips to 'loaded' in onLoad, once the browser has decoded it
      })
      .catch(error => {
        if (error.name !== 'AbortError') {
          setImageSrc(undefined);
          setStatus('error');
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  // Sizing / shape goes on the frame; fit / position goes on the image itself.
  const { objectFit, objectPosition, ...frameStyle } = style || {};

  return (
    <span
      className={`aimg is-${status} ${className}`.trim()}
      style={frameStyle}
      role={status === 'error' || status === 'empty' ? 'img' : undefined}
      aria-label={status === 'error' || status === 'empty' ? alt || 'No image' : undefined}
      aria-busy={status === 'loading'}
    >
      {imageSrc && (
        <img
          className="aimg-img"
          src={imageSrc}
          alt={alt}
          decoding="async"
          draggable={false}
          style={{ objectFit: objectFit ?? 'cover', objectPosition }}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      )}
      {(status === 'error' || status === 'empty') && (
        <span className="aimg-fallback" aria-hidden="true">
          {status === 'error' ? <BrokenGlyph /> : <PersonGlyph />}
        </span>
      )}
    </span>
  );
}