/** Normalises user-entered sites ("https://www.Netflix.com/browse") to a bare domain ("netflix.com"). */
export function normaliseDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

/** The rule matching a domain exactly or as a parent domain; "flix.com" never matches "netflix.com". */
export function findDomain(domain: string | null, rules: string[]): string | null {
  if (!domain) return null;
  return (
    rules.map(normaliseDomain).find((rule) => rule.length > 0 && (domain === rule || domain.endsWith(`.${rule}`))) ?? null
  );
}
