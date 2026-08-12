import { Link } from 'react-router-dom';
import { MenuIcon, PlusIcon } from './Icons';

type AppHeaderProps = {
  documentName?: string;
  onNewClick: () => void;
  onMenuClick?: () => void;
};

export default function AppHeader({ documentName, onNewClick, onMenuClick }: AppHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-ink-200/80 bg-white/90 px-4 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 lg:hidden"
          aria-label="Toggle menu"
        >
          <MenuIcon />
        </button>
        <Link to="/" className="font-display text-lg font-semibold tracking-tight text-ink-950">
          PDF<span className="text-brand-600">Chat</span>
        </Link>
        <div className="hidden h-5 w-px bg-ink-200 sm:block" />
        {documentName ? (
          <p className="hidden min-w-0 truncate text-sm text-ink-600 md:block md:max-w-[280px]" title={documentName}>
            {documentName.replace(/\.pdf$/i, '')}
          </p>
        ) : (
          <p className="hidden text-sm text-ink-400 sm:block">PDF knowledge chat</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={onNewClick} className="btn-primary">
          <PlusIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Upload PDF</span>
          <span className="sm:hidden">Upload</span>
        </button>
      </div>
    </header>
  );
}
