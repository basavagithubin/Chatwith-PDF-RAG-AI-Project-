import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from './AppHeader';
import Sidebar from './Sidebar';
import UploadModal from './UploadModal';
import { getDocuments } from '../services/documents.service';
import { UploadContext } from '../context/UploadContext';

type ChatLayoutProps = {
  children: ReactNode;
  documentName?: string;
  onDocumentsChange?: () => void;
};

export default function ChatLayout({ children, documentName, onDocumentsChange }: ChatLayoutProps) {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadDocuments = async () => {
    try {
      setDocuments(await getDocuments());
      onDocumentsChange?.();
    } catch {
      setDocuments([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
  }, []);

  const handleUploaded = (documentId: string) => {
    void loadDocuments();
    navigate(`/documents/${documentId}`);
  };

  const uploadContext = useMemo(() => ({ openUpload: () => setUploadOpen(true) }), []);

  return (
    <UploadContext.Provider value={uploadContext}>
      <div className="flex h-screen flex-col overflow-hidden bg-surface-muted">
        <AppHeader
          documentName={documentName}
          onNewClick={() => setUploadOpen(true)}
          onMenuClick={() => setSidebarOpen((open) => !open)}
        />
        <div className="relative flex min-h-0 flex-1">
          <Sidebar
            documents={documents}
            isLoading={isLoading}
            onNewClick={() => setUploadOpen(true)}
            className={`${
              sidebarOpen
                ? 'absolute inset-y-0 left-0 z-30 shadow-lift lg:relative lg:shadow-none'
                : 'hidden lg:flex'
            }`}
          />
          {sidebarOpen && (
            <button
              type="button"
              className="absolute inset-0 z-20 bg-ink-950/25 lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
            />
          )}
          {children}
        </div>
        <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={handleUploaded} />
      </div>
    </UploadContext.Provider>
  );
}
