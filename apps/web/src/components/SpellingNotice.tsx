export type SpellingInfo = {
  original: string;
  corrected: string;
  corrections: Array<{ from: string; to: string }>;
};

/** Reads the spelling payload the API attaches to a response's meta. */
export const readSpelling = (meta?: Record<string, unknown>): SpellingInfo | null => {
  const spelling = meta?.spelling as SpellingInfo | undefined;
  if (!spelling?.corrected || !spelling.original) return null;
  if (spelling.corrected === spelling.original) return null;
  return { ...spelling, corrections: spelling.corrections ?? [] };
};

export default function SpellingNotice({ spelling }: { spelling: SpellingInfo }) {
  return (
    <div className="panel-warn mb-3 rounded-xl px-3 py-2">
      <p className="text-xs">
        Showing results for <span className="font-semibold">{spelling.corrected}</span>
      </p>
      {spelling.corrections.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] opacity-90">
          <span>Corrected spelling:</span>
          {spelling.corrections.map((correction) => (
            <span key={`${correction.from}-${correction.to}`} className="whitespace-nowrap">
              <span className="line-through opacity-70">{correction.from}</span>
              <span aria-hidden="true"> → </span>
              <span className="font-semibold">{correction.to}</span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
