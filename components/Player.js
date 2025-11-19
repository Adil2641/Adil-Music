import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, Image, BackHandler, PanResponder, Animated, Linking, Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { G, Path } from 'react-native-svg';
import TrackPlayerWrapper from '../utils/trackPlayerWrapper';
import { useTheme } from '../theme';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { getAudioDownload } from '../utils/youtube';
import Slider from '@react-native-community/slider';

function formatTime(ms) {
  if (!ms || isNaN(ms)) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

export default function Player({ videoId, title, thumbnail, channel, onClose, visible, onNext, onPrev, onMinimize, keepMounted = false }) {
  const { theme } = useTheme();
  const [stage, setStage] = useState('idle'); // idle | resolving | downloading | preparing | ready | error
  const [progress, setProgress] = useState(0);
  const [localUri, setLocalUri] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(1);
  const [errorMsg, setErrorMsg] = useState('');
  const [minimized, setMinimized] = useState(false);

  const soundRef = useRef(null);
  const panY = useRef(new Animated.Value(0)).current;
  
  const downloadRef = useRef(null);
  const appState = useRef(AppState.currentState);
  
  const playingBeforeBackgroundRef = useRef(false);
  const endedRef = useRef(false);
  const [stopOnClose, setStopOnClose] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem('adil_stop_on_close');
        setStopOnClose(v === '1' || v === 'true');
      } catch (e) {}
    })();
  }, []);
  const refreshPlaybackStatus = async () => {
    try {
      if (TrackPlayerWrapper && TrackPlayerWrapper.isAvailable && TrackPlayerWrapper.isAvailable()) {
        const s = await TrackPlayerWrapper.getStatus();
        if (s) {
          setPosition((s.position || 0) * 1000);
          setDuration((s.duration || 0) * 1000);
          setIsPlaying(!!s.isPlaying);
        }
      } else if (soundRef.current && soundRef.current.getStatusAsync) {
        try {
          const st = await soundRef.current.getStatusAsync();
          if (st && st.isLoaded) {
            setPosition(st.positionMillis || 0);
            setDuration(st.durationMillis || 1);
            setIsPlaying(!!st.isPlaying);
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      console.warn('refreshPlaybackStatus failed', e);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const opts = {
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
        };
        // add platform-specific interruptionMode only when available
        try {
          if (Platform.OS === 'ios') {
            if (typeof Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX !== 'undefined') opts.interruptionModeIOS = Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX;
            else if (typeof Audio.INTERRUPTION_MODE_IOS_DUCK_OTHERS !== 'undefined') opts.interruptionModeIOS = Audio.INTERRUPTION_MODE_IOS_DUCK_OTHERS;
          } else {
            if (typeof Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX !== 'undefined') opts.interruptionModeAndroid = Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX;
            else if (typeof Audio.INTERRUPTION_MODE_ANDROID_DUCK_OTHERS !== 'undefined') opts.interruptionModeAndroid = Audio.INTERRUPTION_MODE_ANDROID_DUCK_OTHERS;
          }
        } catch (e) {
          // fall back silently if constants are missing
        }

        if (Audio && Audio.setAudioModeAsync) await Audio.setAudioModeAsync(opts);
      } catch (e) {
        console.warn('Audio.setAudioModeAsync failed', e && (e.message || e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onBack = () => { handleClose(); return true; };
    BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => BackHandler.removeEventListener('hardwareBackPress', onBack);
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
      onPanResponderMove: (_, g) => panY.setValue(g.dy),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80) Animated.timing(panY, { toValue: 300, duration: 200, useNativeDriver: true }).start(() => { panY.setValue(0); setMinimized(true); console.log('Player: swiped down -> calling onMinimize'); if (typeof onMinimize === 'function') onMinimize(); });
        else if (g.dy < -80) { setMinimized(false); Animated.timing(panY, { toValue: 0, duration: 150, useNativeDriver: true }).start(); }
        else Animated.timing(panY, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      }
    })
  ).current;

  useEffect(() => {
    let mounted = true;
    async function prepare() {
      if (!visible || !videoId) return;
      setErrorMsg(''); setProgress(0); setStage('resolving'); setLocalUri(null);
      // If we already have a prepared local file and an active sound for this video, reuse it
      try {
        const expected = FileSystem.cacheDirectory + `adil_${videoId}.mp3`;
        const f = await FileSystem.getInfoAsync(expected);
        if (f.exists && localUri && localUri === expected && soundRef.current) {
          // Reuse existing sound - don't stop/unload so timing/position stays intact
          try {
            const status = await soundRef.current.getStatusAsync();
            setPosition(status.positionMillis || 0);
            setDuration(status.durationMillis || 1);
            setIsPlaying(!!status.isPlaying);
            endedRef.current = false;
            soundRef.current.setOnPlaybackStatusUpdate((s) => {
              if (!s || !s.isLoaded) return;
              setPosition(s.positionMillis || 0);
              setDuration(s.durationMillis || 1);
              setIsPlaying(!!s.isPlaying);
              // expo-av provides didJustFinish flag when playback finishes
              if (s.didJustFinish) {
                if (!endedRef.current) {
                  endedRef.current = true;
                  if (typeof onNext === 'function') onNext();
                }
              }
            });
          } catch (e) {}
          setStage('ready');
          // notifications removed
          return;
        }
      } catch (e) {
        // ignore and fallthrough to normal prepare
      }

      // cancel any in-flight download and stop current sound to avoid overlap
      try { if (downloadRef.current && downloadRef.current.cancelAsync) { await downloadRef.current.cancelAsync(); } } catch (e) {}
      try { if (soundRef.current) { await soundRef.current.stopAsync().catch(()=>{}); await soundRef.current.unloadAsync().catch(()=>{}); soundRef.current = null; } } catch (e) {}
      try {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const info = await getAudioDownload(videoUrl).catch((e) => { throw new Error(e && e.message ? e.message : String(e)); });

        // Try to extract a remote audio URL from the info object
        let remoteUrl = null;
        const candidate = info && (info.url || info.data || info.audio || info.result || info[0]) || info;
        if (typeof candidate === 'string') remoteUrl = candidate;
        else if (candidate && candidate.url) remoteUrl = candidate.url;
        else if (candidate && candidate.downloadUrl) remoteUrl = candidate.downloadUrl;
        else if (candidate && candidate.formats && candidate.formats.length) {
          const f = candidate.formats.find((x) => x.mimeType && x.mimeType.includes('audio')) || candidate.formats[0];
          remoteUrl = f && (f.url || f.downloadUrl);
        }

        if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl)) throw new Error('No audio URL available from server');
        if (!mounted) return;

        setStage('downloading');
        const filename = `adil_${videoId}.mp3`;
        const dest = FileSystem.cacheDirectory + filename;

        try { const prev = await FileSystem.getInfoAsync(dest); if (prev.exists) await FileSystem.deleteAsync(dest); } catch (e) { }

        const download = FileSystem.createDownloadResumable(remoteUrl, dest, {}, (p) => {
          if (!mounted) return;
          const pct = p.totalBytesWritten && p.totalBytesExpectedToWrite ? Math.round((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100) : 0;
          setProgress(pct);
        });

        downloadRef.current = download;
        const res = await download.downloadAsync();
        downloadRef.current = null;
        if (!res || !res.uri) throw new Error('Download failed');
        if (!mounted) return;
        setLocalUri(res.uri);
        setStage('preparing');

        // If react-native-track-player is installed and available, use it so we get
        // proper background playback and lockscreen controls (native). Otherwise
        // fall back to the existing expo-av implementation.
            endedRef.current = false;
            if (TrackPlayerWrapper && TrackPlayerWrapper.isAvailable && TrackPlayerWrapper.isAvailable()) {
              try {
                await TrackPlayerWrapper.addAndPlay({ id: videoId, url: res.uri, title, artist: channel, artwork: thumbnail });
                // start a small poll to keep UI in sync from TrackPlayer status
                if (!mounted) return;
                setStage('ready');
                setIsPlaying(true);
                // start polling TrackPlayer for status
                if (!trackPollRef.current) {
                  trackPollRef.current = setInterval(async () => {
                    try {
                      const s = await TrackPlayerWrapper.getStatus();
                      if (!s) return;
                      // TrackPlayer returns seconds; convert to ms
                      setPosition((s.position || 0) * 1000);
                      setDuration((s.duration || 0) * 1000);
                      setIsPlaying(!!s.isPlaying);
                      // best-effort detect end of track and auto-advance
                      try {
                        const pos = (s.position || 0);
                        const dur = (s.duration || 0);
                        if (dur > 0 && pos >= dur - 0.5 && !s.isPlaying) {
                          if (!endedRef.current) {
                            endedRef.current = true;
                            if (typeof onNext === 'function') onNext();
                          }
                        }
                      } catch (ee) {}
                    } catch (e) {}
                  }, 500);
                }
              } catch (e) {
            console.warn('TrackPlayer play failed, falling back to expo-av', e);
            // fallback to expo-av if TrackPlayer fails
            if (soundRef.current) { try { await soundRef.current.unloadAsync(); } catch (er) {} soundRef.current = null; }
            const { sound } = await Audio.Sound.createAsync({ uri: res.uri }, { shouldPlay: true });
            soundRef.current = sound;
            endedRef.current = false;
            sound.setOnPlaybackStatusUpdate((s) => {
              if (!s || !s.isLoaded) return;
              setPosition(s.positionMillis || 0);
              setDuration(s.durationMillis || 1);
              setIsPlaying(!!s.isPlaying);
              if (s.didJustFinish) {
                if (!endedRef.current) {
                  endedRef.current = true;
                  if (typeof onNext === 'function') onNext();
                }
              }
            });
            setStage('ready');
            setIsPlaying(true);
            // notifications removed
          }
        } else {
          // unload previous
          if (soundRef.current) { try { await soundRef.current.unloadAsync(); } catch (e) {} soundRef.current = null; }
          const { sound } = await Audio.Sound.createAsync({ uri: res.uri }, { shouldPlay: true });
          soundRef.current = sound;
          endedRef.current = false;
          sound.setOnPlaybackStatusUpdate((s) => {
            if (!s || !s.isLoaded) return;
            setPosition(s.positionMillis || 0);
            setDuration(s.durationMillis || 1);
            setIsPlaying(!!s.isPlaying);
            if (s.didJustFinish) {
              if (!endedRef.current) {
                endedRef.current = true;
                if (typeof onNext === 'function') onNext();
              }
            }
          });

            setStage('ready');
            setIsPlaying(true);
        }
      } catch (err) {
        console.warn('Prefetch audio failed:', err && (err.message || err));
        if (mounted) { setErrorMsg(err && (err.message || String(err))); setStage('error'); }
      }
    }
    prepare();
    return () => { mounted = false; };
  }, [visible, videoId]);

  const trackPollRef = useRef(null);
  // cleanup
  useEffect(() => () => {
    if (soundRef.current) { try { soundRef.current.unloadAsync(); } catch (e) {} soundRef.current = null; }
    if (trackPollRef.current) { clearInterval(trackPollRef.current); trackPollRef.current = null; }
    // if TrackPlayer is used, do not forcibly stop it here to allow background playback
  }, []);

  // Notification response listener (handle actions like play/pause/next/prev)
  useEffect(() => {
    let sub = null;
    try {
      sub = AppState.addEventListener ? AppState.addEventListener('change', (next) => {
        // track background/foreground transitions
        if (appState.current !== next) {
          console.log('AppState change', appState.current, '->', next);
          if (next === 'background') {
            // remember if we were playing before backgrounding
            playingBeforeBackgroundRef.current = !!isPlaying;
          }
          // when returning to foreground, refresh playback status so UI reflects actual state
          if (next === 'active') {
            (async () => {
              try {
                await refreshPlaybackStatus();
                // best-effort: if we were playing before background and now stopped, try to resume
                if (playingBeforeBackgroundRef.current && !isPlaying) {
                  try {
                    if (TrackPlayerWrapper && TrackPlayerWrapper.isAvailable && TrackPlayerWrapper.isAvailable()) {
                      await TrackPlayerWrapper.play();
                      setIsPlaying(true);
                    } else if (soundRef.current && soundRef.current.playAsync) {
                      await soundRef.current.playAsync();
                      setIsPlaying(true);
                    }
                  } catch (e) {
                    console.warn('Auto-resume failed', e);
                  }
                }
              } catch (e) {}
            })();
          }
          appState.current = next;
        }
      }) : null;
    } catch (e) {}
    return () => { if (sub && sub.remove) sub.remove(); };
  }, []);

  // notifications removed: no-op placeholder kept for compatibility
  async function updateNotification() { return; }

  // Start/stop periodic notification updates to reflect current playback timing
  useEffect(() => {
    return undefined;
  }, [isPlaying]);

  // refresh notification appearance when theme changes (update color)
  useEffect(() => {
    // notifications removed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme && theme.primary]);

  const onTogglePlay = async () => {
    try {
      if (TrackPlayerWrapper && TrackPlayerWrapper.isAvailable && TrackPlayerWrapper.isAvailable()) {
        const stat = await TrackPlayerWrapper.getStatus();
        if (stat && stat.isPlaying) { await TrackPlayerWrapper.pause(); setIsPlaying(false); }
        else { await TrackPlayerWrapper.play(); setIsPlaying(true); }
      } else {
        if (!soundRef.current) return;
        const status = await soundRef.current.getStatusAsync();
        if (status.isPlaying) { await soundRef.current.pauseAsync(); setIsPlaying(false); }
        else { await soundRef.current.playAsync(); setIsPlaying(true); }
      }
    } catch (e) { console.warn('play/pause failed', e && e.message); }
  };

  const onSeek = async (value) => { if (!soundRef.current) return; try { await soundRef.current.setPositionAsync(value); setPosition(value); } catch (e) {} };

  const handleClose = async () => {
    try {
      // If configured to stop on close, stop/unload playback and dismiss notifications.
      if (stopOnClose) {
        if (TrackPlayerWrapper && TrackPlayerWrapper.isAvailable && TrackPlayerWrapper.isAvailable()) {
          try { await TrackPlayerWrapper.stop(); } catch (e) {}
          try { await TrackPlayerWrapper.destroyPlayer(); } catch (e) {}
        } else {
          if (soundRef.current) { try { await soundRef.current.stopAsync(); await soundRef.current.unloadAsync(); } catch (e) {} soundRef.current = null; }
        }
        // notifications removed: nothing to dismiss
      } else {
        // keep playback running in background: do not stop TrackPlayer or expo-av
      }
    } catch (e) {
      console.warn('handleClose cleanup failed', e);
    }
    // Keep UI state minimal; do not mark isPlaying false when preserving playback
    if (stopOnClose) setIsPlaying(false);
    setMinimized(false);
    if (typeof onClose === 'function') onClose();
  };

  // debug log for onMinimize prop call from minimize button
  useEffect(() => {
    if (typeof onMinimize === 'function') console.log('Player: onMinimize prop provided');
  }, []);

  const openInYouTube = () => { const url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : 'https://www.youtube.com'; Linking.openURL(url).catch(() => {}); };

  // If not visible and not asked to keep mounted, short-circuit render to save resources.
  if (!visible && !keepMounted) return null;

  return (
    <Modal visible={!!visible} animationType="slide" transparent={false} onRequestClose={handleClose}>
      <Animated.View style={[styles.container, { backgroundColor: theme.background, transform: [{ translateY: panY }] }]} {...panResponder.panHandlers}>
        {minimized ? (
          <View style={[styles.minibar, { backgroundColor: theme.card, borderTopColor: theme.border }]}> 
            <TouchableOpacity onPress={() => setMinimized(false)} style={styles.minLeft} accessibilityRole="button">
              <Image source={{ uri: thumbnail }} style={styles.minThumb} />
              <View style={{ marginLeft: 8, flex: 1 }}>
                <Text numberOfLines={1} style={{ color: theme.text }}>{title || 'Now Playing'}</Text>
                <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 }}>{channel}</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.minControls}>
              <TouchableOpacity onPress={onTogglePlay} style={styles.minBtn} accessibilityRole="button">
                <Svg width={22} height={22} viewBox="0 0 24 24"><Path d={isPlaying ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M8 5v14l11-7z'} fill={theme.text} /></Svg>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClose} style={styles.minBtn} accessibilityRole="button">
                <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M18 6L6 18M6 6l12 12" stroke={theme.text} strokeWidth={2} strokeLinecap="round"/></Svg>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.border }] }>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity onPress={() => { setMinimized(true); if (typeof onMinimize === 'function') onMinimize(); }} style={[styles.iconBtn, { marginRight: 8 }]} accessibilityRole="button">
                  <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M6 12h12v2H6z" fill={theme.text} /></Svg>
                </TouchableOpacity>
                <Text style={[styles.title, { color: theme.text, flex: 1 }]} numberOfLines={1}>{title || 'Now Playing'}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity onPress={openInYouTube} style={[styles.iconBtn, { marginRight: 8 }]} accessibilityRole="button">
                  <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M10 8l6 4-6 4z" fill={theme.text}/></Svg>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleClose} style={[styles.closeBtn, { backgroundColor: theme.primary }]} accessibilityLabel="Close Player" accessibilityRole="button">
                  <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" /></Svg>
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ flex: 1, padding: 20, justifyContent: 'center', alignItems: 'center' }}>
              <Image source={{ uri: thumbnail }} style={{ width: 280, height: 280, borderRadius: 12, marginBottom: 18, borderWidth: 2, borderColor: theme.primary }} />
              <Text numberOfLines={2} style={{ color: theme.text, fontSize: 20, fontWeight: '700', marginBottom: 6, textAlign: 'center' }}>{title}</Text>
              <Text numberOfLines={1} style={{ color: theme.muted, marginBottom: 12, textAlign: 'center' }}>{channel}</Text>

              <Slider
                style={{ width: '100%', height: 40 }}
                minimumValue={0}
                maximumValue={duration}
                value={position}
                minimumTrackTintColor={theme.primary}
                maximumTrackTintColor={theme.border}
                thumbTintColor={theme.primary}
                onSlidingComplete={onSeek}
                disabled={stage !== 'ready'}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
                <Text style={{ color: theme.muted, fontSize: 12 }}>{formatTime(position)}</Text>
                <Text style={{ color: theme.muted, fontSize: 12 }}>{formatTime(duration)}</Text>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 20, alignItems: 'center' }}>
                <TouchableOpacity onPress={onPrev} style={[controls.button, { backgroundColor: theme.card }]} accessibilityRole="button">
                  <Svg width={26} height={26} viewBox="0 0 24 24">
                    <G transform="translate(24,0) scale(-1,1)">
                      <Path d="M6 5v14l10-7zM18 5h2v14h-2z" fill={theme.text} />
                    </G>
                  </Svg>
                </TouchableOpacity>

                <TouchableOpacity onPress={onTogglePlay} style={[controls.play, { backgroundColor: theme.primary }]} accessibilityRole="button" disabled={stage !== 'ready'}>
                  {isPlaying ? (
                    <Svg width={36} height={36} viewBox="0 0 24 24"><Path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="#fff"/></Svg>
                  ) : (
                    <Svg width={36} height={36} viewBox="0 0 24 24"><Path d="M8 5v14l11-7z" fill="#fff"/></Svg>
                  )}
                </TouchableOpacity>

                <TouchableOpacity onPress={onNext} style={[controls.button, { backgroundColor: theme.card }]} accessibilityRole="button">
                  <Svg width={26} height={26} viewBox="0 0 24 24">
                    <Path d="M6 5v14l10-7zM18 5h2v14h-2z" fill={theme.text} />
                  </Svg>
                </TouchableOpacity>
              </View>

              {/* Loading / progress / errors */}
              <View style={{ marginTop: 18, alignItems: 'center' }}>
                {stage === 'resolving' && <Text style={{ color: theme.muted }}>Resolving audio URL...</Text>}
                {stage === 'downloading' && (
                  <View style={{ alignItems: 'center' }}>
                    <ActivityIndicator size="large" color={theme.primary} />
                    <Text style={{ color: theme.muted, marginTop: 8 }}>Downloading... {progress ? `${progress}%` : ''}</Text>
                  </View>
                )}
                {stage === 'preparing' && <Text style={{ color: theme.muted }}>Preparing playback...</Text>}
                {stage === 'ready' && <Text style={{ color: theme.muted }}>Ready</Text>}
                {stage === 'error' && (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: 'orange' }}>{errorMsg || 'Playback failed'}</Text>
                    <View style={{ flexDirection: 'row', marginTop: 8 }}>
                      <TouchableOpacity onPress={openInYouTube} style={[styles.smallBtn, { marginRight: 8 }]}>
                        <Text style={{ color: '#fff' }}>Open YouTube</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => { setStage('resolving'); setErrorMsg(''); }} style={[styles.smallBtn, { backgroundColor: theme.card }]}> 
                        <Text style={{ color: theme.text }}>Retry</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  header: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: 0 },
  title: { fontWeight: '700', fontSize: 18, color: '#e6f7ff' },
  closeBtn: { padding: 8, borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  iconBtn: { padding: 8, borderRadius: 10, backgroundColor: 'transparent' },
  minibar: { height: 72, width: '100%', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.04)', backgroundColor: 'rgba(255,255,255,0.02)' },
  minLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  minThumb: { width: 52, height: 52, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)' },
  minControls: { flexDirection: 'row', alignItems: 'center' },
  minBtn: { paddingHorizontal: 8, paddingVertical: 6, marginLeft: 8 },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
});

const controls = StyleSheet.create({
  button: { padding: 10, borderRadius: 12, minWidth: 64, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)' },
  play: { paddingVertical: 14, paddingHorizontal: 26, borderRadius: 999, alignItems: 'center', shadowColor: '#00e6ff', shadowOpacity: 0.3, shadowRadius: 12, elevation: 10 }
});