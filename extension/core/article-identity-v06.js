function norm(value) {
  return String(value || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(value) {
  return new Set(norm(value).split(' ').filter((item) => item.length >= 2));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let same = 0;
  for (const item of a) if (b.has(item)) same += 1;
  return same / (a.size + b.size - same);
}

function titleCore(value) {
  return norm(value)
    .replace(/\b(?:page|part|p)\s*\d+\b/g, ' ')
    .replace(/(?:第\s*\d+\s*页|第\s*\d+\s*章)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameCanonical(a, b) {
  const left = a?.source?.canonicalUrl || '';
  const right = b?.source?.canonicalUrl || '';
  return Boolean(left && right && left === right);
}

function leadingText(doc, limit = 1200) {
  let out = '';
  for (const block of doc?.blocks || []) {
    if (!['paragraph', 'heading', 'blockquote', 'list'].includes(block.type)) continue;
    const value = block.type === 'list' ? (block.items || []).join(' ') : block.text;
    out += ` ${value || ''}`;
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

export function articleIdentityEvidence(first, candidate) {
  const firstTitle = titleCore(first?.metadata?.title);
  const nextTitle = titleCore(candidate?.metadata?.title);
  const titleSimilarity = jaccard(tokens(firstTitle), tokens(nextTitle));
  const bodySimilarity = jaccard(tokens(leadingText(first)), tokens(leadingText(candidate)));
  const canonicalMatch = sameCanonical(first, candidate);
  const authorMatch = Boolean(first?.metadata?.author && candidate?.metadata?.author
    && norm(first.metadata.author) === norm(candidate.metadata.author));

  let score = 0;
  if (canonicalMatch) score += 5;
  if (titleSimilarity >= 0.8) score += 4;
  else if (titleSimilarity >= 0.45) score += 2;
  if (authorMatch) score += 1;
  // A multipage continuation often has little body overlap, while a duplicate
  // page has lots. Body overlap is supporting evidence, not a hard requirement.
  if (bodySimilarity >= 0.08) score += 1;

  return {
    sameArticle: canonicalMatch || score >= 3,
    score,
    canonicalMatch,
    titleSimilarity,
    bodySimilarity,
    authorMatch,
  };
}

export function assertSameArticle(first, candidate) {
  const evidence = articleIdentityEvidence(first, candidate);
  if (!evidence.sameArticle) {
    const error = new Error(`Pagination candidate failed article identity check (score=${evidence.score}, title=${evidence.titleSimilarity.toFixed(2)})`);
    error.code = 'PAGINATION_ARTICLE_IDENTITY_MISMATCH';
    error.evidence = evidence;
    throw error;
  }
  return evidence;
}
