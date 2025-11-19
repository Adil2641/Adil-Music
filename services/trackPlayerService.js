// Example service for react-native-track-player.
// This file should be registered per the track-player docs and will run in the background.
// See README additions for install and registration instructions.

module.exports = async function() {
  const TrackPlayer = require('react-native-track-player');

  TrackPlayer.addEventListener('remote-play', () => TrackPlayer.play());
  TrackPlayer.addEventListener('remote-pause', () => TrackPlayer.pause());
  TrackPlayer.addEventListener('remote-stop', () => TrackPlayer.destroy());
  TrackPlayer.addEventListener('remote-next', async () => {
    try { await TrackPlayer.skipToNext(); } catch (e) {}
  });
  TrackPlayer.addEventListener('remote-previous', async () => {
    try { await TrackPlayer.skipToPrevious(); } catch (e) {}
  });

  // You can also handle remote-duck, remote-seek, etc. as needed.
};