import React, { createContext, useContext, useState, useEffect } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const themes = {
  'futuristic-light': {
    name: 'futuristic-light',
    background: '#0f1724', // deep slate
    card: 'rgba(255,255,255,0.04)',
    text: '#e6f7ff',
    muted: '#9fb8c8',
    border: 'rgba(255,255,255,0.06)',
    primary: '#00e6ff', // neon cyan
    accent: '#7c3aed', // violet accent
    glass: 'rgba(255,255,255,0.03)',
    glow: '#00e6ff22',
    radius: 12,
  },
  'futuristic-dark': {
    name: 'futuristic-dark',
    background: '#05060a', // near-black
    card: 'rgba(255,255,255,0.03)',
    text: '#e6f7ff',
    muted: '#8ea8b8',
    border: 'rgba(255,255,255,0.04)',
    primary: '#00e6ff',
    accent: '#8b5cf6',
    glass: 'rgba(255,255,255,0.02)',
    glow: '#00e6ff22',
    radius: 14,
  },
  'neon-blue': {
    name: 'neon-blue',
    background: '#071023',
    card: 'rgba(0,6,24,0.6)',
    text: '#dff7ff',
    muted: '#9fcfe2',
    border: 'rgba(0,230,255,0.06)',
    primary: '#00b7ff',
    accent: '#00ffd5',
    glass: 'rgba(0,183,255,0.04)',
    glow: '#00b7ff22',
    radius: 12,
  },
  'pink-glow': {
    name: 'pink-glow',
    background: '#12050b',
    card: 'rgba(255,255,255,0.02)',
    text: '#ffe6f2',
    muted: '#e0a7c1',
    border: 'rgba(255,132,182,0.06)',
    primary: '#ff5fb4',
    accent: '#ffb3d9',
    glass: 'rgba(255,95,180,0.03)',
    glow: '#ff5fb422',
    radius: 12,
  },
  'black-mix': {
    name: 'black-mix',
    background: '#000000',
    card: 'rgba(255,255,255,0.02)',
    text: '#f2f2f2',
    muted: '#9a9a9a',
    border: 'rgba(255,255,255,0.03)',
    primary: '#7cffcb',
    accent: '#6b6bff',
    glass: 'rgba(255,255,255,0.01)',
    glow: '#7cffcb22',
    radius: 12,
  },
};

const ThemeContext = createContext({
  theme: themes['futuristic-dark'],
  toggle: () => {},
});

export function ThemeProvider({ children }) {
  const colorScheme = Appearance.getColorScheme();
  const [name, setName] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem('adil_theme');
        if (mounted && saved) {
          setName(saved);
          return;
        }
      } catch (e) {}
      if (mounted) setName(colorScheme && colorScheme === 'dark' ? 'futuristic-dark' : 'futuristic-light');
    })();

    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setName((prev) => (prev ? prev : (colorScheme === 'dark' ? 'futuristic-dark' : 'futuristic-light')));
    });
    return () => { mounted = false; try { sub.remove(); } catch (e) {} };
  }, []);

  const toggle = async () => {
    try {
      const next = (name && name.includes('dark')) ? 'futuristic-light' : 'futuristic-dark';
      setName(next);
      await AsyncStorage.setItem('adil_theme', next);
    } catch (e) { setName((n) => (n && n.includes('dark') ? 'futuristic-light' : 'futuristic-dark')); }
  };

  const setTheme = async (themeName) => {
    try { await AsyncStorage.setItem('adil_theme', themeName); } catch (e) {}
    setName(themeName);
  };

  return (
    <ThemeContext.Provider value={{ theme: themes[name] || themes['futuristic-dark'], toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export { themes };

export default {
  ThemeProvider,
  useTheme,
};
