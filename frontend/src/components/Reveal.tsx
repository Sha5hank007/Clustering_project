import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Delay before the animation starts, in ms */
  delay?: number;
  /** How far the content travels up while fading in, in px */
  distance?: number;
}

const STYLE_ID = 'reveal-styles';

const css = `
.rv {
  opacity: 0;
  transform: translate3d(0, var(--rv-distance, 24px), 0);
  transition:
    opacity 0.9s cubic-bezier(0.22, 1, 0.36, 1) var(--rv-delay, 0ms),
    transform 0.9s cubic-bezier(0.22, 1, 0.36, 1) var(--rv-delay, 0ms);
}
.rv.is-visible {
  opacity: 1;
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .rv { opacity: 1; transform: none; transition: none; }
}
@media print {
  .rv { opacity: 1 !important; transform: none !important; }
}
`;

// Inject the styles once, before the first paint, so content never flashes in unstyled.
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
}

export default function Reveal({ children, className = '', delay = 0, distance = 24 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const show = () => element.classList.add('is-visible');

    // Older browsers or test environments: just show the content.
    if (typeof IntersectionObserver === 'undefined') {
      show();
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      // Reveal when it enters the viewport, or if it's already been scrolled past.
      if (entry.isIntersecting || entry.boundingClientRect.bottom < 0) {
        show();
        observer.disconnect();
      }
    }, {
      // threshold 0 + a bottom margin works for elements of any height
      // (a percentage threshold never fires for content taller than the screen).
      threshold: 0,
      rootMargin: '0px 0px -8% 0px',
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`rv ${className}`.trim()}
      style={{ '--rv-delay': `${delay}ms`, '--rv-distance': `${distance}px` } as CSSProperties}
    >
      {children}
    </div>
  );
}