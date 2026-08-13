import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  NodeProps,
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  useReactFlow
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ChapterGraphData, GraphNodeData, GraphNodeType } from '../types/graph';
import { useTheme, type Theme } from '../context/ThemeContext';

type GraphCardProps = {
  graph: ChapterGraphData;
  onOpenPage?: (page: number) => void;
};

type NodePalette = { bg: string; border: string; text: string };

const TYPE_COLORS_LIGHT: Record<GraphNodeType, NodePalette> = {
  ROOT: { bg: '#0d9488', border: '#0f766e', text: '#ffffff' },
  CONCEPT: { bg: '#f0fdfa', border: '#5eead4', text: '#134e4a' },
  SUBCONCEPT: { bg: '#f4f7f8', border: '#a7bcc6', text: '#3c4851' },
  DEFINITION: { bg: '#ecfeff', border: '#22d3ee', text: '#155e75' },
  PRINCIPLE: { bg: '#f0fdf4', border: '#4ade80', text: '#166534' },
  EXAMPLE: { bg: '#fff7ed', border: '#fb923c', text: '#9a3412' },
  EVENT: { bg: '#e4ecef', border: '#7a98a6', text: '#1a2228' },
  PERSON: { bg: '#f7fafb', border: '#5e7c8b', text: '#1a2228' },
  CAUSE: { bg: '#fef2f2', border: '#f87171', text: '#991b1b' },
  EFFECT: { bg: '#fffbeb', border: '#fbbf24', text: '#92400e' },
  CONCLUSION: { bg: '#ccfbf1', border: '#14b8a6', text: '#134e4a' },
  SECTION: { bg: '#f4f7f8', border: '#7a98a6', text: '#1a2228' }
};

const TYPE_COLORS_DARK: Record<GraphNodeType, NodePalette> = {
  ROOT: { bg: '#0d9488', border: '#2dd4bf', text: '#ffffff' },
  CONCEPT: { bg: '#0f2826', border: '#2dd4bf', text: '#ccfbf1' },
  SUBCONCEPT: { bg: '#1a2228', border: '#5e7c8b', text: '#e4ecef' },
  DEFINITION: { bg: '#0c2a32', border: '#22d3ee', text: '#a5f3fc' },
  PRINCIPLE: { bg: '#10271a', border: '#4ade80', text: '#bbf7d0' },
  EXAMPLE: { bg: '#2a1a0c', border: '#fb923c', text: '#fed7aa' },
  EVENT: { bg: '#1a2228', border: '#7a98a6', text: '#e4ecef' },
  PERSON: { bg: '#1a2228', border: '#5e7c8b', text: '#e4ecef' },
  CAUSE: { bg: '#2a1212', border: '#f87171', text: '#fecaca' },
  EFFECT: { bg: '#2a220c', border: '#fbbf24', text: '#fde68a' },
  CONCLUSION: { bg: '#0f2826', border: '#14b8a6', text: '#99f6e4' },
  SECTION: { bg: '#1a2228', border: '#7a98a6', text: '#e4ecef' }
};

const paletteFor = (theme: Theme) => (theme === 'dark' ? TYPE_COLORS_DARK : TYPE_COLORS_LIGHT);

function ConceptNode({ data, selected }: NodeProps) {
  const { theme } = useTheme();
  const node = data as GraphNodeData & { collapsed?: boolean; hasChildren?: boolean; onToggle?: () => void };
  const colors = paletteFor(theme)[node.type] || paletteFor(theme).CONCEPT;

  return (
    <div
      className={`min-w-[120px] max-w-[160px] rounded-xl border-2 px-3 py-2 shadow-sm transition ${
        selected ? 'ring-2 ring-brand-400 ring-offset-2' : ''
      }`}
      style={{ background: colors.bg, borderColor: colors.border, color: colors.text }}
    >
      <Handle type="target" position={Position.Top} className="!bg-ink-400 !w-2 !h-2" />
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{node.type}</p>
      <p className="mt-0.5 text-xs font-semibold leading-snug">{node.label}</p>
      {node.hasChildren && (
        <button
          type="button"
          className="mt-1 text-[10px] font-medium underline opacity-80 hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            node.onToggle?.();
          }}
        >
          {node.collapsed ? 'Expand' : 'Collapse'}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-ink-400 !w-2 !h-2" />
    </div>
  );
}

const nodeTypes = { concept: ConceptNode };

