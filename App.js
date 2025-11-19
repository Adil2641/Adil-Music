import React, { useState, useEffect } from 'react';
import { Platform, Alert, TextInput, KeyboardAvoidingView, Modal, RefreshControl } from 'react-native';
import { SafeAreaView, View, Text, FlatList, Image, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SearchBar from './components/SearchBar';
import Player from './components/Player';
import { searchYouTube, getTrending, getAudioDownload } from './utils/youtube';
import { ThemeProvider, useTheme, themes } from './theme';
import * as FileSystem from 'expo-file-system';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import Telemetry from './utils/telemetry';
import TrackPlayerWrapper from './utils/trackPlayerWrapper';

function AppInner() {
  const { theme, toggle, setTheme } = useTheme();
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchHistory, setSearchHistory] = useState([]);
  const searchIdRef = React.useRef(0);

  const deleteSearchHistoryItem = async (value) => {
    try {
      const raw = await AsyncStorage.getItem('adil_search_history');
      const list = raw ? JSON.parse(raw) : [];
      const target = (value || '').trim().toLowerCase();
      const next = list.filter((x) => ((x || '').trim().toLowerCase() !== target));
      await AsyncStorage.setItem('adil_search_history', JSON.stringify(next));
      setSearchHistory(next);
    } catch (e) {
      console.warn('deleteSearchHistoryItem failed', e);
    }
  };

  const clearAllSearchHistory = async () => {
    try {
      await AsyncStorage.removeItem('adil_search_history');
      setSearchHistory([]);
    } catch (e) { console.warn('clearAllSearchHistory failed', e); }
  };
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [screen, setScreen] = useState('home'); // 'home' or 'downloads'
  const [downloadDir, setDownloadDir] = useState(FileSystem.documentDirectory + 'AdilMusicDownloads/');
  const [downloadFiles, setDownloadFiles] = useState([]);
  const [storageMode, setStorageMode] = useState('app'); // 'app' or 'external'
  // show trending on main page initially
  useEffect(() => {
    // notifications removed: no permission requests or handlers
    let mounted = true;
    // install a global error handler so uncaught errors are logged clearly
    try {
      // ErrorUtils is available in React Native environment
      if (global && typeof global.ErrorUtils !== 'undefined') {
        const previousHandler = global.ErrorUtils.getGlobalHandler && global.ErrorUtils.getGlobalHandler();
        global.ErrorUtils.setGlobalHandler((error, isFatal) => {
          console.error('Global JS Error:', error && (error.stack || error));
          if (previousHandler) previousHandler(error, isFatal);
        });
      }
    } catch (e) {
      console.error('Failed to set global error handler', e && e.stack ? e.stack : e);
    }

    (async () => {
      try {
        const t = await getTrending(30);
        if (mounted && t && t.length) setResults(t);
      } catch (err) {
        console.error('Trending load failed:', err && (err.stack || err));
      }
    })();

    // Try initialize TrackPlayer if available (this will be a no-op when the
    // native module is not installed). This prepares native background playback
    // and lockscreen controls once you install the dependency and run a native build.
    (async () => {
      try {
        if (TrackPlayerWrapper && TrackPlayerWrapper.isAvailable && TrackPlayerWrapper.isAvailable()) {
          await TrackPlayerWrapper.init();
        }
      } catch (e) {
        console.warn('TrackPlayer init failed (safe to ignore in Expo Go)', e);
      }
    })();
    return () => { mounted = false; };
  }, []);
  const [currentTrack, setCurrentTrack] = useState(null); // { id, title, thumbnail, channel }
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [prefetchedAudioUrl, setPrefetchedAudioUrl] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [playlists, setPlaylists] = useState([]);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [selectedForPlaylist, setSelectedForPlaylist] = useState(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [refreshingResults, setRefreshingResults] = useState(false);
  const [refreshingPlaylists, setRefreshingPlaylists] = useState(false);
  const [refreshingDownloads, setRefreshingDownloads] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [stopOnClose, setStopOnClose] = useState(false);
  const [updateUrl, setUpdateUrl] = useState('');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const localVersion = (() => {
    try { const pj = require('./package.json'); return pj.version || '0.0.0'; } catch (e) { return '0.0.0'; }
  })();

  const onSearch = async (q) => {
    setQuery(q);
    const cleaned = (q || '').trim();
    // do not clear results immediately when user erases, let UI handle it via refresh
    if (!cleaned) {
      setResults([]);
      return;
    }

    // add to history (most-recent, no dups)
    try {
      const raw = await AsyncStorage.getItem('adil_search_history');
      const list = raw ? JSON.parse(raw) : [];
      const next = [cleaned, ...list.filter((x) => x !== cleaned)].slice(0, 50);
      await AsyncStorage.setItem('adil_search_history', JSON.stringify(next));
      setSearchHistory(next);
    } catch (e) { /* ignore */ }

    const thisId = ++searchIdRef.current;
    try {
      const res = await searchYouTube(cleaned, 30);
      // only apply results for latest request
      if (thisId === searchIdRef.current) setResults(res || []);
    } catch (err) {
      if (thisId === searchIdRef.current) console.error('Search failed:', err && (err.stack || err));
    }
  };

  const goHome = async () => {
    setScreen('home');
    setSearchFocused(false);
    setQuery('');
    try {
      const t = await getTrending(30);
      setResults(t || []);
    } catch (e) {
      console.warn('goHome trending load failed', e);
      setResults([]);
    }
  };

  const onSelectTrack = (item) => {
    // open player immediately with UI, set index, prefetch audio in background
    const idx = results.findIndex((r) => r.id === item.id);
    setCurrentIndex(idx);
    setCurrentTrack(item);
    setFullPlayerOpen(true);
    setIsPlaying(true);
    setPrefetchedAudioUrl(null);
    (async () => {
      try {
        const videoUrl = `https://www.youtube.com/watch?v=${item.id}`;
        const info = await getAudioDownload(videoUrl);
        const candidate = (info && (info.url || info.data || info.audio || info.result || info[0])) || info;
        let url = null;
        if (typeof candidate === 'string') url = candidate;
        else if (candidate && candidate.url) url = candidate.url;
        else if (candidate && candidate.downloadUrl) url = candidate.downloadUrl;
        if (!url && candidate && candidate.formats && candidate.formats.length) {
          const f = candidate.formats.find((x) => x.mimeType && x.mimeType.includes('audio')) || candidate.formats[0];
          url = f && (f.url || f.downloadUrl || f.signatureCipher);
        }
        if (url && /^https?:\/\//i.test(url)) {
          setPrefetchedAudioUrl(url);
        } else {
          console.error('Prefetch: invalid audio url', url, info);
          setPrefetchedAudioUrl(null);
        }
      } catch (err) {
        console.error('Prefetch audio failed:', err && (err.stack || err));
        setPrefetchedAudioUrl(null);
      }
    })();
  };

  const onNext = () => {
    if (!results || results.length === 0) return;
    const next = Math.min(currentIndex + 1, results.length - 1);
    const item = results[next];
    if (item) {
      setCurrentIndex(next);
      setCurrentTrack(item);
      setPrefetchedAudioUrl(null);
      // prefetch audio
      (async () => {
        try {
          const videoUrl = `https://www.youtube.com/watch?v=${item.id}`;
          const info = await getAudioDownload(videoUrl);
          const candidate = (info && (info.url || info.data || info.audio || info.result || info[0])) || info;
          let url = null;
          if (typeof candidate === 'string') url = candidate;
          else if (candidate && candidate.url) url = candidate.url;
          else if (candidate && candidate.downloadUrl) url = candidate.downloadUrl;
          if (!url && candidate && candidate.formats && candidate.formats.length) {
            const f = candidate.formats.find((x) => x.mimeType && x.mimeType.includes('audio')) || candidate.formats[0];
            url = f && (f.url || f.downloadUrl || f.signatureCipher);
          }
          if (url && /^https?:\/\//i.test(url)) setPrefetchedAudioUrl(url);
        } catch (e) { console.warn('prefetch next failed', e); }
      })();
    }
  };

  const onPrev = () => {
    if (!results || results.length === 0) return;
    const prev = Math.max(currentIndex - 1, 0);
    const item = results[prev];
    if (item) {
      setCurrentIndex(prev);
      setCurrentTrack(item);
      setPrefetchedAudioUrl(null);
      (async () => {
        try {
          const videoUrl = `https://www.youtube.com/watch?v=${item.id}`;
          const info = await getAudioDownload(videoUrl);
          const candidate = (info && (info.url || info.data || info.audio || info.result || info[0])) || info;
          let url = null;
          if (typeof candidate === 'string') url = candidate;
          else if (candidate && candidate.url) url = candidate.url;
          else if (candidate && candidate.downloadUrl) url = candidate.downloadUrl;
          if (!url && candidate && candidate.formats && candidate.formats.length) {
            const f = candidate.formats.find((x) => x.mimeType && x.mimeType.includes('audio')) || candidate.formats[0];
            url = f && (f.url || f.downloadUrl || f.signatureCipher);
          }
          if (url && /^https?:\/\//i.test(url)) setPrefetchedAudioUrl(url);
        } catch (e) { console.warn('prefetch prev failed', e); }
      })();
    }
  };

  // Downloads utilities
  useEffect(() => {
    // ensure download directory exists
    (async () => {
      try {
        // load saved storage preferences
        try {
          const sm = await AsyncStorage.getItem('adil_storage_mode');
          if (sm) setStorageMode(sm);
          const savedDir = await AsyncStorage.getItem('adil_download_dir');
          if (savedDir) setDownloadDir(savedDir);
        } catch (e) {}

        const dir = getResolvedDownloadDir();
        if (!(await FileSystem.getInfoAsync(dir)).exists) {
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        }
        await refreshDownloads();
      } catch (e) {
        console.warn('Failed to prepare download dir', e && e.message ? e.message : e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getResolvedDownloadDir = () => {
    if (storageMode === 'app') {
      return FileSystem.documentDirectory + 'AdilMusicDownloads/';
    }
    // external: use downloadDir as provided by user (e.g., '/storage/emulated/0/Download/AdilMusic')
    return downloadDir;
  };

  // Playlists persistence
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('adil_playlists');
        if (raw) setPlaylists(JSON.parse(raw));
      } catch (e) { console.warn('Failed to load playlists', e); }
    })();
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('adil_search_history');
        if (raw) setSearchHistory(JSON.parse(raw));
      } catch (e) { /* ignore */ }
    })();
    (async () => {
      try {
        const u = await AsyncStorage.getItem('adil_update_url');
        if (u) setUpdateUrl(u);
      } catch (e) {}
    })();
    (async () => {
      try {
        const s = await AsyncStorage.getItem('adil_stop_on_close');
        setStopOnClose(s === '1' || s === 'true');
      } catch (e) {}
    })();
  }, []);

  const onRefreshResults = async () => {
    setRefreshingResults(true);
    try {
      if (!query || query.trim() === '') {
        const t = await getTrending(30);
        if (t && t.length) setResults(t);
      } else {
        const res = await searchYouTube(query, 30);
        setResults(res || []);
      }
    } catch (e) {
      console.warn('Refresh results failed', e);
    } finally {
      setRefreshingResults(false);
    }
  };

  const onRefreshPlaylists = async () => {
    setRefreshingPlaylists(true);
    try {
      const raw = await AsyncStorage.getItem('adil_playlists');
      if (raw) setPlaylists(JSON.parse(raw));
    } catch (e) { console.warn('Refresh playlists failed', e); }
    setRefreshingPlaylists(false);
  };

  const onRefreshDownloads = async () => {
    setRefreshingDownloads(true);
    try {
      await refreshDownloads();
    } catch (e) { console.warn('Refresh downloads failed', e); }
    setRefreshingDownloads(false);
  };

  const savePlaylists = async (items) => {
    try {
      await AsyncStorage.setItem('adil_playlists', JSON.stringify(items));
      setPlaylists(items);
    } catch (e) { console.warn('Failed to save playlists', e); }
  };

  const createPlaylist = async (name) => {
    if (!name || !name.trim()) return;
    const p = { id: `pl_${Date.now()}`, name: name.trim(), tracks: [] };
    const next = [p, ...playlists];
    await savePlaylists(next);
    setNewPlaylistName('');
  };

  const addTrackToPlaylist = async (playlistId, track) => {
    const next = playlists.map((p) => {
      if (p.id !== playlistId) return p;
      // avoid dupes by id
      const exists = (p.tracks || []).find((t) => t.id === track.id);
      if (exists) return p;
      return { ...p, tracks: [...(p.tracks || []), track] };
    });
    await savePlaylists(next);
    Alert.alert('Added', `"${track.title}" added to playlist`);
  };

  const playPlaylist = (playlist) => {
    if (!playlist || !playlist.tracks || playlist.tracks.length === 0) return Alert.alert('Empty playlist');
    // set results to playlist tracks and open player at first item
    setResults(playlist.tracks);
    setCurrentIndex(0);
    setCurrentTrack(playlist.tracks[0]);
    setFullPlayerOpen(true);
    setIsPlaying(true);
    // try prefetch first track
    (async () => {
      try {
        const videoUrl = `https://www.youtube.com/watch?v=${playlist.tracks[0].id}`;
        const info = await getAudioDownload(videoUrl);
        const candidate = (info && (info.url || info.data || info.audio || info.result || info[0])) || info;
        let url = null;
        if (typeof candidate === 'string') url = candidate;
        else if (candidate && candidate.url) url = candidate.url;
        else if (candidate && candidate.downloadUrl) url = candidate.downloadUrl;
        if (!url && candidate && candidate.formats && candidate.formats.length) {
          const f = candidate.formats.find((x) => x.mimeType && x.mimeType.includes('audio')) || candidate.formats[0];
          url = f && (f.url || f.downloadUrl || f.signatureCipher);
        }
        if (url && /^https?:\/\//i.test(url)) setPrefetchedAudioUrl(url);
      } catch (e) { console.warn('prefetch playlist first failed', e); }
    })();
  };

  const deletePlaylist = async (playlistId) => {
    const next = playlists.filter((p) => p.id !== playlistId);
    await savePlaylists(next);
  };

  const refreshDownloads = async (dir) => {
    const d = dir || downloadDir;
    try {
      const list = await FileSystem.readDirectoryAsync(d);
      const files = await Promise.all(list.map(async (name) => {
        try {
          const info = await FileSystem.getInfoAsync(d + name);
          return { name, uri: d + name, size: info.size, exists: info.exists };
        } catch (e) {
          return { name, uri: d + name, exists: false };
        }
      }));
      setDownloadFiles(files);
    } catch (e) {
      console.warn('Read downloads failed', e && e.message ? e.message : e);
      setDownloadFiles([]);
    }
  };

  const pickExternalFolder = async () => {
    try {
      if (Platform.OS !== 'android' || !FileSystem.StorageAccessFramework) {
        Alert.alert('Not supported', 'Folder picking is only supported on Android devices.');
        return;
      }

      // Request directory access via Storage Access Framework
      const res = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      const granted = res && (res.granted === true || res.granted === 'granted');
      const dirUri = res && (res.directoryUri || res.uri || res.uriString || res.selectedDirectoryUri);
      if (!granted || !dirUri) {
        Alert.alert('Folder selection', 'No folder selected or permission denied');
        return;
      }

      // Persist selection and switch to external mode
      await AsyncStorage.setItem('adil_storage_mode', 'external');
      await AsyncStorage.setItem('adil_download_dir', dirUri);
      setStorageMode('external');
      setDownloadDir(dirUri);
      Alert.alert('Folder selected', 'Selected folder will be used for downloads.');

      // Try refreshing downloads (may not list SAF URIs in all environments)
      try { await refreshDownloads(dirUri); } catch (e) { /* ignore */ }
    } catch (e) {
      console.warn('pickExternalFolder failed', e);
      Alert.alert('Selection failed', String(e && (e.message || e)));
    }
  };

  const openDownload = async (f) => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(f.uri);
      } else {
        Alert.alert('Open file', `File path: ${f.uri}`);
      }
    } catch (e) { console.warn('Open failed', e); }
  };

  const deleteDownload = async (f) => {
    try {
      await FileSystem.deleteAsync(f.uri);
      await refreshDownloads();
      Telemetry.logEvent('download_deleted', { name: f.name });
    } catch (e) { Alert.alert('Delete failed', String(e)); }
  };

  const clearCache = async () => {
    try {
      const list = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory);
      const targets = list.filter((n) => n && n.startsWith('adil_'));
      await Promise.all(targets.map((n) => FileSystem.deleteAsync(FileSystem.cacheDirectory + n).catch(() => {})));
      Alert.alert('Cache cleared');
    } catch (e) { Alert.alert('Clear cache failed', String(e)); }
  };

  const saveUpdateUrl = async (u) => {
    try {
      await AsyncStorage.setItem('adil_update_url', u || '');
      setUpdateUrl(u || '');
      setUpdateInfo(null);
      Alert.alert('Saved', 'Update URL saved');
    } catch (e) { Alert.alert('Save failed', String(e)); }
  };

  const compareSemver = (a, b) => {
    const pa = (a || '').split('.').map((x) => parseInt(x, 10) || 0);
    const pb = (b || '').split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const na = pa[i] || 0; const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  };

  const checkForUpdates = async () => {
    if (!updateUrl || updateUrl.trim() === '') return Alert.alert('No update URL', 'Set an update URL first');
    setIsCheckingUpdate(true);
    try {
      const res = await fetch(updateUrl, { method: 'GET', headers: { 'Accept': 'application/json' }, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // expected shape: { version: '1.2.3', notes: '...', url: 'https://...' }
      setUpdateInfo(data || null);
      if (data && data.version && compareSemver(data.version, localVersion) > 0) {
        Alert.alert('Update available', `Version ${data.version} is available.`, [{ text: 'Open', onPress: () => { if (data.url) Linking.openURL(data.url).catch(()=>{}); } }, { text: 'OK' }]);
      } else {
        Alert.alert('Up to date', `You are on version ${localVersion}`);
      }
    } catch (e) {
      console.warn('Update check failed', e);
      Alert.alert('Check failed', String(e && (e.message || e)));
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const sanitizeFilename = (s) => s.replace(/[^a-z0-9\-_. ]/gi, '_').slice(0, 120);

  const downloadTrack = async (item) => {
    if (!item) return Alert.alert('No track selected');
    setIsDownloading(true);
    try {
      // get audio url (prefer prefetched)
      let url = prefetchedAudioUrl;
      if (!url) {
        const videoUrl = `https://www.youtube.com/watch?v=${item.id}`;
        const info = await getAudioDownload(videoUrl);
        const candidate = (info && (info.url || info.data || info.audio || info.result || info[0])) || info;
        if (typeof candidate === 'string') url = candidate;
        else if (candidate && candidate.url) url = candidate.url;
        else if (candidate && candidate.downloadUrl) url = candidate.downloadUrl;
        else if (candidate && candidate.formats && candidate.formats.length) {
          const f = candidate.formats.find((x) => x.mimeType && x.mimeType.includes('audio')) || candidate.formats[0];
          url = f && (f.url || f.downloadUrl || f.signatureCipher);
        }
      }

      if (!url || !/^https?:\/\//i.test(url)) {
        Alert.alert('Download failed', 'No valid audio URL available');
        return;
      }

      const name = sanitizeFilename((item.title || 'track') + '.mp3');
      const destDir = downloadDir.endsWith('/') ? downloadDir : downloadDir + '/';
      const dest = destDir + name;

      // ensure directory
      try { if (!(await FileSystem.getInfoAsync(destDir)).exists) await FileSystem.makeDirectoryAsync(destDir, { intermediates: true }); } catch (e) { /* ignore */ }

      const downloadResumable = FileSystem.createDownloadResumable(url, dest);
      const result = await downloadResumable.downloadAsync();
      if (result && result.status === 200) {
        Alert.alert('Downloaded', `Saved to ${dest}`);
        await refreshDownloads();
      } else {
        Alert.alert('Download error', `Status: ${result.status}`);
      }
    } catch (err) {
      console.error('Download failed', err && (err.stack || err));
      Alert.alert('Download failed', String(err && (err.message || err)));
    } finally {
      setIsDownloading(false);
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity style={[cardStyles.card, { backgroundColor: theme.card, borderColor: theme.border }]} onPress={() => onSelectTrack(item)}>
      <Image source={{ uri: item.thumbnail }} style={cardStyles.thumb} />
      <View style={cardStyles.meta}>
        <Text numberOfLines={1} style={[cardStyles.title, { color: theme.text }]}>{item.title}</Text>
        <Text numberOfLines={1} style={[cardStyles.channel, { color: theme.muted }]}>{item.channel} • {item.duration || ''} • {item.views ? `${item.views.toLocaleString()} views` : ''}</Text>
      </View>
      <View style={{ flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity onPress={() => downloadTrack(item)} style={{ padding: 8, marginBottom: 8, backgroundColor: theme.primary, borderRadius: 8 }}>
          <Ionicons name="cloud-download-outline" size={18} color="#001" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setSelectedForPlaylist(item); setShowPlaylistModal(true); }} style={{ padding: 8, backgroundColor: theme.card, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}>
          <Ionicons name="list-outline" size={18} color={theme.text} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: { padding: 18, borderBottomWidth: 0, backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    appTitle: { fontSize: 20, fontWeight: '800', color: theme.text, letterSpacing: 0.6 },
    list: { padding: 14 },
    bottomBar: { height: 80, flexDirection: 'row', borderTopWidth: 0, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, backgroundColor: 'transparent' },
    navBtn: { alignItems: 'center', padding: 10, borderRadius: theme.radius || 12, backgroundColor: theme.card, width: 92, height: 48, justifyContent: 'center', marginHorizontal: 6, shadowColor: theme.primary, shadowOpacity: 0.14, shadowRadius: 12, elevation: 6 },
    navText: { fontSize: 12, marginTop: 0, textAlign: 'center', color: theme.text },
    navActive: { backgroundColor: theme.primary, shadowColor: theme.primary, shadowOpacity: 0.3, elevation: 12, width: 56, height: 56, borderRadius: 28, justifyContent: 'center' },
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}> 
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {screen === 'downloads' ? (
            <TouchableOpacity onPress={() => setScreen('home')} style={{ marginRight: 12, padding: 6 }}>
              <Text style={{ color: theme.primary }}>{'< Back'}</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.appTitle}>Adil Music</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setShowSettingsModal(true)} style={{ marginRight: 8 }}>
            <Ionicons name="settings-outline" size={20} color={theme.text} />
          </TouchableOpacity>
        </View>
      </View>

      {screen === 'home' && (
        <>
          <SearchBar value={query} onChange={setQuery} onSearch={onSearch} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} />

          {searchFocused && (
            <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
              {searchHistory && searchHistory.length > 0 ? (
                <FlatList
                  data={searchHistory.filter((h) => !query || h.toLowerCase().includes(query.toLowerCase()))}
                  keyExtractor={(i) => i}
                  renderItem={({ item }) => (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
                      <TouchableOpacity onPress={() => { setQuery(item); onSearch(item); setSearchFocused(false); }} style={{ flex: 1 }}>
                        <Text style={{ color: theme.text }}>{item}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteSearchHistoryItem(item)} style={{ padding: 8 }}>
                        <MaterialIcons name="close" size={18} color={theme.muted} />
                      </TouchableOpacity>
                    </View>
                  )}
                />
              ) : (
                <Text style={{ color: theme.muted }}>No recent searches</Text>
              )}
              <View style={{ marginTop: 8, alignItems: 'flex-end' }}>
                {searchHistory.length > 0 ? (
                  <TouchableOpacity onPress={() => clearAllSearchHistory()} style={{ padding: 6, flexDirection: 'row', alignItems: 'center' }}>
                    <MaterialIcons name="delete-sweep" size={16} color={theme.muted} />
                    <Text style={{ color: theme.muted, fontSize: 12, marginLeft: 6 }}>Clear all</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}

          <FlatList
            data={results}
            keyExtractor={(i) => i.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshingResults} onRefresh={onRefreshResults} tintColor={theme.primary} />}
          />
        </>
      )}

      {screen === 'downloads' && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={{ padding: 12 }}>
            <Text style={{ color: theme.text, fontWeight: '700', marginBottom: 8 }}>Downloads</Text>
            <Text style={{ color: theme.muted, marginBottom: 8 }}>Save location: use the button to select an SD card or folder on Android. App storage is used by default.</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text numberOfLines={2} style={{ color: theme.text, flex: 1 }}>Path: {downloadDir}</Text>
              <TouchableOpacity onPress={pickExternalFolder} style={{ padding: 10, backgroundColor: theme.primary, borderRadius: 8, marginLeft: 8 }}>
                <Text style={{ color: '#001' }}>Select Folder</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              <TouchableOpacity onPress={async () => {
                try {
                  await AsyncStorage.setItem('adil_storage_mode', 'app');
                  setStorageMode('app');
                  const appDir = FileSystem.documentDirectory + 'AdilMusicDownloads/';
                  setDownloadDir(appDir);
                  if (!(await FileSystem.getInfoAsync(appDir)).exists) await FileSystem.makeDirectoryAsync(appDir, { intermediates: true });
                  Alert.alert('Using app storage');
                  await refreshDownloads(appDir);
                } catch (e) { Alert.alert('Switch failed', String(e)); }
              }} style={{ padding: 10, backgroundColor: theme.card, borderRadius: 8, marginRight: 8 }}>
                <Text style={{ color: theme.text }}>Use App Storage</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => refreshDownloads(getResolvedDownloadDir())} style={{ padding: 10, backgroundColor: theme.card, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}>
                <Text style={{ color: theme.text }}>Refresh</Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginTop: 12 }}>
              <Text style={{ color: theme.text, fontWeight: '600' }}>Files</Text>
              {downloadFiles.length === 0 && <Text style={{ color: theme.muted, marginTop: 8 }}>No files yet</Text>}
              <FlatList
                data={downloadFiles}
                keyExtractor={(f) => f.name}
                renderItem={({ item: f }) => (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: theme.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text }}>{f.name}</Text>
                      <Text style={{ color: theme.muted, fontSize: 12 }}>{f.size ? `${(f.size/1024).toFixed(1)} KB` : ''}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TouchableOpacity onPress={() => openDownload(f)} style={{ padding: 8 }}>
                        <Ionicons name="share-outline" size={18} color={theme.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteDownload(f)} style={{ padding: 8 }}>
                        <MaterialIcons name="delete-outline" size={18} color="#ff6b6b" />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                refreshControl={<RefreshControl refreshing={refreshingDownloads} onRefresh={onRefreshDownloads} tintColor={theme.primary} />}
              />
            </View>

            <View style={{ marginTop: 16 }}>
              <Text style={{ color: theme.text, fontWeight: '700' }}>Quick actions</Text>
              <View style={{ flexDirection: 'row', marginTop: 8 }}>
                <TouchableOpacity onPress={() => downloadTrack(currentTrack)} disabled={!currentTrack || isDownloading} style={{ padding: 10, backgroundColor: theme.primary, borderRadius: 8, marginRight: 8 }}>
                  <Text style={{ color: '#fff' }}>{isDownloading ? 'Downloading...' : 'Download Current Track'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setDownloadDir(FileSystem.documentDirectory + 'AdilMusicDownloads/'); Alert.alert('Reset path'); }} style={{ padding: 10, backgroundColor: theme.card, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}>
                  <Text style={{ color: theme.text }}>Reset Path</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {screen === 'playlists' && (
        <View style={{ flex: 1, padding: 12 }}>
          <Text style={{ color: theme.text, fontWeight: '700', marginBottom: 8 }}>Playlists</Text>
          {playlists.length === 0 && <Text style={{ color: theme.muted }}>No playlists yet. Create one from a track's Playlist button.</Text>}
          <FlatList
            data={playlists}
            keyExtractor={(p) => p.id}
            renderItem={({ item }) => (
              <View style={{ padding: 10, borderRadius: 10, marginBottom: 8, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}>
                <Text style={{ color: theme.text, fontWeight: '700' }}>{item.name}</Text>
                <Text style={{ color: theme.muted, marginTop: 6 }}>{(item.tracks || []).length} tracks</Text>
                <View style={{ flexDirection: 'row', marginTop: 10 }}>
                  <TouchableOpacity onPress={() => playPlaylist(item)} style={{ padding: 10, backgroundColor: theme.primary, borderRadius: 8, marginRight: 8 }}>
                    <Text style={{ color: '#001' }}>Play</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { /* open playlist details */ }} style={{ padding: 10, backgroundColor: theme.card, borderRadius: 8, borderWidth: 1, borderColor: theme.border, marginRight: 8 }}>
                    <Text style={{ color: theme.text }}>View</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deletePlaylist(item.id)} style={{ padding: 10, backgroundColor: '#ff5555', borderRadius: 8 }}>
                    <Text style={{ color: '#fff' }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            refreshControl={<RefreshControl refreshing={refreshingPlaylists} onRefresh={onRefreshPlaylists} tintColor={theme.primary} />}
          />
        </View>
      )}

      {/* Mini player shown when a track is selected and full player is closed */}
      {currentTrack && !fullPlayerOpen && (
        <View style={[miniStyles.container, { backgroundColor: theme.card, borderTopColor: theme.border }]}> 
          <Image source={{ uri: currentTrack.thumbnail }} style={miniStyles.thumb} />
          <View style={miniStyles.info}>
            <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '600' }}>{currentTrack.title}</Text>
            <Text numberOfLines={1} style={{ color: theme.muted }}>{currentTrack.channel}</Text>
          </View>
          <TouchableOpacity onPress={() => { setIsPlaying((p) => !p); /* local toggle - for UI only */ }} style={miniStyles.playBtn}>
            <Text style={{ color: '#fff' }}>{isPlaying ? 'Pause' : 'Play'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setFullPlayerOpen(true); }} style={miniStyles.openBtn}>
            <Text style={{ color: theme.primary }}>Open</Text>
          </TouchableOpacity>
        </View>
      )}

      <Player
        videoId={currentTrack ? currentTrack.id : null}
        title={currentTrack ? currentTrack.title : ''}
        thumbnail={currentTrack ? currentTrack.thumbnail : null}
        channel={currentTrack ? currentTrack.channel : ''}
        audioUrl={prefetchedAudioUrl}
        onClose={() => { setFullPlayerOpen(false); setIsPlaying(false); setPrefetchedAudioUrl(null); }}
        onMinimize={() => { setFullPlayerOpen(false); /* keep isPlaying as-is so playback continues */ }}
        visible={fullPlayerOpen}
        keepMounted={true}
        onNext={onNext}
        onPrev={onPrev}
      />

      {/* Playlist modal */}
      <Modal visible={showPlaylistModal} animationType="slide" transparent={true} onRequestClose={() => setShowPlaylistModal(false)}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View style={{ width: '90%', maxHeight: '80%', backgroundColor: theme.card, borderRadius: 12, padding: 14 }}>
            <Text style={{ color: theme.text, fontWeight: '700', marginBottom: 8 }}>Add to Playlist</Text>
            <View style={{ flexDirection: 'row', marginBottom: 8 }}>
              <TextInput value={newPlaylistName} onChangeText={setNewPlaylistName} placeholder="New playlist name" placeholderTextColor={theme.muted} style={{ flex: 1, backgroundColor: theme.background, padding: 8, borderRadius: 8, color: theme.text, borderWidth: 1, borderColor: theme.border }} />
              <TouchableOpacity onPress={() => createPlaylist(newPlaylistName)} style={{ marginLeft: 8, padding: 10, backgroundColor: theme.primary, borderRadius: 8 }}>
                <Text style={{ color: '#fff' }}>Create</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={playlists}
              keyExtractor={(p) => p.id}
              renderItem={({ item }) => (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: theme.border }}>
                  <Text style={{ color: theme.text }}>{item.name} ({(item.tracks || []).length})</Text>
                  <TouchableOpacity onPress={() => { addTrackToPlaylist(item.id, selectedForPlaylist); setShowPlaylistModal(false); }} style={{ padding: 8, backgroundColor: theme.primary, borderRadius: 8 }}>
                    <Text style={{ color: '#fff' }}>Add</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
            <TouchableOpacity onPress={() => setShowPlaylistModal(false)} style={{ marginTop: 12, padding: 10, alignItems: 'center' }}>
              <Text style={{ color: theme.muted }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Settings modal */}
      <Modal visible={showSettingsModal} animationType="slide" transparent={true} onRequestClose={() => setShowSettingsModal(false)}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <View style={{ width: '92%', backgroundColor: theme.card, borderRadius: 12, padding: 16 }}>
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>Settings</Text>
            <View style={{ marginTop: 12 }}>
              <Text style={{ color: theme.muted, marginBottom: 6 }}>Audio Quality</Text>
              <View style={{ flexDirection: 'row' }}>
                <TouchableOpacity style={{ padding: 10, backgroundColor: theme.card, borderRadius: 8, marginRight: 8 }}><Text style={{ color: theme.text }}>Auto</Text></TouchableOpacity>
                <TouchableOpacity style={{ padding: 10, backgroundColor: theme.card, borderRadius: 8, marginRight: 8 }}><Text style={{ color: theme.text }}>High</Text></TouchableOpacity>
                <TouchableOpacity style={{ padding: 10, backgroundColor: theme.card, borderRadius: 8 }}><Text style={{ color: theme.text }}>Low</Text></TouchableOpacity>
              </View>
            </View>
            <View style={{ marginTop: 12 }}>
              <Text style={{ color: theme.muted, marginBottom: 6 }}>Storage</Text>
              <Text style={{ color: theme.text, marginBottom: 6 }}>Path: {downloadDir}</Text>
              <View style={{ flexDirection: 'row', marginTop: 8 }}>
                <TouchableOpacity onPress={pickExternalFolder} style={{ padding: 10, backgroundColor: theme.primary, borderRadius: 8, marginRight: 8 }}>
                  <Text style={{ color: '#001' }}>Select Folder</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={async () => { try { await AsyncStorage.setItem('adil_storage_mode', 'app'); setStorageMode('app'); setDownloadDir(FileSystem.documentDirectory + 'AdilMusicDownloads/'); Alert.alert('Set to app storage'); } catch (e) { Alert.alert('Reset failed', String(e)); } }} style={{ padding: 10, backgroundColor: theme.card, borderRadius: 8, marginRight: 8 }}>
                  <Text style={{ color: theme.text }}>Use App Storage</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => clearCache()} style={{ padding: 10, backgroundColor: '#ff6b6b', borderRadius: 8 }}>
                  <Text style={{ color: '#fff' }}>Clear Cache</Text>
                </TouchableOpacity>
              </View>
            </View>
              <View style={{ marginTop: 12 }}>
                <Text style={{ color: theme.muted, marginBottom: 6 }}>Playback</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.text }}>Stop playback when closing player</Text>
                  <TouchableOpacity onPress={async () => { try { const next = !stopOnClose; await AsyncStorage.setItem('adil_stop_on_close', next ? '1' : '0'); setStopOnClose(next); } catch (e) { Alert.alert('Save failed', String(e)); } }} style={{ padding: 8, backgroundColor: stopOnClose ? theme.primary : theme.card, borderRadius: 8 }}>
                    <Text style={{ color: stopOnClose ? '#001' : theme.text }}>{stopOnClose ? 'On' : 'Off'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            <View style={{ marginTop: 12 }}>
              <Text style={{ color: theme.muted, marginBottom: 6 }}>Update</Text>
              <TextInput value={updateUrl} onChangeText={setUpdateUrl} placeholder={'https://example.com/adil-latest.json'} placeholderTextColor={theme.muted} style={{ backgroundColor: theme.card, padding: 8, borderRadius: 8, color: theme.text, borderWidth: 1, borderColor: theme.border }} />
              <View style={{ flexDirection: 'row', marginTop: 8 }}>
                <TouchableOpacity onPress={() => saveUpdateUrl(updateUrl)} style={{ padding: 10, backgroundColor: theme.primary, borderRadius: 8, marginRight: 8 }}>
                  <Text style={{ color: '#001' }}>Save URL</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => checkForUpdates()} style={{ padding: 10, backgroundColor: theme.card, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}>
                  <Text style={{ color: theme.text }}>{isCheckingUpdate ? 'Checking...' : 'Check for updates'}</Text>
                </TouchableOpacity>
              </View>
              {updateInfo ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={{ color: theme.text, fontWeight: '600' }}>Latest: {updateInfo.version || 'unknown'}</Text>
                  {updateInfo.notes ? <Text style={{ color: theme.muted, marginTop: 6 }}>{updateInfo.notes}</Text> : null}
                  {updateInfo.url ? (
                    <TouchableOpacity onPress={() => Linking.openURL(updateInfo.url).catch(()=>{})} style={{ marginTop: 8, padding: 8, backgroundColor: theme.primary, borderRadius: 8 }}>
                      <Text style={{ color: '#001' }}>Open Update</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>
            <View style={{ marginTop: 12 }}>
              <Text style={{ color: theme.muted, marginBottom: 6 }}>Theme</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {Object.keys(themes).map((k) => (
                  <TouchableOpacity key={k} onPress={() => setTheme(k)} style={{ width: 92, marginRight: 8, marginBottom: 8 }}>
                    <View style={{ height: 48, borderRadius: 8, backgroundColor: themes[k].card, borderWidth: 1, borderColor: themes[k].border, alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{ width: 36, height: 12, backgroundColor: themes[k].primary, borderRadius: 6 }} />
                    </View>
                    <Text style={{ color: theme.text, fontSize: 12, marginTop: 6 }}>{themes[k].name.replace('futuristic-', '').replace('-', ' ')}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TouchableOpacity onPress={() => setShowSettingsModal(false)} style={{ marginTop: 14, padding: 10, alignItems: 'center' }}>
              <Text style={{ color: theme.muted }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* bottom navigation */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={[styles.navBtn, screen === 'home' ? styles.navActive : null]} onPress={() => goHome()}>
          <Ionicons name="home-outline" size={22} color={screen === 'home' ? '#001' : theme.muted} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navBtn, screen === 'downloads' ? styles.navActive : null]} onPress={() => setScreen('downloads')}>
          <Ionicons name="download-outline" size={22} color={screen === 'downloads' ? '#001' : theme.muted} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navBtn, screen === 'playlists' ? styles.navActive : null]} onPress={() => setScreen('playlists')}>
          <Ionicons name="list-outline" size={22} color={screen === 'playlists' ? '#001' : theme.muted} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: 10, alignItems: 'center', borderBottomWidth: 1, paddingBottom: 8 },
  thumb: { width: 120, height: 68, borderRadius: 4, backgroundColor: '#ddd' },
  meta: { marginLeft: 10, flex: 1 },
  title: { fontSize: 14, fontWeight: '500' },
  channel: { fontSize: 12, marginTop: 4 },
});

const cardStyles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 12, borderRadius: 14, borderWidth: 1, elevation: 6, shadowColor: '#00e6ff', shadowOpacity: 0.06, shadowRadius: 12 },
  thumb: { width: 92, height: 92, borderRadius: 12, backgroundColor: '#222', borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)' },
  meta: { marginLeft: 14, flex: 1 },
  title: { fontSize: 16, fontWeight: '800' },
  channel: { fontSize: 12, marginTop: 6, color: '#9fb8c8' },
});

const miniStyles = StyleSheet.create({
  container: { position: 'absolute', left: 16, right: 16, bottom: 86, height: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.02)', shadowColor: '#00e6ff', shadowOpacity: 0.12, shadowRadius: 14, elevation: 10, zIndex: 1000, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  thumb: { width: 52, height: 52, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)' },
  info: { flex: 1, marginLeft: 12 },
  playBtn: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#071322', borderRadius: 999, marginRight: 8, borderWidth: 1, borderColor: 'rgba(0,230,255,0.12)' },
  openBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
});
