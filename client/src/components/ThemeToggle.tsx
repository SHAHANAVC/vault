'use client';

import React, { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';

/**
 * ThemeToggle Component
 * Allows switching between Light, Dark, and System themes.
 * Prevents hydration mismatches by mounting before rendering theme state.
 */
export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-9 w-24 rounded-lg bg-card border border-border animate-pulse" />
    );
  }

  return (
    <div
      className="inline-flex items-center rounded-lg p-1 bg-card border border-border shadow-xs"
      role="radiogroup"
      aria-label="Theme mode"
    >
      <button
        type="button"
        onClick={() => setTheme('light')}
        className={`p-1.5 rounded-md transition-all cursor-pointer ${
          theme === 'light'
            ? 'bg-primary/10 text-primary font-semibold shadow-xs'
            : 'text-muted hover:text-foreground'
        }`}
        aria-label="Switch to light theme"
        title="Light theme"
      >
        <Sun className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        onClick={() => setTheme('dark')}
        className={`p-1.5 rounded-md transition-all cursor-pointer ${
          theme === 'dark'
            ? 'bg-primary/10 text-primary font-semibold shadow-xs'
            : 'text-muted hover:text-foreground'
        }`}
        aria-label="Switch to dark theme"
        title="Dark theme"
      >
        <Moon className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        onClick={() => setTheme('system')}
        className={`p-1.5 rounded-md transition-all cursor-pointer ${
          theme === 'system'
            ? 'bg-primary/10 text-primary font-semibold shadow-xs'
            : 'text-muted hover:text-foreground'
        }`}
        aria-label="Switch to system theme"
        title="System preference"
      >
        <Monitor className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
