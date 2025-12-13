import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { themeConfig } from './config';

const OptionsContext = createContext();

const getLightThemeDefaults = () => {
  const lightTheme = themeConfig.find(t => t.value?.themeName === 'lightTheme');
  return lightTheme ? lightTheme.value : {};
};

const getStoredOptions = () => {
  try {
    const stored = JSON.parse(localStorage.getItem('options') || '{}');
    const lightDefaults = getLightThemeDefaults();
    
    // Set defaults
    const defaults = {
      ...lightDefaults,
      prType: 'scr', // Scramjet as default backend engine
    };
    
    // Set light theme as default if no theme is stored
    if (!stored.theme && !stored.themeName) {
      return {
        ...defaults,
        ...stored,
      };
    }
    
    // If light theme is selected, ensure all light theme values are applied
    if (stored.themeName === 'lightTheme' || stored.theme === 'light') {
      return {
        ...defaults,
        ...stored,
      };
    }
    
    // Ensure prType is set to scr if not set or if it's 'auto' (legacy)
    if (!stored.prType || stored.prType === 'auto') {
      return {
        ...stored,
        prType: 'scr',
      };
    }
    
    return stored;
  } catch {
    const lightDefaults = getLightThemeDefaults();
    return {
      ...lightDefaults,
      prType: 'scr',
    };
  }
};

export const OptionsProvider = ({ children }) => {
  const [options, setOptions] = useState(getStoredOptions);

  useEffect(() => {
    try {
      localStorage.setItem('options', JSON.stringify(options));
    } catch {}
  }, [options]);

  const updateOption = useCallback((obj, immediate = true) => {
    if (!obj || typeof obj !== 'object') return;

    const current = getStoredOptions();
    const updated = { ...current, ...obj };

    try {
      localStorage.setItem('options', JSON.stringify(updated));
    } catch {}

    if (immediate) {
      setOptions((prev) => ({ ...prev, ...obj }));
    }
  }, []);

  const contextValue = useMemo(() => ({ options, updateOption }), [options, updateOption]);

  return <OptionsContext.Provider value={contextValue}>{children}</OptionsContext.Provider>;
};

export const useOptions = () => {
  const context = useContext(OptionsContext);
  if (!context) {
    throw new Error('useOptions must be used within an OptionsProvider');
  }
  return context;
};
