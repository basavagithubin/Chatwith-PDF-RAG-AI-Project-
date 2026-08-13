/** Document-agnostic domain aliases used by keyword retrieval (not model weights). */

export type SynonymRule = { match: RegExp; terms: string[] };

export const DOMAIN_SYNONYMS: SynonymRule[] = [
  { match: /\b(kund|kunda|kuṇḍa|kundaḥ)\b/i, terms: ['kund', 'kunda', 'kuṇḍa', 'radha-kunda', 'rādhā-kuṇḍa'] },
  { match: /\b(radha|rādhā|radhika)\b/i, terms: ['radha', 'rādhā', 'radha-kunda', 'rādhā-kuṇḍa'] },
  { match: /\b(govardhan|govardhana|giriraj|girirāja)\b/i, terms: ['govardhan', 'govardhana', 'govardhana hill'] },
  { match: /\b(vaco|vāk|vak|speech|urge)\b/i, terms: ['vaco', 'vāk', 'speech', 'urge', 'vegam', 'vega'] },
  { match: /\b(yama|yamaloka|yama loka)\b/i, terms: ['yama', 'yamaloka', 'yama loka', 'abode of yama', 'city of yama'] },
  { match: /\b(purusha|puruṣa|purusa)\b/i, terms: ['purusha', 'puruṣa', 'purusa', 'sukta', 'hymn'] },
  { match: /\b(sloka|śloka|shlok|verse|mantra)\b/i, terms: ['sloka', 'śloka', 'verse', 'mantra'] },
  { match: /\b(pond|lake|bath|bathe)\b/i, terms: ['pond', 'kunda', 'kuṇḍa', 'bathe'] }
];

export const expandDomainTerms = (query: string, limit = 12): string[] => {
  const extras: string[] = [];
  for (const rule of DOMAIN_SYNONYMS) {
    if (rule.match.test(query)) extras.push(...rule.terms);
  }
  return Array.from(new Set(extras)).slice(0, limit);
};
