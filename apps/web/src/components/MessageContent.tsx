import type { ReactNode } from 'react';

type MessageContentProps = {
  content: string;
  sources?: Array<{ pageNumber?: number; sourceText?: string }>;
  graphSlot?: ReactNode;
  onOpenPage?: (page: number) => void;
  streaming?: boolean;
};

const renderInline = (text: string) => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-ink-950">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
};

const isChapterBullet = (item: string) =>
  /^\*\*(?:[IVXLC]+\.|Chapter\s+\d+)[^*]*\*\*/i.test(item.trim()) ||
  /^(?:[IVXLC]+\.|Chapter\s+\d+)/i.test(item.replace(/\*\*/g, '').trim());

export default function MessageContent({ content, sources, graphSlot, onOpenPage, streaming }: MessageContentProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: JSX.Element[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let key = 0;

  const flushList = () => {
    if (!listItems.length || !listType) return;
    const chapterStyle = listType === 'ul' && listItems.every(isChapterBullet);

    if (chapterStyle) {
      blocks.push(
        <div key={`chapters-${key++}`} className="my-3 space-y-1.5">
          {listItems.map((item, index) => {
            const plain = item.replace(/\*\*/g, '').trim();
            const match = plain.match(/^([IVXLC]+\.|Chapter\s+\d+[.:]?)\s*(.*)$/i);
            const label = match?.[1] ?? `${index + 1}.`;
            const title = match?.[2] || plain;
            return (
              <div
                key={index}
                className="flex gap-3 rounded-xl border border-ink-100 bg-surface px-3 py-2.5 shadow-sm"
              >
                <span className="mt-0.5 shrink-0 rounded-md bg-brand-50 px-2 py-0.5 font-display text-[11px] font-semibold text-brand-800">
                  {label.replace(/\.$/, '')}
                </span>
                <p className="min-w-0 text-sm leading-snug text-ink-800">{title}</p>
              </div>
            );
          })}
        </div>
      );
    } else {
      const Tag = listType;
      blocks.push(
        <Tag
          key={`list-${key++}`}
          className={listType === 'ul' ? 'my-2 list-disc space-y-1.5 pl-5' : 'my-2 list-decimal space-y-1.5 pl-5'}
        >
          {listItems.map((item, index) => (
            <li key={index} className="text-sm leading-relaxed text-ink-700">
              {renderInline(item)}
            </li>
          ))}
        </Tag>
      );
    }

    listItems = [];
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    if (line === '[INTERACTIVE_GRAPH]') {
      flushList();
      if (graphSlot) {
        blocks.push(
          <div key={`graph-${key++}`} className="my-3">
            {graphSlot}
          </div>
        );
      }
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const className =
        level === 1
          ? 'mb-2 mt-1 font-display text-base font-semibold leading-snug text-ink-950'
          : level === 2
            ? 'mb-1.5 mt-3 font-display text-sm font-semibold text-ink-950'
            : 'mb-1 mt-2 text-sm font-semibold text-ink-800';
      blocks.push(
        <p key={`h-${key++}`} className={className}>
          {renderInline(text)}
        </p>
      );
      continue;
    }

    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(bulletMatch[1]);
      continue;
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listItems.push(numberedMatch[1]);
      continue;
    }

    if (line.startsWith('> ')) {
      flushList();
      blocks.push(
        <blockquote
          key={`q-${key++}`}
          className="my-2 rounded-lg border-l-4 border-brand-400 bg-surface px-3 py-2 text-sm leading-relaxed text-ink-600"
        >
          {renderInline(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    flushList();
    blocks.push(
      <p key={`p-${key++}`} className="my-1.5 text-sm leading-relaxed text-ink-700">
        {renderInline(line)}
      </p>
    );
  }

  flushList();

  const uniquePages = Array.from(
    new Set((sources ?? []).map((source) => source.pageNumber).filter((page): page is number => typeof page === 'number'))
  ).sort((a, b) => a - b);

  return (
    <div className="text-left">
      <div className="space-y-0.5">
        {blocks}
        {streaming && (
          <span
            className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-brand-600 align-middle"
            aria-hidden
          />
        )}
      </div>
      {!streaming && uniquePages.length > 0 && (
        <div className="mt-4 border-t border-ink-100 pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">Jump to source</p>
          <div className="flex flex-wrap gap-1.5">
            {uniquePages.map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => onOpenPage?.(page)}
                className="rounded-lg bg-surface px-2.5 py-1.5 text-xs font-semibold text-brand-800 ring-1 ring-brand-200 transition hover:bg-brand-50"
              >
                Page {page}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
