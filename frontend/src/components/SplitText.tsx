import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

type SplitType = 'chars' | 'words' | 'lines' | 'words, chars';

interface SplitTextProps {
  text: string;
  className?: string;
  delay?: number;
  duration?: number;
  ease?: string;
  splitType?: SplitType;
  from?: CSSProperties;
  to?: CSSProperties;
  threshold?: number;
  rootMargin?: string;
  tag?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span';
  textAlign?: CSSProperties['textAlign'];
  onLetterAnimationComplete?: () => void;
  showCallback?: boolean;
}

const DEFAULT_FROM: CSSProperties = { opacity: 0, transform: 'translate3d(0,40px,0)' };
const DEFAULT_TO: CSSProperties = { opacity: 1, transform: 'translate3d(0,0,0)' };
const DEFAULT_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

const normalizeEase = (ease?: string) => {
  if (!ease) return DEFAULT_EASE;
  if (ease.includes('cubic-bezier') || ease.includes('ease')) return ease;
  if (ease === 'power3.out') return DEFAULT_EASE;
  return DEFAULT_EASE;
};

const splitTextIntoParts = (text: string, splitType: SplitType) => {
  if (splitType === 'words') {
    const words = text.split(' ');
    return words.flatMap((word, index) => (index < words.length - 1 ? [word, ' '] : [word]));
  }

  if (splitType === 'lines') {
    return text.split('\n');
  }

  if (splitType === 'words, chars') {
    const words = text.split(' ');
    return words.flatMap((word, index) => (index < words.length - 1 ? [word, ' '] : [word]));
  }

  return Array.from(text);
};

export const SplitText = ({
  text,
  className = '',
  delay = 50,
  duration = 1.25,
  ease = 'power3.out',
  splitType = 'chars',
  from = DEFAULT_FROM,
  to = DEFAULT_TO,
  threshold = 0.1,
  rootMargin = '-100px',
  tag = 'span',
  textAlign = 'left',
  onLetterAnimationComplete,
  showCallback = false
}: SplitTextProps) => {
  const ref = useRef<any>(null);
  const [isVisible, setIsVisible] = useState(false);
  const parts = useMemo(() => splitTextIntoParts(text, splitType), [text, splitType]);

  useEffect(() => {
    if (!ref.current) return;
    const node = ref.current;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  useEffect(() => {
    if (!isVisible || !showCallback || !onLetterAnimationComplete) return;
    const totalDelay = Math.max(0, parts.length - 1) * delay;
    const totalDuration = totalDelay + duration * 1000;
    const timer = window.setTimeout(() => {
      onLetterAnimationComplete();
    }, totalDuration);

    return () => window.clearTimeout(timer);
  }, [isVisible, showCallback, onLetterAnimationComplete, parts.length, delay, duration]);

  const Tag = tag as any;
  const baseStyle: CSSProperties = {
    textAlign,
    display: 'inline-block',
    whiteSpace: splitType === 'lines' ? 'pre-line' : 'pre-wrap',
    willChange: 'transform, opacity'
  };

  const transitionTimingFunction = normalizeEase(ease);

  return (
    <Tag ref={ref} className={className} style={baseStyle}>
      {parts.map((part, index) => {
        const isSpace = part === ' ';
        const spanStyle: CSSProperties = {
          display: 'inline-block',
          whiteSpace: 'pre',
          transitionProperty: 'opacity, transform',
          transitionDuration: `${duration}s`,
          transitionTimingFunction,
          transitionDelay: `${index * delay}ms`,
          ...(isVisible ? to : from)
        };

        if (isSpace) {
          return (
            <span key={`space-${index}`} style={{ whiteSpace: 'pre' }}>
              {part}
            </span>
          );
        }

        return (
          <span key={`${part}-${index}`} style={spanStyle}>
            {part}
          </span>
        );
      })}
    </Tag>
  );
};
