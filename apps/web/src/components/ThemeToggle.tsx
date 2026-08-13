import { MoonIcon, SunIcon } from './Icons';
import { useTheme, type Theme } from '../context/ThemeContext';

type ThemeToggleProps = {
  className?: string;
  variant?: 'icon' | 'switch';
};

export default function ThemeToggle({ className = '', variant = 'switch' }: ThemeToggleProps) {
  const { theme, setTheme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border border-ink-200 bg-surface text-ink-600 transition hover:bg-ink-100 ${className}`}
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        title={isDark ? 'Light theme' : 'Dark theme'}
      >
        {isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
      </button>
    );
  }

  const select = (next: Theme) => setTheme(next);

  return (
    <div
      className={`inline-flex items-center rounded-xl border border-ink-200 bg-ink-100 p-0.5 ${className}`}
      role="group"
      aria-label="Theme"
    >
      <button
        type="button"
        onClick={() => select('light')}
        className={`inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs font-medium transition ${
          !isDark ? 'bg-surface text-ink-950 shadow-sm' : 'text-ink-500 hover:text-ink-800'
        }`}
        aria-pressed={!isDark}
        title="Normal theme"
      >
        <SunIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Normal</span>
      </button>
      <button
        type="button"
        onClick={() => select('dark')}
        className={`inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs font-medium transition ${
          isDark ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-500 hover:text-ink-800'
        }`}
        aria-pressed={isDark}
        title="Black theme"
      >
        <MoonIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Black</span>
      </button>
    </div>
  );
}
