import { findChapterBoundary, loadChapterPages } from './chapter.boundary.js';
import { detectGraphRequest } from './graph.intent.js';
import {
  ChapterGraph,
  GraphEdge,
  GraphEdgeType,
  GraphNode,
  GraphNodeType,
  GraphRequest,
  GraphType
} from './graph.types.js';
import { ChapterRequest } from './chapter.types.js';
import { getDatabase } from '../utils/database.utils.js';
import { createLLMProvider } from '../ai/llm.provider.js';
import { isRealLLMEnabled } from '../ai/provider.config.js';

type CacheEntry = { graph: ChapterGraph; updatedAt: number };
const graphCache = new Map<string, CacheEntry>();

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

const shortLabel = (value: string, max = 28) => {
  const text = clean(value)
    .replace(/^The Blessed Lord said:\s*/i, '')
    .replace(/^Garu\s*ḍ?a said:\s*/i, '')
    .replace(/[.?!].*$/, '')
    .replace(/[^a-zA-Z0-9'’\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'Concept';
  const words = text.split(' ').filter(Boolean);
  const label = words.slice(0, 4).join(' ');
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
};

const extractKeyPhrases = (text: string) => {
  const headings = Array.from(
    text.matchAll(/(?:^|\n)\s*(?:\d+[.)]\s+|[A-Z][A-Za-z'’\-\s]{8,60}:)\s*([^\n]{8,90})/g)
  )
    .map((match) => clean(match[1] || match[0]))
    .filter((item) => item.length > 8 && item.length < 100);

  const sentences = clean(text)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 40 && part.length < 260)
    .filter((part) => (part.match(/\?/g) || []).length < 3)
    .filter((part) => !/synonyms|contents|introduction this/i.test(part));

  const merged = [...headings, ...sentences];
  const unique: string[] = [];
  for (const item of merged) {
    const key = item.toLowerCase().slice(0, 40);
    if (unique.some((existing) => existing.toLowerCase().startsWith(key.slice(0, 24)))) continue;
    unique.push(item);
  }
  return unique.slice(0, 20);
};

const validateGraph = (graph: ChapterGraph): ChapterGraph => {
  const nodeIds = new Set<string>();
  const nodes: GraphNode[] = [];

  for (const node of graph.nodes) {
    if (!node.id || !node.label?.trim()) continue;
    if (nodeIds.has(node.id)) continue;
    nodeIds.add(node.id);
    nodes.push({
      ...node,
      label: shortLabel(node.label, 32),
      description: clean(node.description || node.label).slice(0, 280),
      pageNumbers: Array.from(new Set((node.pageNumbers || []).filter((page) => page >= graph.pageStart && page <= graph.pageEnd))),
      importance: Math.max(0, Math.min(1, Number(node.importance) || 0.5))
    });
  }

  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    const key = `${edge.source}->${edge.target}:${edge.relationship}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({
      id: edge.id || `edge-${edges.length + 1}`,
      source: edge.source,
      target: edge.target,
      relationship: edge.relationship
    });
  }

  // Ensure root connectivity
  const root = nodes.find((node) => node.type === 'ROOT') || nodes[0];
  if (root) {
    const connected = new Set<string>([root.id]);
    for (const edge of edges) {
      if (connected.has(edge.source)) connected.add(edge.target);
      if (connected.has(edge.target)) connected.add(edge.source);
    }
    for (const node of nodes) {
      if (!connected.has(node.id) && node.id !== root.id) {
        edges.push({
          id: `edge-link-${node.id}`,
          source: root.id,
          target: node.id,
          relationship: 'contains'
        });
      }
    }
  }

  return {
    ...graph,
    nodes: nodes.slice(0, 35),
    edges: edges.slice(0, 60)
  };
};

const buildGraphFromPages = (
  documentId: string,
  request: GraphRequest,
  boundary: { chapterNumber: number; chapterLabel: string; chapterTitle: string; startPage: number; endPage: number },
  pages: Array<{ page_number: number; text: string | null }>
): ChapterGraph => {
  const allText = pages.map((page) => page.text || '').join('\n');
  const phrases = extractKeyPhrases(allText);

  const root: GraphNode = {
    id: 'root',
    label: shortLabel(`Chapter ${boundary.chapterLabel}`, 24),
    type: 'ROOT',
    description: `Main theme: ${boundary.chapterTitle}`,
    importance: 1,
    pageNumbers: [boundary.startPage],
    section: 'Chapter'
  };

  const conceptNodes: GraphNode[] = phrases.slice(0, 10).map((phrase, index) => {
    const page = pages.find((item) => (item.text || '').includes(phrase.slice(0, 40)))?.page_number
      || boundary.startPage;
    return {
      id: `concept-${index + 1}`,
      label: shortLabel(phrase),
      type: 'CONCEPT' as GraphNodeType,
      description: phrase.slice(0, 220),
      importance: Math.max(0.45, 0.95 - index * 0.04),
      pageNumbers: [page],
      section: `Section ${Math.floor(index / 3) + 1}`
    };
  });

  // Ensure we always have some concepts
  if (!conceptNodes.length) {
    conceptNodes.push({
      id: 'concept-1',
      label: shortLabel(boundary.chapterTitle),
      type: 'CONCEPT',
      description: boundary.chapterTitle,
      importance: 0.9,
      pageNumbers: [boundary.startPage]
    });
  }

  const principleNodes: GraphNode[] = phrases.slice(10, 14).map((phrase, index) => ({
    id: `principle-${index + 1}`,
    label: shortLabel(phrase),
    type: 'PRINCIPLE' as GraphNodeType,
    description: phrase.slice(0, 220),
    importance: 0.7 - index * 0.05,
    pageNumbers: [
      pages.find((item) => (item.text || '').includes(phrase.slice(0, 40)))?.page_number || boundary.startPage
    ]
  }));

  const exampleNodes: GraphNode[] = phrases
    .filter((phrase) => /for example|like|such as|said|story|analogy/i.test(phrase))
    .slice(0, 3)
    .map((phrase, index) => ({
      id: `example-${index + 1}`,
      label: shortLabel(phrase),
      type: 'EXAMPLE' as GraphNodeType,
      description: phrase.slice(0, 220),
      importance: 0.55,
      pageNumbers: [
        pages.find((item) => (item.text || '').includes(phrase.slice(0, 40)))?.page_number || boundary.endPage
      ]
    }));

  const conclusion: GraphNode = {
    id: 'conclusion',
    label: 'Chapter Conclusion',
    type: 'CONCLUSION',
    description: phrases[phrases.length - 1] || `Conclusion of ${boundary.chapterTitle}`,
    importance: 0.85,
    pageNumbers: [boundary.endPage]
  };

  const nodes = [root, ...conceptNodes, ...principleNodes, ...exampleNodes, conclusion].slice(0, 28);

  const edges: GraphEdge[] = [];
  let edgeIndex = 1;
  const addEdge = (source: string, target: string, relationship: GraphEdgeType) => {
    edges.push({
      id: `edge-${edgeIndex++}`,
      source,
      target,
      relationship
    });
  };

  for (const node of conceptNodes) {
    addEdge(root.id, node.id, 'contains');
  }

  for (let index = 0; index < conceptNodes.length - 1; index += 1) {
    addEdge(conceptNodes[index].id, conceptNodes[index + 1].id, request.graphType === 'cause_effect' ? 'leads_to' : 'related_to');
  }

  for (const node of principleNodes) {
    const parent = conceptNodes[Math.min(principleNodes.indexOf(node), conceptNodes.length - 1)] || root;
    addEdge(parent.id, node.id, 'supports');
  }

  for (const node of exampleNodes) {
    const parent = conceptNodes[Math.min(exampleNodes.indexOf(node), conceptNodes.length - 1)] || root;
    addEdge(parent.id, node.id, 'example_of');
  }

  addEdge(conceptNodes[conceptNodes.length - 1]?.id || root.id, conclusion.id, 'concludes');

  const graph: ChapterGraph = {
    type: request.graphType,
    documentId,
    chapterNumber: boundary.chapterNumber,
    chapterTitle: boundary.chapterTitle,
    pageStart: boundary.startPage,
    pageEnd: boundary.endPage,
    nodes,
    edges
  };

  return validateGraph(graph);
};

const synthesizeGraphWithLLM = async (
  documentId: string,
  request: GraphRequest,
  boundary: { chapterNumber: number; chapterLabel: string; chapterTitle: string; startPage: number; endPage: number },
  pages: Array<{ page_number: number; text: string | null }>
): Promise<ChapterGraph | null> => {
  if (!isRealLLMEnabled()) return null;

  const digest = pages
    .map((page) => `Page ${page.page_number}: ${(page.text || '').slice(0, 1200)}`)
    .join('\n\n')
    .slice(0, 12000);

  const provider = createLLMProvider();
  const prompt = [
    'Create a concept graph JSON for this chapter.',
    'Return ONLY valid JSON with shape:',
    '{"nodes":[{"id":"root","label":"...","type":"ROOT","description":"...","importance":1,"pageNumbers":[n]}],"edges":[{"id":"e1","source":"root","target":"concept-1","relationship":"contains"}]}',
    'Rules:',
    '- One ROOT node for the chapter theme',
    '- 10 to 22 total nodes',
    '- Concise labels (2-5 words)',
    '- Use types: ROOT, CONCEPT, SUBCONCEPT, PRINCIPLE, EXAMPLE, CONCLUSION, SECTION',
    '- Use relationships: contains, explains, leads_to, supports, example_of, part_of, concludes, related_to',
    '- Only include ideas supported by the text',
    '- Include pageNumbers for important nodes',
    `Graph mode: ${request.graphType}`,
    `Chapter ${boundary.chapterLabel}: ${boundary.chapterTitle}`,
    `Pages ${boundary.startPage}-${boundary.endPage}`,
    '',
    digest
  ].join('\n');

  try {
    const raw = await provider.generateAnswer([
      { role: 'system', content: 'You extract faithful concept graphs from chapter text. Reply with JSON only.' },
      { role: 'user', content: prompt }
    ]);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { nodes?: GraphNode[]; edges?: GraphEdge[] };
    if (!parsed.nodes?.length) return null;

    return validateGraph({
      type: request.graphType,
      documentId,
      chapterNumber: boundary.chapterNumber,
      chapterTitle: boundary.chapterTitle,
      pageStart: boundary.startPage,
      pageEnd: boundary.endPage,
      nodes: parsed.nodes,
      edges: parsed.edges || []
    });
  } catch (error) {
    console.warn('LLM graph synthesis failed; using heuristic graph.', error instanceof Error ? error.message : error);
    return null;
  }
};

const cacheKey = (documentId: string, chapterNumber: number, graphType: GraphType, start: number, end: number) =>
  `${documentId}:${chapterNumber}:${graphType}:${start}:${end}`;

export const generateChapterGraph = async (documentId: string, request: GraphRequest) => {
  const chapterRequest: ChapterRequest = {
    type: 'CHAPTER_ANALYSIS',
    mode: 'explain',
    chapterNumber: request.chapterNumber,
    chapterLabel: request.chapterLabel,
    chapterTitleHint: request.chapterTitleHint,
    rawQuery: request.rawQuery
  };

  const boundary = await findChapterBoundary(documentId, chapterRequest);
  if (!boundary) {
    return {
      type: 'GRAPH_RESPONSE' as const,
      intent: 'GRAPH_GENERATION' as const,
      answer: 'Unable to generate the graph for this chapter right now. I could not detect the chapter boundaries clearly. Please try again with an exact chapter title.',
      graph: null,
      sources: []
    };
  }

  const key = cacheKey(documentId, boundary.chapterNumber, request.graphType, boundary.startPage, boundary.endPage);
  let graph = graphCache.get(key)?.graph;
  if (!graph) {
    const pages = await loadChapterPages(documentId, boundary.startPage, boundary.endPage);
    graph = (await synthesizeGraphWithLLM(documentId, request, boundary, pages))
      || buildGraphFromPages(documentId, request, boundary, pages);
    graphCache.set(key, { graph, updatedAt: Date.now() });
  }

  const keyConcepts = graph.nodes
    .filter((node) => node.type === 'CONCEPT' || node.type === 'PRINCIPLE')
    .slice(0, 8)
    .map((node, index) => `${index + 1}. **${node.label}** — ${node.description}`);

  const relationships = graph.edges.slice(0, 8).map((edge) => {
    const source = graph!.nodes.find((node) => node.id === edge.source)?.label || edge.source;
    const target = graph!.nodes.find((node) => node.id === edge.target)?.label || edge.target;
    return `- ${source} → ${edge.relationship.replace(/_/g, ' ')} → ${target}`;
  });

  const answer = [
    `# Chapter ${boundary.chapterLabel} — Concept Graph`,
    '',
    '## Overview',
    `Here is an interactive concept graph for **${boundary.chapterTitle}** (pages ${boundary.startPage}–${boundary.endPage}).`,
    'It highlights the main theme, key concepts, supporting principles, and how they connect.',
    '',
    '## Concept Graph',
    '[INTERACTIVE_GRAPH]',
    '',
    '## Key Concepts',
    ...keyConcepts,
    '',
    '## Main Relationships',
    ...relationships,
    '',
    '## Sources',
    `- Chapter ${boundary.chapterLabel} — Pages ${boundary.startPage}–${boundary.endPage}`
  ].join('\n');

  const sources = graph.nodes
    .flatMap((node) => node.pageNumbers.map((page) => ({
      documentId,
      pageNumber: page,
      sourceText: `${node.label} (Page ${page})`
    })))
    .filter((item, index, list) => list.findIndex((entry) => entry.pageNumber === item.pageNumber && entry.sourceText === item.sourceText) === index)
    .slice(0, 12);

  return {
    type: 'GRAPH_RESPONSE' as const,
    intent: 'GRAPH_GENERATION' as const,
    answer,
    graph,
    summary: `Chapter ${boundary.chapterLabel}: ${boundary.chapterTitle}`,
    sources,
    meta: {
      type: 'GRAPH_GENERATION' as const,
      graphType: request.graphType,
      chapterNumber: boundary.chapterNumber,
      chapterTitle: boundary.chapterTitle,
      pageRange: { start: boundary.startPage, end: boundary.endPage },
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length
    }
  };
};

export const tryGraphGeneration = async (documentId: string, query: string) => {
  const request = detectGraphRequest(query);
  if (!request) return null;
  return generateChapterGraph(documentId, request);
};

const ORDINAL: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5
};

export const tryGraphFollowUp = async (documentId: string, query: string) => {
  const text = query.trim().toLowerCase();
  const match = text.match(/\bexplain\s+(?:the\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|\d+)\s+(?:concept|node|idea)\b/i)
    || text.match(/\bwhat\s+is\s+(?:the\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|\d+)\s+(?:concept|node)\b/i);
  if (!match) return null;

  const token = match[1].toLowerCase();
  const index = ORDINAL[token] || Number(token);
  if (!Number.isFinite(index) || index < 1) return null;

  const cached = Array.from(graphCache.entries())
    .filter(([key]) => key.startsWith(`${documentId}:`))
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)[0]?.[1]?.graph;

  if (!cached) return null;

  const concepts = cached.nodes.filter((node) => node.type === 'CONCEPT' || node.type === 'PRINCIPLE' || node.type === 'SUBCONCEPT');
  const node = concepts[index - 1] || cached.nodes[index];
  if (!node) {
    return {
      type: 'TEXT_RESPONSE' as const,
      intent: 'GRAPH_FOLLOW_UP' as const,
      answer: `I could not find concept #${index} in the current chapter graph. Please open or regenerate the graph first.`,
      sources: []
    };
  }

  const pages = node.pageNumbers.length ? node.pageNumbers : [cached.pageStart];
  return {
    type: 'TEXT_RESPONSE' as const,
    intent: 'GRAPH_FOLLOW_UP' as const,
    answer: [
      `## ${node.label}`,
      '',
      `**Type:** ${node.type}`,
      '',
      node.description,
      '',
      '### Why it matters',
      `This concept is part of Chapter ${cached.chapterNumber} (“${cached.chapterTitle}”) and connects to the chapter’s main theme through the concept graph.`,
      '',
      '### Sources',
      ...pages.map((page) => `- Page ${page}`)
    ].join('\n'),
    sources: pages.map((page) => ({
      documentId,
      pageNumber: page,
      sourceText: `${node.label} (Page ${page})`
    })),
    meta: {
      selectedNodeId: node.id,
      chapterNumber: cached.chapterNumber,
      graphType: cached.type
    }
  };
};

export const invalidateGraphCache = (documentId?: string) => {
  if (!documentId) {
    graphCache.clear();
    return;
  }
  for (const key of graphCache.keys()) {
    if (key.startsWith(`${documentId}:`)) graphCache.delete(key);
  }
};

export const getChapterGraphByNumber = async (
  documentId: string,
  chapterNumber: number,
  graphType: GraphType = 'concept_map'
) => {
  const db = getDatabase();
  const exists = await db.query('SELECT id FROM documents WHERE id=$1', [documentId]);
  if (!exists.rowCount) {
    throw new Error('DOCUMENT_NOT_FOUND');
  }

  return generateChapterGraph(documentId, {
    type: 'GRAPH_GENERATION',
    graphType,
    chapterNumber,
    chapterLabel: String(chapterNumber),
    rawQuery: `Create a ${graphType} graph for chapter ${chapterNumber}`
  });
};
