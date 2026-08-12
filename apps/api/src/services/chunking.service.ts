export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  section?: string;
}

const TARGET_TOKENS = 650;
const OVERLAP_TOKENS = 80;

const estimateTokenCount = (text: string) => Math.max(1, Math.ceil(text.length / 4));

const HEADING_LINE =
  /^(?:CHAPTER\s+)?(?:[IVXLC]{1,6}|\d{1,2})[.)]\s+[A-Z].{3,100}$|^(?:[A-Z][A-Za-z0-9'’:,\- ]{8,80})$/;

const splitIntoUnits = (text: string) => {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [] as Array<{ kind: 'heading' | 'body'; text: string }>;

  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const units: Array<{ kind: 'heading' | 'body'; text: string }> = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    units.push({ kind: 'body', text: paragraph.join(' ') });
    paragraph = [];
  };

  for (const line of lines) {
    if (HEADING_LINE.test(line) && line.split(/\s+/).length <= 14) {
      flushParagraph();
      units.push({ kind: 'heading', text: line });
      continue;
    }
    paragraph.push(line);
    if (/[.!?]$/.test(line) && estimateTokenCount(paragraph.join(' ')) > 120) {
      flushParagraph();
    }
  }
  flushParagraph();
  return units;
};

const takeOverlap = (text: string, tokenBudget: number) => {
  if (!text || tokenBudget <= 0) return '';
  const words = text.split(/\s+/).filter(Boolean);
  const approxWords = Math.max(20, tokenBudget * 3);
  return words.slice(Math.max(0, words.length - approxWords)).join(' ');
};

export const createChunksForPage = (_documentId: string, _pageNumber: number, pageText: string, startIndex: number) => {
  const units = splitIntoUnits(pageText);
  const chunks: DocumentChunk[] = [];
  let index = startIndex;
  let current = '';
  let section = units.find((unit) => unit.kind === 'heading')?.text || pageText.split('\n')[0]?.slice(0, 80) || 'Page content';

  const pushChunk = (content: string) => {
    const cleaned = content.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    chunks.push({
      chunkIndex: index++,
      content: cleaned,
      tokenCount: estimateTokenCount(cleaned),
      section: section.slice(0, 120)
    });
  };

  for (const unit of units) {
    if (unit.kind === 'heading') {
      if (current && estimateTokenCount(current) > 120) {
        pushChunk(current);
        const overlap = takeOverlap(current, OVERLAP_TOKENS);
        current = overlap ? `${overlap}\n\n${unit.text}` : unit.text;
      } else {
        current = current ? `${current}\n\n${unit.text}` : unit.text;
      }
      section = unit.text;
      continue;
    }

    const candidate = current ? `${current}\n\n${unit.text}` : unit.text;
    if (estimateTokenCount(candidate) > TARGET_TOKENS && current) {
      pushChunk(current);
      const overlap = takeOverlap(current, OVERLAP_TOKENS);
      current = overlap ? `${overlap}\n\n${unit.text}` : unit.text;
    } else {
      current = candidate;
    }
  }

  if (current) pushChunk(current);

  // Guarantee at least one chunk for non-empty pages.
  if (!chunks.length && pageText.trim()) {
    pushChunk(pageText.trim());
  }

  return chunks;
};
