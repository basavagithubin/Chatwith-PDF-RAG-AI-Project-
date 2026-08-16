import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-6">
      <div className="max-w-md rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="text-sm font-semibold text-brand-700">404</p>
        <h1 className="mt-2 font-display text-xl font-semibold text-ink-950">Page not found</h1>
        <p className="mt-3 text-sm text-ink-600">That route does not exist in PDFChat.</p>
        <Link to="/" className="btn-primary mt-6 inline-flex w-full justify-center">
          Go to library
        </Link>
      </div>
    </div>
  );
}
