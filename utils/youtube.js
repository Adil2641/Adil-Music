import axios from 'axios';
import { SCRAPER_SERVER } from '../constants';

// NOTE: `yt-search` depends on Node libraries (cheerio, etc.) which are
// incompatible with React Native's Metro bundler. Instead we call a
// scraper server (SCRAPER_SERVER) that runs Node and performs searches.

// Use the local scraper server for download/info endpoints
const SCRAPER_BASE = SCRAPER_SERVER ? SCRAPER_SERVER.replace(/\/$/, '') : null;

/**
 * Search YouTube via adil-api service.
 * Expects adil-api to expose `/yt/search?q=...&max=...` which returns an array of videos.
 */
export async function searchYouTube(query, maxResults = 50) {
  if (!query) return [];
  // Prefer calling the scraper server which runs `yt-search` (or other scrapers)
  if (SCRAPER_SERVER && SCRAPER_SERVER.length) {
    try {
      const url = `${SCRAPER_SERVER.replace(/\/$/, '')}/search`;
      const resp = await axios.get(url, { params: { q: query, max: maxResults } });
      return resp.data || [];
    } catch (err) {
      console.error('SCRAPER_SERVER search failed:', err && (err.response ? (err.response.status + ' ' + JSON.stringify(err.response.data)) : (err.stack || err)));
      return [];
    }
  }

  console.error('No search provider available: configure `SCRAPER_SERVER` in constants.js to point to a Node scraper.');
  return [];

  // If a scraper server is configured, try it next
  if (SCRAPER_SERVER && SCRAPER_SERVER.length) {
    try {
      const url = `${SCRAPER_SERVER.replace(/\/$/, '')}/search`;
      const resp = await axios.get(url, { params: { q: query, max: maxResults } });
      return resp.data || [];
    } catch (err) {
      console.error('SCRAPER_SERVER search failed:', err && (err.response ? (err.response.status + ' ' + JSON.stringify(err.response.data)) : (err.stack || err)));
      return [];
    }
  }

  // Final fallback: log and return empty
  console.error('No search provider available (yt-search failed and SCRAPER_SERVER not configured).');
  return [];

  try {
    const r = await yts(query);
    const videos = r && r.videos ? r.videos : [];
    return videos.slice(0, maxResults).map((v) => ({
      id: v.videoId || v.video_id,
      title: v.title,
      thumbnail: v.thumbnail,
      channel: (v.author && v.author.name) || v.author || v.channel || '',
      duration: v.timestamp || v.duration || '',
      views: v.views || 0,
    }));
  } catch (err) {
    console.error('yt-search failed:', err && err.stack ? err.stack : err);
    return [];
  }
}

export default searchYouTube;

/**
 * Get trending videos via adil-api service.
 * Expects `/yt/trending?max=...&region=...`.
 */
export async function getTrending(maxResults = 50, regionCode = 'US') {
  // Use SCRAPER_SERVER to provide trending (server runs Node scrapers)
  if (SCRAPER_SERVER && SCRAPER_SERVER.length) {
    try {
      const url = `${SCRAPER_SERVER.replace(/\/$/, '')}/trending`;
      const resp = await axios.get(url, { params: { max: maxResults, region: regionCode } });
      return resp.data || [];
    } catch (err) {
      console.error('SCRAPER_SERVER trending failed:', err && (err.response ? (err.response.status + ' ' + JSON.stringify(err.response.data)) : (err.stack || err)));
      return [];
    }
  }

  console.error('No trending provider available: configure `SCRAPER_SERVER` in constants.js to point to a Node scraper.');
  return [];
}

// --- Helpers to use the external adil-api rendering service for info/downloads ---
// These are safe to call from the React Native app and don't require Node-only libs.

/**
 * Get video information from adil-api service.
 * @param {string} url Full YouTube URL or video id
 */
export async function getVideoInfo(url) {
  if (!url) throw new Error('url is required');
  if (!SCRAPER_BASE) throw new Error('No SCRAPER_SERVER configured');
  try {
    const resp = await axios.get(`${SCRAPER_BASE}/video-info`, { params: { url } });
    return resp.data;
  } catch (err) {
    console.warn('getVideoInfo failed:', err.message || err);
    throw err;
  }
}

/**
 * Get direct video download link (or download info) from adil-api service.
 * @param {string} url Full YouTube URL or video id
 */
export async function getVideoDownload(url) {
  if (!url) throw new Error('url is required');
  if (!SCRAPER_BASE) throw new Error('No SCRAPER_SERVER configured');
  try {
    const resp = await axios.get(`${SCRAPER_BASE}/v-dl`, { params: { url } });
    return resp.data;
  } catch (err) {
    console.warn('getVideoDownload failed:', err.message || err);
    throw err;
  }
}

/**
 * Get direct audio download link (or download info) from adil-api service.
 * @param {string} url Full YouTube URL or video id
 */
export async function getAudioDownload(url) {
  if (!url) throw new Error('url is required');
  if (!SCRAPER_BASE) throw new Error('No SCRAPER_SERVER configured');
  try {
    const resp = await axios.post(`${SCRAPER_BASE}/a-dl`, { url, quality: 320 });
    return resp.data;
  } catch (err) {
    // If the scraper server returned a JSON error payload, return it so the client
    // can inspect `details` and react (instead of always throwing). If the response
    // is plain text, wrap it into an object.
    console.warn('getAudioDownload failed:', err.message || err);
    if (err.response && err.response.data) {
      // try to return structured response when possible
      try {
        return typeof err.response.data === 'string' ? { status: false, error: err.response.statusText || 'error', details: err.response.data } : err.response.data;
      } catch (e) {
        return { status: false, error: err.message || String(err), details: err.response.data };
      }
    }
    return { status: false, error: err.message || String(err), details: null };
  }
}
