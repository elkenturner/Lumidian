// frontend/lib/motion.ts
import { useEffect, useRef, useState } from 'react';
import { type Variants, useReducedMotion } from 'framer-motion';

// ── Custom easing curves (Emil Kowalski) ─────────────────────────────────────
// Never use ease-in (feels sluggish) or bounce/elastic (feels dated)
export const easings = {
  out: [0.23, 1, 0.32, 1] as const,       // UI interactions
  inOut: [0.77, 0, 0.175, 1] as const,     // On-screen movement
  drawer: [0.32, 0.72, 0, 1] as const,     // Drawers/panels
} as const;

// ── Reusable variants ────────────────────────────────────────────────────────

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.3, ease: easings.out },
  },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, transform: 'translateY(8px)' },
  visible: {
    opacity: 1,
    transform: 'translateY(0px)',
    transition: { duration: 0.35, ease: easings.out },
  },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.04,
    },
  },
};

export const staggerChild: Variants = {
  hidden: { opacity: 0, transform: 'translateY(8px)' },
  visible: {
    opacity: 1,
    transform: 'translateY(0px)',
    transition: { duration: 0.35, ease: easings.out },
  },
};

export const slideIn: Variants = {
  hidden: { opacity: 0, transform: 'translateX(-12px)' },
  visible: {
    opacity: 1,
    transform: 'translateX(0px)',
    transition: { duration: 0.2, ease: easings.out },
  },
  exit: {
    opacity: 0,
    transform: 'translateX(12px)',
    transition: { duration: 0.15, ease: easings.out },
  },
};

// Spring config for modals — never scale(0), start from scale(0.95)
export const springModal: Variants = {
  hidden: { opacity: 0, transform: 'scale(0.95)' },
  visible: {
    opacity: 1,
    transform: 'scale(1)',
    transition: { type: 'spring', duration: 0.4, bounce: 0.15 },
  },
  exit: {
    opacity: 0,
    transform: 'scale(0.95)',
    transition: { duration: 0.15, ease: easings.out },
  },
};

// ── CSS easing values (for inline styles / CSS-in-JS) ────────────────────────
export const cssEasings = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const;

// ── Count-up animation hook ──────────────────────────────────────────────────
export function useCountUp(target: number, duration = 600): string {
  const prefersReduced = useReducedMotion();
  const [display, setDisplay] = useState('0');
  const frameRef = useRef<number>(0);
  const prevTargetRef = useRef<number>(0);

  useEffect(() => {
    if (prefersReduced || target === 0) {
      setDisplay(formatStatValue(target));
      return;
    }

    const start = performance.now();
    const startValue = prevTargetRef.current;
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic curve
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (target - startValue) * eased;
      setDisplay(formatStatValue(current));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        prevTargetRef.current = target;
      }
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration, prefersReduced]);

  return display;
}

function formatStatValue(n: number): string {
  if (n >= 1000) return Math.round(n).toLocaleString();
  if (n % 1 === 0) return Math.round(n).toString();
  return n.toFixed(1);
}

// ── Reduced motion helper ────────────────────────────────────────────────────
export function getReducedMotionVariants(variants: Variants): Variants {
  const reduced: Variants = {};
  for (const key in variants) {
    if (key === 'hidden') {
      reduced[key] = { opacity: 0 };
    } else {
      reduced[key] = { opacity: 1, transition: { duration: 0.01 } };
    }
  }
  return reduced;
}
