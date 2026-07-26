import config from '../dashboard.config.json' with { type: 'json' };
import snapshot from '../data.json' with { type: 'json' };
import { fetchDashboardData, validateDashboardData } from '../lib/dashboard-data.mjs';

function cacheHeader() {
  const { maxAgeSeconds, staleWhileRevalidateSeconds, staleIfErrorSeconds } = config.cache;
  return [
    'public',
    `s-maxage=${maxAgeSeconds}`,
    `stale-while-revalidate=${staleWhileRevalidateSeconds}`,
    `stale-if-error=${staleIfErrorSeconds}`,
  ].join(', ');
}

function jsonResponse(body, headers = {}) {
  return Response.json(body, {
    headers: {
      'Cache-Control': cacheHeader(),
      ...headers,
    },
  });
}

export async function GET() {
  try {
    const data = validateDashboardData(await fetchDashboardData(config));
    return jsonResponse({ ...data, source: 'sheet', stale: false });
  } catch (error) {
    const data = validateDashboardData(snapshot);
    return jsonResponse(
      { ...data, source: 'snapshot', stale: true },
      { 'X-Dashboard-Fallback': 'snapshot' },
    );
  }
}
