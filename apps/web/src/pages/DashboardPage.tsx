import ChatLayout from '../components/ChatLayout';
import LibraryView from '../components/LibraryView';

export default function DashboardPage() {
  return (
    <ChatLayout>
      {({ documents, isLoading, nav, openUpload }) => (
        <LibraryView documents={documents} isLoading={isLoading} nav={nav} onAddDocument={openUpload} />
      )}
    </ChatLayout>
  );
}
