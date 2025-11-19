// Small Express server to run YouTube scrapers in Node (not in React Native)
const express = require('express');
const cors = require('cors');
const yts = require('yt-search');
let yscraper = null;
try { yscraper = require('@vreden/youtube_scraper'); } catch (e) { /* optional */ }
const axios = require('axios');
// const ytdl = require('ytdl-core'); // No longer needed
const { YT_API_KEY } = require('./constants');

const app = express();
app.use(cors());
app.use(express.json()); // <-- Add this to parse JSON bodies
const path = require('path');
const fs = require('fs');
// simple request logger
app.use((req, res, next) => {
  console.log(`[scraper] ${req.method} ${req.url} - params: ${JSON.stringify(req.query || {})}`);
  next();
});

// Updated /search endpoint to use yt-search

app.get('/search', async (req, res) => {
  const q = req.query.q || '';
  const max = Math.min(parseInt(req.query.max || '50', 10), 50);
  if (!q) return res.json([]);

  try {
    const r = await yts(q);
    const videos = r && r.videos ? r.videos : [];
    return res.json(videos.slice(0, max).map((v) => ({
      id: v.videoId || v.video_id,
      title: v.title,
      thumbnail: v.thumbnail,
      channel: (v.author && v.author.name) || v.author || v.channel || '',
      duration: v.timestamp || v.duration || '',
      views: v.views || 0,
    })));
  } catch (err) {
    console.warn('yt-search failed on server:', err && (err.stack || err));
    return res.status(500).json({ error: 'yt-search failed', details: err.message || String(err) });
  }
});

app.get('/trending', async (req, res) => {
  const max = Math.min(parseInt(req.query.max || '50', 10), 50);
  const region = req.query.region || 'US';
  try {
    if (yts) {
      // some versions of yt-search expose a trending() helper; others can be queried
      let r = null;
      if (typeof yts.trending === 'function') {
        r = await yts.trending();
      } else {
        // fallback: perform a query that approximates trending music
        r = await yts('trending music');
      }
      const videos = (r && (r.videos || r.items)) || [];
      return res.json(videos.slice(0, max).map((v) => ({
        id: v.videoId || v.video_id,
        title: v.title,
        thumbnail: v.thumbnail,
        channel: (v.author && v.author.name) || v.author || v.channel || '',
        duration: v.timestamp || v.duration || '',
        views: v.views || 0,
      })));
    }
  } catch (err) {
    console.warn('yt-search trending failed on server:', err && (err.stack || err));
    return res.status(500).json({ error: 'yt-search trending failed', details: err.message || String(err) });
  }

  if (yscraper) {
    try {
      const r = await yscraper.trending({ limit: max, region });
      const items = r && (r.items || r.videos) ? (r.items || r.videos) : [];
      return res.json(items.slice(0, max).map((v) => ({
        id: v.id || v.videoId || v.video_id,
        title: v.title,
        thumbnail: v.thumbnail || (v.thumbnails && v.thumbnails[0] && v.thumbnails[0].url),
        channel: v.channel || v.author || (v.owner && v.owner.name) || '',
        duration: v.duration || v.timestamp || '',
        views: v.views || 0,
      })));
    } catch (err) {
      console.warn('youtube_scraper trending failed on server:', err && (err.stack || err));
      return res.status(500).json({ error: 'youtube_scraper trending failed', details: err.message || String(err) });
    }
  }

  if (!YT_API_KEY || YT_API_KEY === 'YOUR_API_KEY_HERE') {
    return res.status(400).json({ error: 'No scrapers available and no YT API key set on server.' });
  }

  try {
    const params = {
      part: 'snippet,contentDetails,statistics',
      chart: 'mostPopular',
      regionCode: region,
      maxResults: max,
      key: YT_API_KEY,
    };
    const resp = await axios.get('https://www.googleapis.com/youtube/v3/videos', { params });
    const items = resp.data.items || [];
    return res.json(items.map((it) => ({
      id: it.id,
      title: it.snippet.title,
      thumbnail: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
      channel: it.snippet.channelTitle,
      duration: it.contentDetails?.duration || '',
      views: it.statistics?.viewCount ? Number(it.statistics.viewCount) : 0,
    })));
  } catch (err) {
    console.error('YouTube API trending error on server:', err && (err.stack || err));
    return res.status(500).json({ error: 'YouTube API trending error', details: err.message || String(err) });
  }
});

