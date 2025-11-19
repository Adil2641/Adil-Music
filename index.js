// Entry file to register TrackPlayer service for native builds.
// This file is safe to include in an Expo project. TrackPlayer.registerPlaybackService
// will only run when the native module is available.

import { registerRootComponent } from 'expo';
import App from './App';

// Register the playback service if TrackPlayer is installed
try {
  // eslint-disable-next-line global-require
  const TrackPlayer = require('react-native-track-player');
  if (TrackPlayer && TrackPlayer.registerPlaybackService) {
    TrackPlayer.registerPlaybackService(() => require('./services/trackPlayerService'));
  }
} catch (e) {
  // TrackPlayer not installed — ignore
}

registerRootComponent(App);