const layoutNodes = (
  graph: ChapterGraphData,
  collapsed: Set<string>,
  theme: Theme
): { nodes: Node[]; edges: Edge[]; hidden: Set<string> } => {
  const edgeStroke = theme === 'dark' ? '#7a98a6' : '#94a3b8';
  const edgeLabel = theme === 'dark' ? '#a7bcc6' : '#64748b';
  const edgeLabelBg = theme === 'dark' ? '#1a2228' : '#ffffff';
  const childrenMap = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = childrenMap.get(edge.source) || [];
    list.push(edge.target);
    childrenMap.set(edge.source, list);
  }

  const hidden = new Set<string>();
  const hideDescendants = (id: string) => {
    for (const child of childrenMap.get(id) || []) {
      if (hidden.has(child)) continue;
      hidden.add(child);
      hideDescendants(child);
    }
  };
  for (const id of collapsed) hideDescendants(id);

  const visibleNodes = graph.nodes.filter((node) => !hidden.has(node.id));
  const root = visibleNodes.find((node) => node.type === 'ROOT') || visibleNodes[0];
  const levels = new Map<string, number>();
  const queue: string[] = root ? [root.id] : [];
  if (root) levels.set(root.id, 0);

  while (queue.length) {
    const current = queue.shift()!;
    const level = levels.get(current) || 0;
    for (const child of childrenMap.get(current) || []) {
      if (hidden.has(child) || levels.has(child)) continue;
      levels.set(child, level + 1);
      queue.push(child);
    }
  }

  visibleNodes.forEach((node, index) => {
    if (!levels.has(node.id)) levels.set(node.id, Math.min(3, 1 + Math.floor(index / 4)));
  });

  const byLevel = new Map<number, GraphNodeData[]>();
  for (const node of visibleNodes) {
    const level = levels.get(node.id) || 0;
    const list = byLevel.get(level) || [];
    list.push(node);
    byLevel.set(level, list);
  }

  const isTimeline = graph.type === 'timeline';
  const nodes: Node[] = [];
  for (const [level, list] of byLevel.entries()) {
    list.forEach((node, index) => {
      const x = isTimeline ? level * 220 : index * 180 - ((list.length - 1) * 180) / 2;
      const y = isTimeline ? index * 110 : level * 130;
      nodes.push({
        id: node.id,
        type: 'concept',
        position: { x, y },
        data: {
          ...node,
          collapsed: collapsed.has(node.id),
          hasChildren: (childrenMap.get(node.id) || []).some((child) => !hidden.has(child) || collapsed.has(node.id))
        }
      });
    });
  }

  const edges: Edge[] = graph.edges
    .filter((edge) => !hidden.has(edge.source) && !hidden.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.relationship.replace(/_/g, ' '),
      type: 'smoothstep',
      animated: edge.relationship === 'leads_to' || edge.relationship === 'causes',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: { stroke: edgeStroke, strokeWidth: 1.5 },
      labelStyle: { fontSize: 9, fill: edgeLabel },
      labelBgStyle: { fill: edgeLabelBg, fillOpacity: 0.92 },
      labelBgPadding: [4, 2] as [number, number]
    }));

  return { nodes, edges, hidden };
};

function GraphCanvas({ graph, onOpenPage }: GraphCardProps) {
  const { theme } = useTheme();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<GraphNodeData | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const { fitView } = useReactFlow();
  const typeColors = paletteFor(theme);

  const { nodes, edges } = useMemo(() => layoutNodes(graph, collapsed, theme), [graph, collapsed, theme]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const flowNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onToggle: () => toggleCollapse(node.id)
        }
      })),
    [nodes, toggleCollapse]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
    return () => window.clearTimeout(timer);
  }, [fitView, graph, collapsed, fullscreen]);

  const conceptCount = graph.nodes.filter((node) => node.type === 'CONCEPT' || node.type === 'PRINCIPLE').length;
  const modeLabel = graph.type.replace(/_/g, ' ');

  const shellClass = fullscreen
    ? 'fixed inset-4 z-50 flex flex-col overflow-hidden rounded-2xl border border-ink-200 bg-surface shadow-lift'
    : 'overflow-hidden rounded-xl border border-brand-100 bg-surface';

  return (
    <div className={shellClass}>
      {fullscreen && <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setFullscreen(false)} />}
      <div className={`relative ${fullscreen ? 'z-50 flex h-full flex-col' : ''}`}>
        <div className="flex items-start justify-between gap-2 border-b border-ink-100 px-3 py-2.5">
          <div>
            <p className="font-display text-sm font-semibold text-ink-950">
              Chapter {graph.chapterNumber} — Concept Graph
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              {graph.chapterTitle} · Pages {graph.pageStart}–{graph.pageEnd} · {conceptCount} key concepts ·{' '}
              {graph.edges.length} relationships · {modeLabel}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1">
            <button
              type="button"
              onClick={() => fitView({ padding: 0.2, duration: 300 })}
              className="rounded-lg border border-ink-200 px-2 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-50"
            >
              Fit
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(new Set())}
              className="rounded-lg border border-ink-200 px-2 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-50"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setFullscreen((value) => !value)}
              className="rounded-lg border border-ink-200 px-2 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-50"
            >
              {fullscreen ? 'Exit' : 'Fullscreen'}
            </button>
          </div>
        </div>

        <div className={fullscreen ? 'min-h-0 flex-1' : 'h-[340px]'}>
          <ReactFlow
            nodes={flowNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.3}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => setSelected(node.data as unknown as GraphNodeData)}
            onPaneClick={() => setSelected(null)}
          >
            <Background gap={16} color={theme === 'dark' ? '#2a343c' : '#e4ecef'} />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(node) => typeColors[(node.data as GraphNodeData).type]?.border || '#7a98a6'}
              maskColor={theme === 'dark' ? 'rgba(0, 0, 0, 0.45)' : 'rgba(26, 34, 40, 0.08)'}
            />
          </ReactFlow>
        </div>

        {selected && (
          <div className="border-t border-ink-100 bg-surface-muted px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-700">{selected.type}</p>
            <p className="mt-0.5 text-sm font-semibold text-ink-950">{selected.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-600">{selected.description}</p>
            {!!selected.pageNumbers?.length && (
              <div className="mt-2">
                <p className="text-[11px] font-medium text-ink-500">Sources</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {selected.pageNumbers.map((page) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => onOpenPage?.(page)}
                      className="rounded-lg border border-brand-200 bg-surface px-2.5 py-1 text-[11px] font-medium text-brand-800 hover:bg-brand-50"
                    >
                      Open Page {page}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function GraphCard(props: GraphCardProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
