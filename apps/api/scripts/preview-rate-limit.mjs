/**
 * Multi-user rate-limit preview.
 * Usage: node apps/api/scripts/preview-rate-limit.mjs
 */
const API = process.env.API_BASE_URL || 'http://127.0.0.1:5000';
const DOC = process.env.EVAL_DOCUMENT_ID || '193bc6fd-3032-4b34-9bf4-59ff6c595c66';
const USERS = ['alice', 'bob', 'carol'];
const ATTEMPTS = Number(process.env.PREVIEW_ATTEMPTS || 25);

const hitSearch = async (user, n) => {
  const started = Date.now();
  const res = await fetch(`${API}/api/documents/${DOC}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': `preview-${user}`
    },
    body: JSON.stringify({ query: `ping ${n}` })
  });
  const body = await res.json().catch(() => ({}));
  return {
    user,
    n,
    status: res.status,
    limited: res.status === 429,
    remaining: res.headers.get('X-RateLimit-Remaining'),
    limit: res.headers.get('X-RateLimit-Limit'),
    retryAfter: body.retryAfter ?? res.headers.get('Retry-After'),
    ms: Date.now() - started,
    message: body.message || body.answer?.slice?.(0, 40) || body.error
  };
};

const status = await fetch(`${API}/api/rate-limit/status`, {
  headers: { 'X-Client-Id': 'preview-alice' }
}).then((r) => r.json());

console.log('Config:', JSON.stringify(status, null, 2));

const rows = [];
for (let n = 1; n <= ATTEMPTS; n += 1) {
  for (const user of USERS) {
    rows.push(await hitSearch(user, n));
  }
}

const summary = USERS.map((user) => {
  const mine = rows.filter((r) => r.user === user);
  return {
    user,
    ok: mine.filter((r) => !r.limited).length,
    blocked: mine.filter((r) => r.limited).length,
    firstBlockAt: mine.find((r) => r.limited)?.n ?? null,
    limitHeader: mine.find((r) => r.limit)?.limit ?? null
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  config: status,
  attemptsPerUser: ATTEMPTS,
  summary,
  sampleBlocked: rows.filter((r) => r.limited).slice(0, 6),
  sampleAllowed: rows.filter((r) => !r.limited).slice(0, 3)
};

console.log('\n=== Per-user summary ===');
console.table(summary);
console.log('\nIsolation check: each user should hit the limit independently.');
console.log(JSON.stringify(report, null, 2));
