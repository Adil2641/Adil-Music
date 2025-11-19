import React, { useState, useEffect, useRef } from 'react';
import { View, TextInput, Button, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { useTheme } from '../theme';

export default function SearchBar({ value, onChange, onSearch, debounce = 400, onFocus, onBlur, clearable = true, autoSearch = false }) {
  const { theme } = useTheme();
  const [local, setLocal] = useState(value || '');
  const timer = useRef(null);

  useEffect(() => {
    setLocal(value || '');
  }, [value]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onText = (txt) => {
    setLocal(txt);
    if (typeof onChange === 'function') onChange(txt);
    if (!autoSearch) return; // do not auto-trigger search unless explicitly enabled
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (typeof onSearch === 'function') onSearch(txt);
    }, debounce);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.card }]}> 
      <TextInput
        placeholder="Search YouTube (song, artist, playlist...)"
        placeholderTextColor={theme.muted}
        style={[styles.input, { borderColor: theme.border, color: theme.text }]}
        value={local}
        onChangeText={onText}
        returnKeyType="search"
        onSubmitEditing={() => { if (typeof onSearch === 'function') onSearch(local); }}
        onFocus={() => { if (typeof onFocus === 'function') onFocus(); }}
        onBlur={() => { if (typeof onBlur === 'function') onBlur(); }}
      />
      {clearable && local.length > 0 ? (
        <TouchableOpacity onPress={() => { setLocal(''); if (typeof onChange === 'function') onChange(''); }} style={{ marginRight: 8 }}>
          <Text style={{ color: theme.primary }}>Clear</Text>
        </TouchableOpacity>
      ) : null}
      <Button color={theme.primary} title="Search" onPress={() => { if (typeof onSearch === 'function') onSearch(local); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', padding: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, padding: 8, marginRight: 8, borderRadius: 6 },
});
