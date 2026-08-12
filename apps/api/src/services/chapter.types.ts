export type ChapterMode =
  | 'explain'
  | 'summarize'
  | 'short'
  | 'points'
  | 'teach'
  | 'exam'
  | 'compare';

export type ChapterRequest = {
  type: 'CHAPTER_ANALYSIS';
  mode: ChapterMode;
  chapterNumber?: number;
  chapterLabel?: string;
  chapterTitleHint?: string;
  compareWith?: {
    chapterNumber?: number;
    chapterLabel?: string;
  };
  rawQuery: string;
};

export type ChapterBoundary = {
  chapterNumber: number;
  chapterLabel: string;
  chapterTitle: string;
  startPage: number;
  endPage: number;
  headingMatches: string[];
  /** True when the range was derived by splitting a heading-less document into parts. */
  synthesized?: boolean;
};

export type ChapterSection = {
  title: string;
  startPage: number;
  endPage: number;
  summary: string;
  concepts: string[];
  points: string[];
  examples: string[];
};

export type ChapterKnowledge = {
  chapterTitle: string;
  chapterNumber: number;
  chapterLabel: string;
  pageRange: { start: number; end: number };
  mainTheme: string;
  overview: string;
  coreConcepts: Array<{ name: string; explanation: string }>;
  importantPoints: string[];
  examples: Array<{ text: string; why: string }>;
  definitions: Array<{ term: string; explanation: string }>;
  relationships: string[];
  conclusion: string;
  simpleExplanation: string;
  takeaways: string[];
  sections: ChapterSection[];
  sources: Array<{ label: string; startPage: number; endPage: number }>;
};