// Return audio download URL or audio info for a given video id or url
app.post('/a-dl', async (req, res) => {
  const { url, quality } = req.body || {};
  if (!url) {
    return res.status(400).json({ status: false, error: 'YouTube URL is required' });
  }
  // Retry helper (exponential backoff)
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function withRetries(fn, attempts = 3, baseDelay = 300) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const delay = baseDelay * Math.pow(2, i);
        console.warn(`[scraper] attempt ${i + 1}/${attempts} failed: ${e && (e.message || e)}; retrying in ${delay}ms`);
        if (i < attempts - 1) await wait(delay);
      }
    }
    throw lastErr;
  }

  // Try from high to low quality
  const qualities = [320, 256, 128, 92];
  const tryQualities = quality ? [quality, ...qualities.filter((q) => q !== quality)] : qualities;
  const axios = require('axios');
  const providerEndpoints = [
    // Add more endpoints as needed
    (url, q) => yscraper && typeof yscraper.ytmp3 === 'function' ? yscraper.ytmp3(url, q) : null,
    (url, q) => yscraper && typeof yscraper.apimp3 === 'function' ? yscraper.apimp3(url, q) : null,
    async (url, q) => {
      // Direct HTTP fallback to api.vreden.my.id
      try {
        const resp = await axios.get(`https://api.vreden.my.id/api/v1/download/youtube/audio`, { params: { url, quality: q }, timeout: 8000 });
        if (resp.data && resp.data.status && resp.data.download && resp.data.download.url) {
          return resp.data;
        }
        throw new Error('Invalid response from api.vreden.my.id');
      } catch (e) {
        throw Object.assign(e, { provider: 'api.vreden.my.id' });
      }
    },
    async (url, q) => {
      // Direct HTTP fallback to cdn403.savetube.vip
      try {
        const resp = await axios.post(`https://cdn403.savetube.vip/v2/info`, { url }, { timeout: 8000 });
        if (resp.data && resp.data.status && resp.data.download && resp.data.download.url) {
          return resp.data;
        }
        throw new Error('Invalid response from cdn403.savetube.vip');
      } catch (e) {
        throw Object.assign(e, { provider: 'cdn403.savetube.vip' });
      }
    },
  ];

  let lastError = null;
  const errorDetails = [];
  for (const q of tryQualities) {
    for (const providerFn of providerEndpoints) {
      try {
        let result = await withRetries(() => providerFn(url, q), 2, 400);
        if (result && result.status && result.download && result.download.url) {
          return res.json({
            status: true,
            url: result.download.url,
            filename: result.download.filename,
            metadata: result.metadata,
            quality: q,
            provider: result.provider || providerFn.name || 'unknown',
          });
        }
      } catch (err) {
        lastError = err;
        errorDetails.push({
          provider: err.provider || providerFn.name || 'unknown',
          status: err.response?.status,
          data: err.response?.data || err.message,
        });
        if (err && err.response) {
          console.warn('[scraper] provider response error', err.provider || providerFn.name, err.response.status, err.response.data);
        } else {
          console.warn('[scraper] a-dl error', err.provider || providerFn.name, err && (err.stack || err));
        }
      }
    }
  }

  // All attempts exhausted
  const details = errorDetails.length ? errorDetails : (lastError && (lastError.response?.data || lastError.message)) || 'unknown error';
  return res.status(500).json({ status: false, error: 'Audio download failed for all providers/qualities.', details });
});

// Basic video info endpoint
app.get('/video-info', async (req, res) => {
  const url = req.query.url || null;
  if (!url) return res.status(400).json({ error: 'url required' });
  if (yscraper) {
    try {
      let info = null;
      if (typeof yscraper.video === 'function') info = await yscraper.video(url);
      else if (typeof yscraper.getVideo === 'function') info = await yscraper.getVideo(url);
      else if (typeof yscraper.info === 'function') info = await yscraper.info(url);
      if (info) return res.json({ info });
    } catch (e) { console.warn('yscraper video-info failed', e && e.message); }
  }
  try {
    const info = await ytdl.getInfo(url);
    return res.json({ info: info.videoDetails || info });
  } catch (err) {
    return res.status(500).json({ error: 'video-info failed', details: err.message || String(err) });
  }
});

// Video download endpoint (returns formats/info)
app.get('/v-dl', async (req, res) => {
  const url = req.query.url || null;
  if (!url) return res.status(400).json({ error: 'url required' });
  if (yscraper) {
    try {
      let info = null;
      if (typeof yscraper.video === 'function') info = await yscraper.video(url);
      else if (typeof yscraper.getVideo === 'function') info = await yscraper.getVideo(url);
      else if (typeof yscraper.get === 'function') info = await yscraper.get(url);
      if (info) return res.json(info);
    } catch (e) { console.warn('yscraper v-dl failed', e && e.message); }
  }
  try {
    const info = await ytdl.getInfo(url);
    return res.json(info);
  } catch (err) {
    return res.status(500).json({ error: 'v-dl failed', details: err.message || String(err) });
  }
});

const port = process.env.PORT || 4000;
// APK download endpoint: either redirect to a configured public URL or serve a local APK file
app.get('/download-apk', async (req, res) => {
  try {
    const apkUrl = process.env.APK_DOWNLOAD_URL;
    if (apkUrl && /^https?:\/\//i.test(apkUrl)) {
      // redirect clients to the hosted APK (keeps server and APK separate)
      return res.redirect(apkUrl);
    }

    const localApk = path.join(__dirname, 'apks', 'app-release.apk');
    if (fs.existsSync(localApk)) {
      return res.download(localApk, 'AdilMusic.apk');
    }

    return res.status(404).json({ error: 'APK not available', message: 'Set APK_DOWNLOAD_URL or upload an APK to ./apks/app-release.apk' });
  } catch (e) {
    console.error('download-apk error', e);
    return res.status(500).json({ error: 'internal' });
  }
});
app.listen(port, () => console.log(`YouTube scraper server running on http://localhost:${port} (APK endpoint: /download-apk)`));
