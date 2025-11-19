// Lightweight wrapper that *tries* to use react-native-track-player if installed.
// If not available, methods are no-ops and `isAvailable()` returns false.

let TrackPlayer = null;
let available = false;
try {
  // dynamic require to avoid crash when the native module is not installed
  // eslint-disable-next-line global-require
  TrackPlayer = require('react-native-track-player');
  available = !!TrackPlayer;
} catch (e) {
  available = false;
}

let initialized = false;

async function init() {
  if (!available) return false;
  if (initialized) return true;
  try {
    await TrackPlayer.setupPlayer();
    await TrackPlayer.updateOptions({
      stopWithApp: false,
      capabilities: [TrackPlayer.CAPABILITY_PLAY, TrackPlayer.CAPABILITY_PAUSE, TrackPlayer.CAPABILITY_SKIP_TO_NEXT, TrackPlayer.CAPABILITY_SKIP_TO_PREVIOUS, TrackPlayer.CAPABILITY_STOP],
      compactCapabilities: [TrackPlayer.CAPABILITY_PLAY, TrackPlayer.CAPABILITY_PAUSE]
    });
    initialized = true;
    return true;
  } catch (e) {
    console.warn('TrackPlayer init failed', e);
    return false;
  }
}

async function addAndPlay(track) {
  if (!available) throw new Error('TrackPlayer not available');
  await init();
  try {
    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: track.id || `${Date.now()}`,
      url: track.url,
      title: track.title || 'Unknown',
      artist: track.artist || '',
      artwork: track.artwork || undefined,
      duration: track.duration || undefined,
    });
    await TrackPlayer.play();
  } catch (e) {
    console.warn('TrackPlayer addAndPlay failed', e);
    throw e;
  }
}

async function updateMetadata(meta) {
  if (!available) return;
  try {
    // meta: { title, artist, artwork, duration }
    await TrackPlayer.updateMetadataForTrack(meta.id || 'current', {
      title: meta.title,
      artist: meta.artist,
      artwork: meta.artwork,
      duration: meta.duration,
    });
  } catch (e) {
    // some versions do not support updateMetadataForTrack
    try { await TrackPlayer.updateOptions({}); } catch (er) {}
  }
}

async function setNotificationProgress(position, duration) {
  if (!available) return;
  try {
    // TrackPlayer provides updateProgress if needed via events; we can set position via seek
    // But to show progress in notification, TrackPlayer handles it automatically when playing.
    // Keep function for compatibility
    return;
  } catch (e) { /* ignore */ }
}

async function destroyPlayer() {
  if (!available) return;
  try { await TrackPlayer.destroy(); initialized = false; } catch (e) { /* ignore */ }
}

async function play() { if (!available) return; try { await TrackPlayer.play(); } catch (e) { console.warn(e); } }
async function pause() { if (!available) return; try { await TrackPlayer.pause(); } catch (e) { console.warn(e); } }
async function stop() { if (!available) return; try { await TrackPlayer.stop(); } catch (e) { console.warn(e); } }
async function skipToNext() { if (!available) return; try { await TrackPlayer.skipToNext(); } catch (e) { console.warn(e); } }
async function skipToPrevious() { if (!available) return; try { await TrackPlayer.skipToPrevious(); } catch (e) { console.warn(e); } }

async function getStatus() {
  if (!available) return { position: 0, duration: 0, isPlaying: false };
  try {
    const position = await TrackPlayer.getPosition();
    const duration = await TrackPlayer.getDuration();
    const state = await TrackPlayer.getState();
    const isPlaying = state === TrackPlayer.STATE_PLAYING;
    return { position, duration, isPlaying };
  } catch (e) {
    return { position: 0, duration: 0, isPlaying: false };
  }
}

module.exports = {
  isAvailable: () => available,
  init,
  addAndPlay,
  play,
  pause,
  stop,
  skipToNext,
  skipToPrevious,
  getStatus,
  updateMetadata,
  setNotificationProgress,
  destroyPlayer,
};
