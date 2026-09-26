/**
 * Convert a crop URL from the API to a full URL that the browser can load.
 * API returns: /api/crops/person_1/2026-08-26.jpg
 * Browser needs: http://localhost:8000/api/crops/person_1/2026-08-26.jpg
 */
export function cropUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  // Support URLs returned by older API responses.
  path = path.replace('/api/data/crops/', '/api/crops/');
  const token = localStorage.getItem('token');
  const url = new URL(path, 'http://localhost:8000');

  // Browser image requests cannot send Axios' Authorization header.
  if (url.origin === 'http://localhost:8000' && token) {
    url.searchParams.set('token', token);
  }

  return url.toString();
}
