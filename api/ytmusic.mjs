import config from '../dashboard.config.json' with { type: 'json' };
import { fetchYtmusicCounts } from '../lib/ytmusic-counts.mjs';

const CACHE_HEADER = 'public, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400';

export async function GET() {
  try {
    const { counts, missing } = await fetchYtmusicCounts(config);
    return Response.json(
      {
        fetchedAt: new Date().toISOString(),
        source: 'youtube_music_album_display',
        precision: 'display_unit',
        counts,
        missing,
      },
      { headers: { 'Cache-Control': CACHE_HEADER } },
    );
  } catch (error) {
    return Response.json(
      { error: String(error && error.message ? error.message : error) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
