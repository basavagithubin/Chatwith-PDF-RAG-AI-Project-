export type GraphType = 'concept_map' | 'mind_map' | 'hierarchy' | 'timeline' | 'cause_effect';

export type GraphNodeType =
  | 'ROOT'
  | 'CONCEPT'
  | 'SUBCONCEPT'
  | 'DEFINITION'
  | 'PRINCIPLE'
  | 'EXAMPLE'
  | 'EVENT'
  | 'PERSON'
  | 'CAUSE'
  | 'EFFECT'
  | 'CONCLUSION'
  | 'SECTION';

export type GraphEdgeType =
  | 'contains'
  | 'explains'
  | 'leads_to'
  | 'causes'
  | 'results_in'
  | 'depends_on'
  | 'contrasts_with'
  | 'supports'
  | 'example_of'
  | 'part_of'
  | 'concludes'
  | 'related_to'
  | 'describes';

export type GraphNode = {
  id: string;
  label: string;
  type: GraphNodeType;
  description: string;
  importance: number;
  pageNumbers: number[];
  section?: string;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relationship: GraphEdgeType;
};

export type ChapterGraph = {
  type: GraphType;
  documentId: string;
  chapterNumber: number;
  chapterTitle: string;
  pageStart: number;
  pageEnd: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type GraphRequest = {
  type: 'GRAPH_GENERATION';
  graphType: GraphType;
  chapterNumber?: number;
  chapterLabel?: string;
  chapterTitleHint?: string;
  rawQuery: string;
};
