'use client';

import React, { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';

/**
 * ThemeToggle Component
 * Allows switching between Light, Dark, and System themes.
 * Uses a modern segmented pill design with clear text labels on desktop and tooltips.
 */
export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-9 w-24 sm:w-56 rounded-xl bg-card/60 border border-border/60 animate-pulse" />
    );
  }

  const options = [
    { key: 'light', label: 'Light', icon: Sun, tooltip: 'Switch to light theme' },
    { key: 'dark', label: 'Dark', icon: Moon, tooltip: 'Switch to dark theme' },
    { key: 'system', label: 'Auto', icon: Monitor, tooltip: 'Sync with system OS theme' },
  ] as const;

  return (
    <div
      className="inline-flex items-center rounded-xl p-1 bg-card/90 backdrop-blur-md border border-border/70 shadow-xs"
      role="radiogroup"
      aria-label="Theme mode selector"
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const isActive = theme === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => setTheme(opt.key)}
            className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer ${
              isActive
                ? 'bg-primary text-background shadow-xs font-semibold scale-100'
                : 'text-muted hover:text-foreground hover:bg-muted/10'
            }`}
            aria-label={opt.tooltip}
            title={opt.tooltip}
          >
            <Icon className="w-3.5 h-3.5 transition-transform duration-200" />
            <span className="hidden sm:inline text-[11px]">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
