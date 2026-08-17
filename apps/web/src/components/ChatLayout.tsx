import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppHeader from './AppHeader';
import Sidebar from './Sidebar';
import UploadModal from './UploadModal';
import { getDocuments } from '../services/documents.service';
import { UploadContext } from '../context/UploadContext';
import { LibraryDocument, LibraryNav } from '../lib/library.prefs';

type ChatLayoutProps = {
  children: ReactNode | ((ctx: { documents: LibraryDocument[]; isLoading: boolean; nav: LibraryNav; openUpload: () => void; setNav: (nav: LibraryNav) => void }) => ReactNode);
  documentName?: string;
  onDocumentsChange?: () => void;
};

const isLibraryNav = (value: string | null): value is LibraryNav =>
  value === 'library' || value === 'recent' || value === 'favorites' || value === 'collections';

export default function ChatLayout({ children, documentName, onDocumentsChange }: ChatLayoutProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [nav, setNavState] = useState<LibraryNav>(
    isLibraryNav(searchParams.get('nav')) ? (searchParams.get('nav') as LibraryNav) : 'library'
  );

  const setNav = (next: LibraryNav) => {
    setNavState(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'library') params.delete('nav');
    else params.set('nav', next);
    setSearchParams(params, { replace: true });
  };

  const loadDocuments = async () => {
    try {
      setDocuments(await getDocuments());
      setApiError(null);
      onDocumentsChange?.();
    } catch (error) {
      setDocuments([]);
      setApiError(error instanceof Error ? error.message : 'Could not reach the API.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
  }, []);

  useEffect(() => {
    const fromQuery = searchParams.get('nav');
    if (isLibraryNav(fromQuery) && fromQuery !== nav) setNavState(fromQuery);
  }, [searchParams]);

  const handleUploaded = (documentId: string) => {
    void loadDocuments();
    navigate(`/documents/${documentId}`);
  };

  const openUpload = () => setUploadOpen(true);
  const uploadContext = useMemo(() => ({ openUpload }), []);

  return (
    <UploadContext.Provider value={uploadContext}>
      <div className="flex h-screen flex-col overflow-hidden bg-surface-muted text-ink-950">
        <AppHeader
          documentName={documentName}
          onNewClick={openUpload}
          onMenuClick={() => setSidebarOpen((open) => !open)}
        />
        <div className="relative flex min-h-0 flex-1">
          <Sidebar
            documents={documents}
            isLoading={isLoading}
            activeNav={nav}
            onNavChange={(next) => {
              setSidebarOpen(false);
              if (window.location.pathname !== '/') {
                navigate(next === 'library' ? '/' : `/?nav=${next}`);
              } else {
                setNav(next);
              }
            }}
            onNewClick={openUpload}
            className={`${
              sidebarOpen
                ? 'absolute inset-y-0 left-0 z-30 shadow-lift lg:relative lg:shadow-none'
                : 'hidden lg:flex'
            }`}
          />
          {sidebarOpen && (
            <button
              type="button"
              className="absolute inset-0 z-20 bg-black/25 lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
            />
          )}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {apiError && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                {apiError}
              </div>
            )}
            {typeof children === 'function'
              ? children({ documents, isLoading, nav, openUpload, setNav })
              : children}
          </div>
        </div>
        <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={handleUploaded} />
      </div>
    </UploadContext.Provider>
  );
}
