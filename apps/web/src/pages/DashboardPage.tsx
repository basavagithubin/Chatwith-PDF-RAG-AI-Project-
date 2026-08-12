import ChatLayout from '../components/ChatLayout';
import { useUpload } from '../context/UploadContext';

function DashboardHero() {
  const { openUpload } = useUpload();

  return (
    <div className="relative flex min-w-0 flex-1 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-surface-canvas">
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-brand-200/40 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-ink-200/50 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(26,34,40,0.12) 1px, transparent 0)',
            backgroundSize: '22px 22px'
          }}
        />
      </div>

      <div className="relative z-10 flex w-full flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl text-center">
          <p className="animate-fade-up font-display text-xs font-semibold uppercase tracking-[0.22em] text-brand-700">
            Portfhelio
          </p>
          <h1 className="animate-fade-up mt-4 font-display text-4xl font-semibold tracking-tight text-ink-950 sm:text-5xl">
            Read deeper.
            <span className="block text-brand-700">Ask anything.</span>
          </h1>
          <p className="animate-fade-up-delay mx-auto mt-5 max-w-lg text-base leading-relaxed text-ink-600 sm:text-lg">
            Upload a PDF, chat with grounded answers, open page citations, and generate interactive chapter concept graphs.
          </p>
          <div className="animate-fade-up-delay mt-8 flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={openUpload} className="btn-primary px-6 py-3 text-base shadow-toolbar">
              Upload PDF
            </button>
            <p className="text-sm text-ink-500">No account required · local-ready</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ChatLayout>
      <DashboardHero />
    </ChatLayout>
  );
}
