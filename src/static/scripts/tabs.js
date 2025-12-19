import { BareMuxConnection } from '@mercuryworkshop/bare-mux';
import * as contentObserver from './content_observer';
import { setupHotkeys } from './hotkeys';
import { CONFIG } from './config';
import { logUtils } from '/src/utils/utils';
import 'movement.css';

const createIframe = (url, manager, tab, srcPrefix = '') => {
  const f = document.createElement('iframe');
  Object.assign(f, {
    id: `iframe-${tab.id}`,
    className: manager.fCss,
    src: srcPrefix + url,
  });
  Object.assign(f.style, {
    zIndex: '10',
    opacity: '1',
    pointerEvents: 'auto',
  });
  manager.ic.appendChild(f);
  return f;
};

export const TYPE = {
  scr: {
    create: (url, manager, tab) => {
      const sf = scr.createFrame();
      manager.frames[tab.id] = sf;
      const frame = sf.frame;
      frame.id = `iframe-${tab.id}`;
      frame.className = manager.fCss;
      frame.style.zIndex = 10;
      frame.style.opacity = '1';
      frame.style.pointerEvents = 'auto';
      manager.ic.appendChild(frame);
      sf.go(url);
      manager.addLoadListener(tab.id);
    },
    navigate: (url, manager, tab, iframe) => {
      if (manager.frames[tab.id]) manager.frames[tab.id].go(url);
      else if (iframe) {
        const sf = scr.createFrame(iframe);
        manager.frames[tab.id] = sf;
        sf.go(url);
      }
    },
  },

  uv: {
    create: (url, manager, tab) => createIframe(manager.enc(url), manager, tab, '/uv/service/'),
    navigate: (url, manager, tab, iframe) =>
      iframe && (iframe.src = '/uv/service/' + manager.enc(url)),
  },

  uv1: {
    create: (url, manager, tab) => createIframe(manager.enc(url), manager, tab, '/assignments/'),
    navigate: (url, manager, tab, iframe) =>
      iframe && (iframe.src = '/assignments/' + manager.enc(url)),
  },

  notion: {
    create: (url, manager, tab) => {
      // Crear iframe directo al Cloudflare Worker (ya viene con la URL convertida)
      const f = document.createElement('iframe');
      f.id = `iframe-${tab.id}`;
      f.className = manager.fCss;
      f.src = url;
      const isActive = tab.active;
      f.style.zIndex = isActive ? '10' : '0';
      f.style.opacity = isActive ? '1' : '0';
      f.style.pointerEvents = isActive ? 'auto' : 'none';
      f.style.width = '100%';
      f.style.height = '100%';
      f.style.border = 'none';
      
      // Permitir cookies y almacenamiento en el iframe (necesario para login de Notion)
      f.setAttribute('allow', 'cookies');
      f.setAttribute('credentialless', 'false');
      
      if (!manager.ic) return;
      
      manager.ic.appendChild(f);
      manager.frames[tab.id] = { frame: f, url: url };
      manager.addLoadListener(tab.id);
      
      setTimeout(() => {
        manager.setFrameState(tab.id, isActive);
      }, 0);
      
      // Asegurar visibilidad si el tab está activo
      f.onload = () => {
        if (tab.active) {
          f.style.opacity = '1';
          f.style.zIndex = '10';
          f.style.pointerEvents = 'auto';
          manager.setFrameState(tab.id, true);
        }
      };
    },
    navigate: (url, manager, tab, iframe) => {
      if (!iframe) return;
      
      const currentSrc = iframe.src || '';
      if (currentSrc !== url) {
        iframe.src = url;
        manager.setFrameState(tab.id, true);
      } else if (tab.active) {
        iframe.style.zIndex = '10';
        iframe.style.opacity = '1';
        iframe.style.pointerEvents = 'auto';
        manager.setFrameState(tab.id, true);
      }
      
      // Limpiar referencias a ScramJet para Notion
      if (manager.frames[tab.id]) {
        delete manager.frames[tab.id];
      }
    },
  },

  auto: {
    create: (url, manager, tab) => {
      // Detectar Notion primero (tiene prioridad sobre otros filtros)
      const isNotion = url.includes('silent-queen-f1d8.sebdiar.workers.dev') || 
                       url.includes('notion.so') || 
                       url.includes('notion.com');
      
      if (isNotion) {
        return TYPE.notion.create(url, manager, tab);
      }
      
      const matched = manager.filter?.find((f) => url.toLowerCase().includes(f.url.toLowerCase()));
      return TYPE[
        matched?.type ||
          (manager.filter?.some(
            (f) => f.type === 'scr' && url.toLowerCase().includes(f.url.toLowerCase()),
          )
            ? 'scr'
            : 'uv')
      ].create(url, manager, tab);
    },
    navigate: (url, manager, tab, iframe) => {
      // Detectar Notion primero (tiene prioridad sobre otros filtros)
      const isNotion = url.includes('silent-queen-f1d8.sebdiar.workers.dev') || 
                       url.includes('notion.so') || 
                       url.includes('notion.com');
      
      if (isNotion) {
        return TYPE.notion.navigate(url, manager, tab, iframe);
      }
      
      const matched = manager.filter?.find((f) => url.toLowerCase().includes(f.url.toLowerCase()));
      return TYPE[
        matched?.type ||
          (manager.filter?.some(
            (f) => f.type === 'scr' && url.toLowerCase().includes(f.url.toLowerCase()),
          )
            ? 'scr'
            : 'uv')
      ].navigate(url, manager, tab, iframe);
    },
  },
};

class TabManager {
  constructor(arr) {
    const stored = JSON.parse(localStorage.getItem('options')) || {};

    Object.assign(this, {
      unsupported: CONFIG.unsupported,
      filter: CONFIG.filter,
      options: stored,
      prType: stored.prType || 'scr',
      search: stored.engine || 'https://www.google.com/search?q=',
      newTabUrl: '/new',
      newTabTitle: 'New Tab',
      enc: arr[0],
      dnc: arr[1],
      frames: {},
      tabs: [], // Start with no tabs - they will be loaded from backend
      history: new Map(),
      urlTrack: new Map(),
      nextId: 2,
      maxTabs: 9999, // Effectively unlimited
      minW: 50,
      maxW: 200,
      urlInterval: 2000, // Reduced frequency for better performance
      maxOpenTabs: 5, // Maximum tabs with loaded content (for memory management)
      inactiveTimeout: 15 * 60 * 1000, // 15 minutes in milliseconds
    });

    const els = ['tabs-cont', 'tab-btn', 'fcn', 'url', 'class-portal'].reduce(
      (acc, id) => ({ ...acc, [id]: document.getElementById(id) }),
      {},
    );

    Object.assign(this, {
      tc: els['tabs-cont'],
      ab: els['tab-btn'],
      ic: els['fcn'],
      ui: els['url'],
      bg: els['class-portal'],
      fCss: 'w-full h-full border-0 absolute top-0 left-0 z-0 transition-opacity duration-200 ease-in-out opacity-0 pointer-events-none',
    });

    // Don't set onclick here - let luna-integration.js handle it for modal
    // If luna-integration is not available, fallback to default behavior
    if (!window.lunaIntegration) {
      this.ab.onclick = () => this.add();
    }

    this.tc.onclick = (e) => {
      const el = e.target.closest('.close-tab, .tab-item');
      if (!el) return;
      const id = +el.dataset.tabId;
      el.classList.contains('close-tab') ? this.close(id) : this.activate(id);
    };

    if (this.ui) {
      // Mostrar URL original si es Notion, sino el URL normal
      const firstTab = this.tabs.length > 0 ? this.tabs[0] : null;
      if (firstTab && !this.isNewTab(firstTab.url)) {
        this.ui.value = firstTab.originalUrl || firstTab.url;
      } else {
        this.ui.value = '';
      }
      this.ui.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = this.ui.value.trim();
          this.updateUrl(val);
          // NO actualizar ui.value aquí - updateUrl ya lo hace correctamente
          this.ui.blur();
        }
      });
    }

    window.addEventListener('resize', () => {
      this.updateAddBtn();
      this.updateWidths();
    });

    // Listen for favicon updates from Notion iframes
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'notion-favicon-update') {
        // Find the tab that matches this URL - mejor matching
        const messageUrl = e.data.url || '';
        const tab = this.tabs.find(t => {
          if (!t.url) return false;
          const tabUrl = t.url.toLowerCase();
          
          // Buscar por URL completa o por dominio
          if (tabUrl.includes('silent-queen-f1d8.sebdiar.workers.dev') || 
              tabUrl.includes('notion.so') || 
              tabUrl.includes('notion.com')) {
            // Si es un tab de Notion, verificar si la URL del mensaje coincide
            // Extraer el path de ambas URLs para comparar
            try {
              const tabUrlObj = new URL(tabUrl);
              const messageUrlObj = new URL(messageUrl);
              // Comparar paths (sin query params)
              const tabPath = tabUrlObj.pathname;
              const messagePath = messageUrlObj.pathname;
              
              // Si los paths son similares o el tab está activo, actualizar
              if (tabPath === messagePath || 
                  messagePath.startsWith(tabPath) || 
                  tabPath.startsWith(messagePath) ||
                  t.active) {
                return true;
              }
            } catch {
              // Si falla el parsing, usar matching simple
              return tabUrl.includes('notion') || messageUrl.includes(tabUrl) || tabUrl.includes(messageUrl);
            }
          }
          return false;
        });
        
        if (tab && e.data.favicon) {
          // Update tab's favicon
          tab.favicon = e.data.favicon;
          // Re-render to show updated favicon
          this.render();
        }
      }
    });

    // Suppress emoji warnings from Notion (harmless but noisy)
    const originalWarn = console.warn;
    console.warn = function(...args) {
      const message = args.join(' ');
      // Suppress "Could not find character in emojiData" warnings
      if (message.includes('emojiData') || message.includes('Could not find character')) {
        return; // Suppress these warnings
      }
      originalWarn.apply(console, args);
    };

    this.render();
    this.createIframes();
    this.updateAddBtn();
    this.startTracking();
    contentObserver.init();
    setupHotkeys();

    window.tabManager = this;
  }

  ex = (() => {
    const endpoints = Object.values(TYPE)
      .map((p) => {
        switch (p) {
          case TYPE.scr:
            return 'scramjet';
          case TYPE.uv:
            return 'uv/service';
          case TYPE.uv1:
            return 'assignments';
          default:
            return null;
        }
      })
      .filter(Boolean)
      .join('|');
    const regex = new RegExp(`^https?:\/\/[^\/]+\/(${endpoints})\/`, 'i');
    return (url) => this.dnc(url.replace(regex, ''));
  })();

  showBg = (c) => {
    this.bg.style.opacity = c ? '1' : '0';
    this.bg.style.pointerEvents = c ? 'auto' : 'none';
  };

  escapeHTML = (str) => {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  };

  formatInputUrl = (input, search = this.search) => {
    // Detectar URLs de Notion y convertir al Cloudflare Worker
    const notionPattern = /(https?:\/\/)?([a-zA-Z0-9-]+\.)?notion\.(so|com)(\/[^\s]*)?/i;
    if (notionPattern.test(input)) {
      let notionUrl = input;
      if (!/^https?:\/\//.test(notionUrl)) {
        notionUrl = 'https://' + notionUrl;
      }
      
      try {
        const url = new URL(notionUrl);
        // Extraer solo la ruta (pathname + search + hash)
        const path = url.pathname + url.search + url.hash;
        // Convertir al Cloudflare Worker manteniendo la ruta
        return `https://silent-queen-f1d8.sebdiar.workers.dev${path}`;
      } catch (e) {
        // Si falla el parsing, intentar extraer la ruta manualmente
        const match = notionUrl.match(/notion\.(so|com)(\/.*)?/i);
        if (match && match[2]) {
          return `https://silent-queen-f1d8.sebdiar.workers.dev${match[2]}`;
        }
        // Fallback: usar el formato normal
      }
    }
    
    // Para otras URLs, comportamiento normal
    return /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/[^\s]*)?$/i.test(input)
      ? /^https?:\/\//.test(input)
        ? input
        : 'https://' + input
      : search + encodeURIComponent(input);
  };

  // Nueva función para obtener el URL original de Notion
  getOriginalNotionUrl = (workerUrl) => {
    if (!workerUrl || !workerUrl.includes('silent-queen-f1d8.sebdiar.workers.dev')) {
      return null;
    }
    try {
      const url = new URL(workerUrl);
      const path = url.pathname + url.search + url.hash;
      return `https://www.notion.so${path}`;
    } catch {
      return null;
    }
  };

  domain = (url) => {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return this.newTabTitle;
    }
  };

  isNewTab = (url) => url === this.newTabUrl;

  active = () => this.tabs.find((t) => t.active);

  setFrameState = (tabId, active) => {
    const f = document.getElementById(`iframe-${tabId}`);
    const chatContainer = document.getElementById(`chat-${tabId}`);
    const dashboardContainer = document.getElementById(`dashboard-${tabId}`);
    
    if (f) {
      f.style.zIndex = active ? '10' : '0';
      f.style.opacity = active ? '1' : '0';
      f.style.pointerEvents = active ? 'auto' : 'none';
      f.classList.toggle('f-active', active);
    }
    
    if (chatContainer) {
      chatContainer.style.zIndex = active ? '10' : '0';
      chatContainer.style.opacity = active ? '1' : '0';
      chatContainer.style.pointerEvents = active ? 'auto' : 'none';
      chatContainer.classList.toggle('f-active', active);
    }
    
    if (dashboardContainer) {
      dashboardContainer.style.zIndex = active ? '10' : '0';
      dashboardContainer.style.opacity = active ? '1' : '0';
      dashboardContainer.style.pointerEvents = active ? 'auto' : 'none';
      dashboardContainer.classList.toggle('f-active', active);
    }
  };

  showActive = () => {
    const activeTab = this.active();
    this.tabs.forEach((t) => this.setFrameState(t.id, t === activeTab));
    
    // Hide/show URL bar based on active tab type
    const urlBar = document.getElementById('d-url');
    if (urlBar && activeTab) {
      const isSpecial = this.isChatUrl(activeTab.url) || activeTab.url?.startsWith('doge://ai-dashboard') || activeTab.url?.startsWith('luna://ai-dashboard');
      urlBar.style.display = isSpecial ? 'none' : 'flex';
      
      // Actualizar indicador del Cloudflare Worker
      this.updateNotionWorkerIndicator(activeTab);
    } else if (urlBar && !activeTab) {
      urlBar.style.display = 'flex';
      this.updateNotionWorkerIndicator(null);
    }
  };

  // Nueva función para actualizar el indicador del Cloudflare Worker
  updateNotionWorkerIndicator = (tab) => {
    const indicator = document.getElementById('notion-worker-indicator');
    if (!indicator) return;
    
    // Verificar si el usuario quiere mostrar el indicador (por defecto: false)
    const showProxyIndicator = localStorage.getItem('showProxyIndicator') === 'true';
    
    if (showProxyIndicator && tab && tab.url && tab.url.includes('silent-queen-f1d8.sebdiar.workers.dev')) {
      indicator.textContent = `Proxied via: ${tab.url}`;
      indicator.style.display = 'block';
      // Hacer la barra de URL más ancha
      const urlBar = document.getElementById('d-url');
      if (urlBar) {
        urlBar.style.minHeight = '44px'; // Altura dinámica
        urlBar.style.transition = 'min-height 0.2s ease';
      }
    } else {
      indicator.style.display = 'none';
      // Restaurar altura normal
      const urlBar = document.getElementById('d-url');
      if (urlBar) {
        urlBar.style.minHeight = '22px';
        urlBar.style.transition = 'min-height 0.2s ease';
      }
    }
  };

  startTracking = () => this.tabs.forEach((t) => this.track(t.id));

  track = (id) => {
    if (this.urlTrack.has(id)) clearInterval(this.urlTrack.get(id));
    const iv = setInterval(() => this.checkStudentUrl(id), this.urlInterval);
    this.urlTrack.set(id, iv);
  };

  stopTrack = (id) => {
    if (this.urlTrack.has(id)) {
      clearInterval(this.urlTrack.get(id));
      this.urlTrack.delete(id);
    }
  };

  isChatUrl = (url) => {
    return url && (url.startsWith('luna://chat/') || url.startsWith('doge://chat/'));
  };

  isSpecialUrl = (url) => {
    return url && (url.startsWith('luna://') || url.startsWith('doge://') || url.startsWith('tabs://'));
  };

  // Check if a tab has loaded content (iframe has a real URL)
  hasLoadedContent = (tab) => {
    if (this.isChatUrl(tab.url) || this.isSpecialUrl(tab.url)) return true; // Special tabs are considered "loaded"
    const f = document.getElementById(`iframe-${tab.id}`);
    if (!f) return false;
    const src = f.src || '';
    // Consider loaded if it has a real URL (not placeholder)
    return src && src !== '/new' && src !== 'tabs://new' && 
           (src.includes('http') || src.includes('scramjet') || src.includes('uv/service'));
  };

  // Get count of tabs with loaded content
  getLoadedTabsCount = () => {
    return this.tabs.filter(t => this.hasLoadedContent(t)).length;
  };

  // Enforce memory limits: close inactive tabs if we exceed maxOpenTabs (OPTIMIZED)
  enforceMemoryLimits = () => {
    // Early exit if we don't have enough tabs to worry about
    if (this.tabs.length <= this.maxOpenTabs) return;
    
    const now = Date.now();
    const loadedTabs = [];
    
    // Single pass to identify loaded tabs
    for (const tab of this.tabs) {
      if (this.hasLoadedContent(tab)) {
        loadedTabs.push(tab);
      }
    }
    
    // Only proceed if we exceed the limit
    if (loadedTabs.length <= this.maxOpenTabs) return;
    
    // Find inactive tabs (single pass)
    const inactiveTabs = [];
    for (const tab of loadedTabs) {
      if (tab.active) continue; // Skip active tab
      
      const lastAccessed = tab.lastAccessed || tab.createdAt || 0;
      if (now - lastAccessed > this.inactiveTimeout) {
        inactiveTabs.push(tab);
      }
    }
    
    // Close inactive tabs first
    if (inactiveTabs.length > 0) {
      inactiveTabs.sort((a, b) => {
        const aTime = a.lastAccessed || a.createdAt || 0;
        const bTime = b.lastAccessed || b.createdAt || 0;
        return aTime - bTime;
      });
      
      for (const tab of inactiveTabs) {
        this.unloadTab(tab.id);
      }
    }
    
    // Re-check remaining loaded tabs after closing inactive ones
    const remainingLoaded = [];
    for (const tab of this.tabs) {
      if (this.hasLoadedContent(tab)) {
        remainingLoaded.push(tab);
      }
    }
    
    // If still over limit, close oldest non-active tabs
    if (remainingLoaded.length > this.maxOpenTabs) {
      const tabsToClose = [];
      for (const tab of remainingLoaded) {
        if (!tab.active) {
          tabsToClose.push(tab);
        }
      }
      
      tabsToClose.sort((a, b) => {
        const aTime = a.lastAccessed || a.createdAt || 0;
        const bTime = b.lastAccessed || b.createdAt || 0;
        return aTime - bTime;
      });
      
      const toClose = tabsToClose.slice(0, remainingLoaded.length - this.maxOpenTabs);
      for (const tab of toClose) {
        this.unloadTab(tab.id);
      }
    }
  };

  // Unload a tab (remove iframe but keep tab object)
  unloadTab = (id) => {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab || tab.active) return; // Never unload active tab
    
    // Remove iframe
    const f = document.getElementById(`iframe-${id}`);
    if (f) {
      // Stop tracking
      this.stopTrack(id);
      
      // Remove iframe from DOM
      f.remove();
      
      // Remove from frames
      if (this.frames[id]) {
        delete this.frames[id];
      }
    }
  };

  createIframes = () => {
    this.tabs.forEach((t) => {
      if (this.isChatUrl(t.url)) {
        // Create chat container instead of iframe
        if (!document.getElementById(`chat-${t.id}`)) {
          const chatContainer = document.createElement('div');
          chatContainer.id = `chat-${t.id}`;
          chatContainer.className = this.fCss;
          chatContainer.style.zIndex = 0;
          chatContainer.style.backgroundColor = '#ffffff';
          chatContainer.innerHTML = '<div class="chat-wrapper"></div>';
          this.ic.appendChild(chatContainer);
          // Initialize chat IMMEDIATELY when container is created (only if tab is active)
          if (window.lunaIntegration && t.active) {
            const spaceId = t.url.split('/').pop();
            // Inicializar inmediatamente sin delay para tabs activos
            window.lunaIntegration.initChat(t.id, spaceId);
          }
        }
      } else if (t.url && (t.url.startsWith('doge://ai-dashboard') || t.url.startsWith('luna://ai-dashboard'))) {
        // Create AI Dashboard container
        if (!document.getElementById(`dashboard-${t.id}`)) {
          const dashboardContainer = document.createElement('div');
          dashboardContainer.id = `dashboard-${t.id}`;
          dashboardContainer.className = this.fCss;
          dashboardContainer.style.zIndex = 0;
          dashboardContainer.style.backgroundColor = '#ffffff';
          dashboardContainer.style.display = 'flex';
          dashboardContainer.style.alignItems = 'center';
          dashboardContainer.style.justifyContent = 'center';
          dashboardContainer.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; flex-direction: column; gap: 16px; padding: 32px; text-align: center; max-width: 600px;">
              <div style="width: 80px; height: 80px; border-radius: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center;">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
                  <circle cx="12" cy="12" r="5"></circle>
                </svg>
              </div>
              <div>
                <h2 style="font-size: 28px; font-weight: 600; color: #202124; margin: 0 0 8px 0;">AI Dashboard</h2>
                <p style="color: #5f6368; margin: 0; font-size: 16px; line-height: 1.5;">${t.title || 'Custom Dashboard'}</p>
              </div>
              <p style="color: #9aa0a6; margin: 0; font-size: 14px; line-height: 1.5;">This dashboard will be available soon. You can create custom dashboards with AI-powered widgets.</p>
            </div>
          `;
          this.ic.appendChild(dashboardContainer);
        }
      } else {
        // Regular iframe for browser tabs
        // IMPORTANTE: NO crear iframes de Notion aquí - se crearán cuando se activen
        // Solo crear iframes para tabs no-Notion o si el tab está activo
        const isNotionUrl = t.url && (t.url.includes('silent-queen-f1d8.sebdiar.workers.dev') || 
                                       t.url.includes('notion.so') || 
                                       t.url.includes('notion.com'));
        // Para Notion, solo crear iframe si el tab está activo
        if (isNotionUrl && !document.getElementById(`iframe-${t.id}`)) {
          if (t.active) {
            // Convertir URL de Notion al Cloudflare Worker si es necesario
            let notionUrl = t.url;
            if (!notionUrl.includes('silent-queen-f1d8.sebdiar.workers.dev')) {
              // Convertir URL original de Notion al Cloudflare Worker
              notionUrl = this.formatInputUrl(notionUrl);
            }
            // Usar TYPE.notion para crear el iframe directamente
            TYPE.notion.create(notionUrl, this, t);
          }
          // Si no está activo, no crear el iframe todavía (se creará cuando se active)
        } else if (!document.getElementById(`iframe-${t.id}`)) {
          const f = document.createElement('iframe');
          f.id = `iframe-${t.id}`;
          f.className = this.fCss;
          f.style.zIndex = 0;
          if (this.isNewTab(t.url)) {
            f.src = t.url;
            f.onload = () => {
              try {
                contentObserver.unbind();
                contentObserver.bind();
              } catch {}
            };
          }
          this.ic.appendChild(f);
        }
      }
    });
    this.showActive();
  };

  back = () => {
    const activeTab = this.active();
    if (!activeTab) return;

    const hist = this.history.get(activeTab.id);
    if (!hist || hist.position <= 0) {
      return;
    }

    hist.position--;
    const decodedUrl = hist.urls[hist.position];
    if (decodedUrl) {
      const handler = TYPE[this.prType] || TYPE.scr;
      const iframe = document.getElementById(`iframe-${activeTab.id}`);
      handler.navigate(decodedUrl, this, activeTab, iframe);
      // Mostrar URL original si es Notion, sino el URL decodificado
      if (this.ui) {
        if (activeTab.originalUrl) {
          this.ui.value = activeTab.originalUrl;
        } else {
          this.ui.value = decodedUrl;
        }
      }
      this.emitNewFrame();
    }
  };

  forward = () => {
    const activeTab = this.active();
    if (!activeTab) return;

    const hist = this.history.get(activeTab.id);
    if (!hist || hist.position >= hist.urls.length - 1) {
      return;
    }

    hist.position++;
    const decodedUrl = hist.urls[hist.position];
    if (decodedUrl) {
      const handler = TYPE[this.prType] || TYPE.scr;
      const iframe = document.getElementById(`iframe-${activeTab.id}`);
      handler.navigate(decodedUrl, this, activeTab, iframe);
      // Mostrar URL original si es Notion, sino el URL decodificado
      if (this.ui) {
        if (activeTab.originalUrl) {
          this.ui.value = activeTab.originalUrl;
        } else {
          this.ui.value = decodedUrl;
        }
      }
      this.emitNewFrame();
    }
  };

  reload = () => {
    const activeTab = this.active();
    if (!activeTab) return;
    const iframe = document.getElementById(`iframe-${activeTab.id}`);
    if (!iframe) return;
    try {
      iframe.contentWindow.location.reload();
    } catch {
      // Silent fail - reload errors are usually not actionable
    }
  };

  navigate = (input) => {
    if (!input) return;
    this.updateUrl(input);
  };

  addLoadListener = (id) => {
    const f = document.getElementById(`iframe-${id}`);
    if (!f || f.hasListener) return;
    f.hasListener = true;
    f.addEventListener('load', () => {
      const t = this.tabs.find((t) => t.id === id);
      if (!t) return;
      try {
        const newUrl = f.contentWindow.location.href;
        if (newUrl && newUrl !== t.url && newUrl !== 'about:blank')
          this.updateTabMeta(t, f, newUrl);
      } catch {}
    });
  };

  checkStudentUrl = (id) => {
    const t = this.tabs.find((t) => t.id === id);
    const f = document.getElementById(`iframe-${id}`);
    if (!t?.url || !f || t.url === this.newTabUrl) return;
    try {
      const { href: newUrl } = f.contentWindow.location;
      if (newUrl && newUrl !== t.url && newUrl !== 'about:blank') {
        this.updateTabMeta(t, f, newUrl);
        contentObserver.unbind?.();
        contentObserver.bind?.();
      }
    } catch {
      this.addLoadListener(id);
    }
  };

  updateTabMeta = (t, f, newUrl) => {
    try {
      const doc = f.contentDocument || f.contentWindow.document;
      if (
        doc?.body?.innerText?.includes('Error processing your request') ||
        doc?.body?.innerText?.includes('Scramjet v2.0.0-alpha (build f9f5232)')
      ) {
        f.style.opacity = 0;
        f.contentWindow.location.reload();
        f.style.opacity = 1;
        return;
      }
    } catch {}

    const decodedUrl = this.ex(newUrl);
    const hist = this.history.get(t.id) || { urls: [decodedUrl], position: 0 };

    if (!this.history.has(t.id)) {
      this.history.set(t.id, hist);
    } else if (hist.urls[hist.position] !== decodedUrl) {
      hist.urls.length = hist.position + 1;
      hist.urls.push(decodedUrl);
      hist.position++;
    }

    // Preservar originalUrl si existe antes de actualizar
    const preservedOriginalUrl = t.originalUrl;
    
    t.url = newUrl;
    
    // Si el URL es del Cloudflare Worker pero no tiene originalUrl, generarlo
    if (t.url && t.url.includes('silent-queen-f1d8.sebdiar.workers.dev')) {
      // Solo generar originalUrl si no existe uno preservado
      if (!preservedOriginalUrl) {
        t.originalUrl = this.getOriginalNotionUrl(t.url);
      } else {
        // Restaurar el originalUrl preservado
        t.originalUrl = preservedOriginalUrl;
      }
    } else {
      // Si el URL cambió y ya no es del Worker, limpiar originalUrl
      t.originalUrl = null;
    }
    
    // Actualizar indicador del Cloudflare Worker si el tab está activo
    if (t.active) {
      this.updateNotionWorkerIndicator(t);
      // Actualizar URL en la barra si es Notion
      if (this.ui && t.originalUrl) {
        this.ui.value = t.originalUrl;
      } else if (this.ui) {
        this.ui.value = decodedUrl;
      }
    }

    // Solo actualizar título si NO tiene un título fijo
    // Lógica: Si el título actual es igual a la URL o al dominio, es dinámico
    // Si el título es diferente de la URL/dominio, es fijo (usuario lo especificó)
    const updateTitle = (tries = 10) => {
      const currentTitle = t.title || '';
      const currentUrl = t.url || '';
      const currentDomain = this.domain(currentUrl);
      const decodedUrl = this.ex(newUrl);
      const decodedDomain = this.domain(decodedUrl);
      
      // Si el título actual es igual a la URL o al dominio, es dinámico - actualizar
      // Si el título es diferente, fue especificado por el usuario - NO actualizar
      const isDynamicTitle = !currentTitle || 
                             currentTitle === currentUrl || 
                             currentTitle === decodedUrl ||
                             currentTitle === currentDomain ||
                             currentTitle === decodedDomain ||
                             currentTitle === 'New Tab' ||
                             currentTitle === 'Untitled';
      
      if (!isDynamicTitle) {
        // Mantener el título fijo - NO actualizar
        this.render();
        return;
      }
      
      // Si tiene título dinámico, actualizar dinámicamente como antes
      const ttl = f.contentDocument?.title?.trim();
      if (ttl) {
        t.title = ttl.length > 20 ? ttl.slice(0, 20) + '...' : ttl;
        this.render();
      } else if (tries > 0) {
        setTimeout(() => updateTitle(tries - 1), 100);
      } else {
        t.title = this.domain(newUrl);
        this.render();
      }
    };

    updateTitle();

    if (t.active && this.ui && t.url !== this.newTabUrl) {
      // Mostrar URL original si es Notion, sino el URL decodificado
      if (t.originalUrl) {
        this.ui.value = t.originalUrl;
      } else {
        this.ui.value = decodedUrl;
      }
      this.showBg(false);
      this.emitNewFrame();
    }
    
    // Actualizar indicador del Cloudflare Worker si el tab está activo
    if (t.active) {
      this.updateNotionWorkerIndicator(t);
    }
  };

  add = () => {
    this.tabs.forEach((t) => (t.active = false));
    const t = {
      id: this.nextId++,
      title: this.newTabTitle,
      url: this.newTabUrl,
      active: true,
      justAdded: true,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
    };
    this.tabs.push(t);
    this.render();
    this.createIframes();
    this.updateAddBtn();
    this.track(t.id);
    if (this.ui) this.ui.value = '';
    this.emitNewFrame();
  };

  close = (id) => {
    if (this.tabs.length === 0) return;
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    const wasActive = this.tabs[i].active;
    this.tabs.splice(i, 1);
    this.stopTrack(id);
    this.history.delete(id);
    // Cleanup frames (ScramJet y Notion)
    if (this.frames[id]) {
      delete this.frames[id];
    }
    document.getElementById(`iframe-${id}`)?.remove();
    document.getElementById(`chat-${id}`)?.remove();
    document.getElementById(`dashboard-${id}`)?.remove();
    if (wasActive) {
      const newIdx = Math.min(i, this.tabs.length - 1);
      this.tabs.forEach((t) => (t.active = false));
      this.tabs[newIdx].active = true;
      this.showActive();
      if (this.ui) {
        const nextTab = this.tabs[newIdx];
        if (this.isNewTab(nextTab.url) || this.isSpecialUrl(nextTab.url)) {
          this.ui.value = '';
        } else {
          // Mostrar URL original si es Notion, sino el URL decodificado
          if (nextTab.originalUrl) {
            this.ui.value = nextTab.originalUrl;
          } else {
            this.ui.value = this.ex(nextTab.url);
          }
        }
      }
      // Actualizar indicador del Cloudflare Worker
      this.updateNotionWorkerIndicator(this.tabs[newIdx]);
      this.emitNewFrame();
    }
    this.render();
    this.updateAddBtn();
    this.updateWidths();
  };

  activate = (id, forceLoad = false) => {
    // Si ya está activo y no forzamos la carga, solo retornar
    // Pero si forceLoad es true, continuar para asegurar que se carga la URL
    if (this.active()?.id === id && !forceLoad) return;
    this.tabs.forEach((t) => (t.active = t.id === id));
    this.render();
    this.showActive();
    
    const activeTab = this.active();
    if (this.ui) {
      // Don't show URL for special URLs (chat, AI dashboard, etc.)
      if (activeTab && !this.isNewTab(activeTab.url) && !this.isSpecialUrl(activeTab.url)) {
        // Mostrar URL original si es Notion, sino el URL decodificado
        if (activeTab.originalUrl) {
          this.ui.value = activeTab.originalUrl;
        } else {
          this.ui.value = this.ex(activeTab.url);
        }
      } else {
        this.ui.value = '';
      }
    }
    
    // IMPORTANTE: Convertir URLs de Notion ANTES de cualquier otra lógica
    // Esto asegura que detectemos Notion correctamente incluso si url es "NEWTAB.COM"
    // Verificar también el título del tab, ya que puede contener información de Notion
    if (activeTab) {
      // Verificar si el tab tiene originalUrl (para tabs guardados de Notion)
      if (activeTab.originalUrl) {
        const notionPattern = /(https?:\/\/)?([a-zA-Z0-9-]+\.)?notion\.(so|com)(\/[^\s]*)?/i;
        if (notionPattern.test(activeTab.originalUrl)) {
          // Si originalUrl es Notion pero url no lo es, convertir url
          if (!activeTab.url.includes('silent-queen-f1d8.sebdiar.workers.dev') && 
              !activeTab.url.includes('notion.so') && 
              !activeTab.url.includes('notion.com')) {
            activeTab.url = this.formatInputUrl(activeTab.originalUrl);
          }
        }
      }
      
      // Verificar si es Notion usando pattern matching (más robusto)
      if (activeTab.url) {
        const notionPattern = /(https?:\/\/)?([a-zA-Z0-9-]+\.)?notion\.(so|com)(\/[^\s]*)?/i;
        const isNotionPattern = notionPattern.test(activeTab.url);
        
        // Si es Notion pero no tiene originalUrl, guardarlo
        if (isNotionPattern && !activeTab.originalUrl) {
          activeTab.originalUrl = activeTab.url.startsWith('http') ? activeTab.url : 'https://' + activeTab.url;
        }
        
        // Si es Notion y no está en formato Worker, convertirla
        if (isNotionPattern && !activeTab.url.includes('silent-queen-f1d8.sebdiar.workers.dev')) {
          activeTab.url = this.formatInputUrl(activeTab.url);
        }
      }
      
      // Si el tab ya tiene URL del Cloudflare Worker pero no tiene originalUrl, generarlo
      if (activeTab.url && activeTab.url.includes('silent-queen-f1d8.sebdiar.workers.dev') && !activeTab.originalUrl) {
        activeTab.originalUrl = this.getOriginalNotionUrl(activeTab.url);
      }
      
      // Verificar también el título del tab (puede contener información de Notion)
      // Si el título sugiere que es Notion pero la URL no, intentar recuperar la URL
      if (activeTab.title && (activeTab.title.toLowerCase().includes('notion') || activeTab.title.includes('Bas'))) {
        // Si no tenemos una URL válida de Notion, pero el título sugiere que es Notion
        // y tenemos originalUrl, usarlo
        if (activeTab.originalUrl && !activeTab.url.includes('silent-queen-f1d8.sebdiar.workers.dev')) {
          const notionPattern = /(https?:\/\/)?([a-zA-Z0-9-]+\.)?notion\.(so|com)(\/[^\s]*)?/i;
          if (notionPattern.test(activeTab.originalUrl)) {
            activeTab.url = this.formatInputUrl(activeTab.originalUrl);
          }
        }
      }
    }
    
    // Actualizar indicador del Cloudflare Worker
    this.updateNotionWorkerIndicator(activeTab);
    
    // Auto-navigate to tab's URL if not already loaded (OPTIMIZED)
    // Si es chat, inicializar inmediatamente
    if (activeTab && this.isChatUrl(activeTab.url)) {
      const chatContainer = document.getElementById(`chat-${activeTab.id}`);
      if (chatContainer) {
        // Inicializar chat inmediatamente si no está inicializado
        if (!chatContainer.querySelector('.chat-container')) {
          const spaceId = activeTab.url.split('/').pop();
          if (window.lunaIntegration) {
            window.lunaIntegration.initChat(activeTab.id, spaceId);
          }
        }
      } else {
        // Crear container e inicializar
        this.createIframes();
        const newChatContainer = document.getElementById(`chat-${activeTab.id}`);
        if (newChatContainer && window.lunaIntegration) {
          const spaceId = activeTab.url.split('/').pop();
          window.lunaIntegration.initChat(activeTab.id, spaceId);
        }
      }
    } else if (activeTab && !this.isNewTab(activeTab.url) && !this.isSpecialUrl(activeTab.url)) {
      let f = document.getElementById(`iframe-${activeTab.id}`);
      
      // IMPORTANTE: Usar originalUrl si existe (para Notion), sino usar url
      // Esto asegura que detectemos Notion correctamente incluso si url es "NEWTAB.COM"
      const urlToCheck = activeTab.originalUrl || activeTab.url;
      
      // Detectar si es Notion para usar TYPE.notion directamente
      // Verificar tanto la URL original como la URL actual
      const isNotionUrl = urlToCheck && (urlToCheck.includes('silent-queen-f1d8.sebdiar.workers.dev') || 
                                         urlToCheck.includes('notion.so') || 
                                         urlToCheck.includes('notion.com')) ||
                          (activeTab.url && (activeTab.url.includes('silent-queen-f1d8.sebdiar.workers.dev') || 
                                             activeTab.url.includes('notion.so') || 
                                             activeTab.url.includes('notion.com')));
      
      // Si el iframe no existe, crearlo primero
      if (!f && (activeTab.url || activeTab.originalUrl)) {
        if (isNotionUrl) {
          // Para Notion, crear el iframe directamente usando TYPE.notion
          let notionUrl = activeTab.url || activeTab.originalUrl;
          // Si la URL no es del Worker, convertirla
          if (notionUrl && !notionUrl.includes('silent-queen-f1d8.sebdiar.workers.dev')) {
            notionUrl = this.formatInputUrl(notionUrl);
          }
          if (notionUrl) {
            TYPE.notion.create(notionUrl, this, activeTab);
            f = document.getElementById(`iframe-${activeTab.id}`);
          }
        } else {
          // Para otros tipos, usar createIframes
          this.createIframes();
          f = document.getElementById(`iframe-${activeTab.id}`);
        }
      }
      
      if (f && (activeTab.url || activeTab.originalUrl)) {
        
        // Si es Notion, convertir URL al Cloudflare Worker si es necesario
        // Usar originalUrl si existe, sino usar url
        let urlToNavigate = activeTab.originalUrl || activeTab.url;
        if (isNotionUrl && urlToNavigate && !urlToNavigate.includes('silent-queen-f1d8.sebdiar.workers.dev')) {
          urlToNavigate = this.formatInputUrl(urlToNavigate);
        }
        
        const currentSrc = f.src || '';
        // IMPORTANTE: Prevenir múltiples navegaciones para Notion
        // Solo navegar si el iframe está vacío o si la URL cambió realmente
        const shouldNavigate = !currentSrc || 
                              currentSrc === '/new' || 
                              currentSrc === 'tabs://new' || 
                              (isNotionUrl && currentSrc !== urlToNavigate && !currentSrc.includes('silent-queen-f1d8.sebdiar.workers.dev')) ||
                              (!isNotionUrl && !currentSrc.includes('http') && !currentSrc.includes('scramjet') && !currentSrc.includes('uv/service'));
        
        if (shouldNavigate) {
          // IMPORTANTE: Para Notion, SIEMPRE usar TYPE.notion (NO TYPE.auto que podría usar ScramJet)
          const handler = isNotionUrl ? TYPE.notion : (TYPE[this.prType] || TYPE.auto);
          handler.navigate(urlToNavigate, this, activeTab, f);
          // Asegurar que el iframe esté visible después de navegar (especialmente importante para Notion)
          if (isNotionUrl) {
            this.setFrameState(activeTab.id, true);
          }
        } else {
          // Si no necesita navegar, asegurar que el iframe esté visible
          this.setFrameState(activeTab.id, true);
        }
      } else if (activeTab.url && !f) {
        // Si aún no existe el iframe después de createIframes, crear uno directamente
        // Detectar si es Notion para usar TYPE.notion directamente
        const isNotionUrl = activeTab.url && (activeTab.url.includes('silent-queen-f1d8.sebdiar.workers.dev') || 
                                               activeTab.url.includes('notion.so') || 
                                               activeTab.url.includes('notion.com'));
        
        // Si es Notion, convertir URL al Cloudflare Worker si es necesario
        let urlToCreate = activeTab.url;
        if (isNotionUrl && !activeTab.url.includes('silent-queen-f1d8.sebdiar.workers.dev')) {
          urlToCreate = this.formatInputUrl(activeTab.url);
        }
        
        const handler = isNotionUrl ? TYPE.notion : (TYPE[this.prType] || TYPE.auto);
        handler.create(urlToCreate, this, activeTab);
      }
    }
    
    // Update last accessed time for memory management
    if (activeTab) {
      activeTab.lastAccessed = Date.now();
    }
    
    // Enforce memory limits ASYNC (don't block navigation)
    setTimeout(() => this.enforceMemoryLimits(), 0);
    
    this.emitNewFrame();
  };

  returnMeta = () => {
    const t = this.active();
    if (!t) return { name: '', url: '' };
    // Mostrar URL original si es Notion, sino el URL decodificado
    let url = '';
    if (t.url && !this.isNewTab(t.url) && !this.isSpecialUrl(t.url)) {
      url = t.originalUrl || this.ex(t.url);
    }
    return { name: t.title || '', url };
  };

  emitNewFrame = () => {
    const t = this.active();
    const meta = this.returnMeta();
    const detail = { ...meta, tabId: t?.id };
    const ev = new CustomEvent('newFrame', { detail });
    try {
      document.dispatchEvent(ev);
    } catch (err) {}
    try {
      window.dispatchEvent(ev);
    } catch (err) {}
  };

  updateUrl = async (input) => {
    if (!input) return;
    const t = this.active();
    if (!t) return;
    
    // Don't navigate special URLs (luna://, doge://, tabs://) - they are handled separately
    if (this.isSpecialUrl(input)) {
      return;
    }
    
    if (this.unsupported.some((s) => input.includes(s))) {
      alert(`The website "${input}" is not supported at this time`);
      return;
    }

    // Update last accessed time when navigating
    t.lastAccessed = Date.now();

    if (input === 'tabs://new') {
      document.getElementById(`iframe-${t.id}`)?.remove();
      const f = document.createElement('iframe');
      f.id = `iframe-${t.id}`;
      f.className = this.fCss;
      f.style.zIndex = 10;
      f.style.opacity = '1';
      f.style.pointerEvents = 'auto';
      f.src = this.newTabUrl;
      this.ic.appendChild(f);
      t.url = this.newTabUrl;
      t.title = this.newTabTitle;
      if (this.ui) this.ui.value = '';
      f.onload = () => {
        try {
          contentObserver.unbind();
          contentObserver.bind();
        } catch {}
      };
      this.showActive();
      this.render();
      return;
    }

    const url = this.formatInputUrl(input);
    
    // Guardar URL original si es Notion
    const notionPattern = /(https?:\/\/)?([a-zA-Z0-9-]+\.)?notion\.(so|com)(\/[^\s]*)?/i;
    if (notionPattern.test(input)) {
      t.originalUrl = input.startsWith('http') ? input : 'https://' + input;
    } else {
      t.originalUrl = null;
    }
    
    // Detectar si es Notion para usar TYPE.notion directamente
    const isNotionUrl = url.includes('silent-queen-f1d8.sebdiar.workers.dev') || 
                        url.includes('notion.so') || 
                        url.includes('notion.com');
    
    this.showBg(false);
    // Si es Notion, usar TYPE.notion directamente (NO TYPE.auto que podría usar ScramJet)
    const handler = isNotionUrl ? TYPE.notion : (TYPE[this.prType] || TYPE.auto);
    
    const f = document.getElementById(`iframe-${t.id}`);
    if (this.isNewTab(t.url)) {
      document.getElementById(`iframe-${t.id}`)?.remove();
      handler.create(url, this, t);
    } else handler.navigate(url, this, t, f);

    t.url = url;
    try {
      // Don't extract title from special URLs
      if (this.isSpecialUrl(url)) {
        t.title = t.title || input;
      } else {
        t.title = new URL(url).hostname.replace('www.', '');
      }
    } catch {
      t.title = input;
    }
    
    // Mostrar URL original en la barra si es Notion
    if (this.ui && t.originalUrl) {
      this.ui.value = t.originalUrl;
    } else if (this.ui) {
      this.ui.value = this.ex(url);
    }
    
    // Actualizar indicador del Cloudflare Worker
    this.updateNotionWorkerIndicator(t);
    
    this.showActive();
    this.render();
    if (t.active) this.emitNewFrame();
  };

  getTabWidth = () => {
    // No longer needed for vertical sidebar - tabs are full width
    return 0;
  };

  updateWidths = () => {
    // No longer needed for vertical sidebar - tabs are full width
  };

  updateAddBtn = () => {
    // No restrictions - always allow adding tabs
    this.ab.disabled = false;
    this.ab.classList.remove('opacity-50', 'cursor-not-allowed');
    this.ab.classList.add('hover:bg-[#b6bfc748]', 'active:bg-[#d8e4ee6e]');
    this.ab.title = 'Add new tab';
  };

  // UNIFIED TAB TEMPLATE - usado en sidebar Y TopBar
  tabTemplate = (t, showMenu = true, isTopBar = false) => {
    // Get icon - prioritize custom avatar over favicon
    let iconHtml = '';
    let hasCustomIcon = false;
    const isChat = this.isChatUrl(t.url);
    const isDashboard = t.url?.startsWith('luna://ai-dashboard') || t.url?.startsWith('doge://ai-dashboard');
    const isNotion = t.url && (t.url.includes('notion.so') || t.url.includes('notion.com') || t.url.includes('silent-queen-f1d8.sebdiar.workers.dev'));
    
    // Check for custom avatar first (from backend)
    if (t.avatar_photo) {
      iconHtml = `<img src="${t.avatar_photo}" alt="" class="w-full h-full rounded-full object-cover" />`;
      hasCustomIcon = true;
    } else if (t.avatar_emoji) {
      iconHtml = `<span class="text-sm">${t.avatar_emoji}</span>`;
      hasCustomIcon = true;
    }
    
    // If no custom avatar, try favicon for regular URLs
    // For Notion tabs, prioritize the custom favicon from the page
    if (!hasCustomIcon && !isChat && !isDashboard) {
      try {
        const url = t.url;
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          // For Notion tabs, use the custom favicon if available
          if (isNotion && t.favicon) {
            const faviconSize = isTopBar ? 'w-3 h-3' : 'w-4 h-4';
            iconHtml = `<img src="${t.favicon}" alt="" class="${faviconSize} object-contain rounded" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='block';" />`;
            hasCustomIcon = true;
          } else {
            // For other URLs, use Google's favicon service
            // Para Notion, usar el dominio original (notion.so) en lugar del Worker
            let domainForFavicon = url;
            if (isNotion && t.originalUrl) {
              domainForFavicon = t.originalUrl;
            } else if (isNotion) {
              // Si no hay originalUrl, usar notion.so como fallback
              domainForFavicon = 'https://www.notion.so';
            }
            const urlObj = new URL(domainForFavicon);
            // TopBar: icono más pequeño para mantener ratio con círculo w-4 h-4
            const faviconSize = isTopBar ? 'w-3 h-3' : 'w-4 h-4';
            iconHtml = `<img src="https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32" alt="" class="${faviconSize} object-contain" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='block';" />`;
            hasCustomIcon = true;
          }
        }
      } catch {}
    }
    
    // Special icons for chat and dashboard
    // TopBar: iconos más pequeños (12px) para mantener ratio con círculo w-4 h-4 (16px)
    // Sidebar: iconos normales (16px) para círculo w-6 h-6 (24px)
    const svgSize = isTopBar ? '12' : '16';
    if (isChat) {
      iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgSize}" height="${svgSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-[#4285f4]"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
      hasCustomIcon = true;
    } else if (isDashboard) {
      iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgSize}" height="${svgSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-[#4285f4]"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="9" x2="9" y1="21" y2="9"/></svg>`;
      hasCustomIcon = true;
    }
    
    // Default icon if nothing else
    if (!hasCustomIcon) {
      const defaultSvgSize = isTopBar ? '12' : '14';
      iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="${defaultSvgSize}" height="${defaultSvgSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9" x2="15" y1="15" y2="15"/></svg>`;
    }
    
    // Determine border color for icon container
    const borderColor = t.avatar_color || '#e8eaed';
    const iconColor = t.avatar_color || '#6b7280';
    
    // Tamaños adaptativos: TopBar más pequeño y minimalista, sidebar compacto con círculo un poco más grande
    const iconSize = isTopBar ? 'w-4 h-4' : 'w-6 h-6'; // TopBar más pequeño: w-4 h-4
    const textSize = isTopBar ? 'text-[10px]' : 'text-xs'; // TopBar más pequeño: text-[10px]
    const padding = isTopBar ? 'px-1.5 py-0.5' : 'px-2 py-1.5'; // TopBar más compacto: px-1.5 py-0.5
    const gap = isTopBar ? 'gap-1' : 'gap-2'; // TopBar más compacto: gap-1
    const maxWidth = isTopBar ? 'max-w-[80px]' : '';
    
    // Menu button (3 dots) - siempre disponible cuando showMenu es true
    const menuButton = showMenu ? `
      <button class="tab-menu-btn shrink-0 p-0.5 opacity-0 group-hover:opacity-100 hover:text-[#202124] transition-opacity relative" data-tab-id="${t.id}" ${t.backendId ? `data-backend-id="${t.backendId}"` : ''} title="Menu">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="1"></circle>
          <circle cx="12" cy="5" r="1"></circle>
          <circle cx="12" cy="19" r="1"></circle>
        </svg>
      </button>
    ` : '';
    
    return `
    <div ${t.justAdded ? 'data-m="bounce-up" data-m-duration="0.2"' : ''} 
         class="tab-item group relative flex items-center ${gap} ${padding} rounded-lg cursor-pointer transition-all ${
           t.active
             ? 'bg-[#4285f4]/10 text-[#4285f4] font-medium shadow-sm'
             : 'text-[#202124] hover:bg-[#e8eaed]'
         }" 
         data-tab-id="${t.id}"
         ${t.backendId ? `data-sortable-id="${t.backendId}"` : ''}>
      <div class="${iconSize} rounded-full flex items-center justify-center flex-shrink-0" style="border: 1px solid ${borderColor}; color: ${iconColor}">
        ${iconHtml}
      </div>
      <span class="flex-1 ${textSize} truncate ${maxWidth}" title="${this.escapeHTML(t.title)}">${this.escapeHTML(t.title)}</span>
      ${menuButton}
    </div>`.trim();
  };

  render = (() => {
    // Debounce mechanism to prevent excessive DOM updates
    let renderTimeout = null;
    let lastRenderTime = 0;
    const RENDER_DEBOUNCE_MS = 16; // ~60fps max

    const doRender = () => {
      // Filtrar tabs: si hay un espacio activo, NO mostrar los tabs del espacio en el sidebar
      // (solo se muestran en el TopBar para evitar duplicados visuales)
      // TAMBIÉN: NUNCA mostrar tabs de chat en el sidebar externo (solo en TopBar)
      let tabsToShow = this.tabs;
      if (window.lunaIntegration && window.lunaIntegration.activeSpace) {
        // Cuando hay un espacio activo, solo mostrar tabs personales (sin spaceId) en sidebar
        // Los tabs de proyectos (con spaceId) solo se muestran en TopBar
        tabsToShow = this.tabs.filter(t => {
          const tUrl = t.url || '';
          
          // Permitir tabs especiales (/new, tabs://new) solo si no tienen spaceId
          if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') {
            return !t.spaceId;
          }
          
          // NUNCA mostrar tabs de chat en sidebar externo
          if (this.isChatUrl(tUrl)) return false;
          
          // Si el tab tiene spaceId (de CUALQUIER proyecto), NO mostrarlo en sidebar
          // Los tabs de proyectos solo se muestran en TopBar de su proyecto correspondiente
          if (t.spaceId) {
            return false;
          }
          
          // Solo mostrar tabs personales (sin spaceId)
          return true;
        });
      } else {
        // Sin espacio activo: mostrar solo tabs personales (sin spaceId)
        // NUNCA mostrar chats en sidebar externo
        tabsToShow = this.tabs.filter(t => {
          const tUrl = t.url || '';
          if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') {
            // Permitir tabs especiales solo si no tienen spaceId
            return !t.spaceId;
          }
          
          // NUNCA mostrar chats
          if (this.isChatUrl(tUrl)) return false;
          
          // Solo mostrar tabs personales (sin spaceId)
          return !t.spaceId;
        });
      }
      
      // Excluir tabs que están en "More" dropdown (desktop)
      // Usar localStorage para persistencia
      let visibleTabs = tabsToShow;
      if (window.lunaIntegration && window.lunaIntegration.getDesktopMoreTabIdsSync) {
        const moreTabIds = window.lunaIntegration.getDesktopMoreTabIdsSync();
        if (moreTabIds.size > 0) {
          visibleTabs = tabsToShow.filter(t => {
            // Normalize to string for consistent comparison
            const tabId = String(t.backendId || t.id);
            return !moreTabIds.has(tabId);
          });
        }
      }

      // USAR EL MISMO template unificado (showMenu=true para sidebar, isTopBar=false)
      // Este es el ÚNICO código que genera tabs - usado en sidebar Y TopBar
      this.tc.innerHTML = visibleTabs.map((t) => this.tabTemplate(t, true, false)).join('');

      // Setup menu handlers para sidebar tabs
      this.tc.querySelectorAll('.tab-menu-btn').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const tabId = +btn.dataset.tabId;
          const tab = this.tabs.find(t => t.id === tabId);
          if (tab && window.lunaIntegration) {
            // Si tiene backendId, obtener datos actualizados del backend
            if (tab.backendId) {
              try {
                const response = await window.lunaIntegration.request(`/api/tabs/${tab.backendId}`);
                window.lunaIntegration.showTabMenu(e, response.tab);
              } catch (err) {
                // Si falla, usar datos del tab actual
                const backendTab = {
                  id: tab.backendId,
                  title: tab.title,
                  url: tab.url,
                  bookmark_url: tab.url,
                  avatar_emoji: tab.avatar_emoji,
                  avatar_color: tab.avatar_color,
                  avatar_photo: tab.avatar_photo,
                  cookie_container_id: tab.cookie_container_id
                };
                window.lunaIntegration.showTabMenu(e, backendTab);
              }
            } else {
              // Tab sin backendId (tab nuevo o local) - crear en backend primero si es necesario
              const backendTab = {
                id: null, // No tiene backendId aún
                title: tab.title,
                url: tab.url,
                bookmark_url: tab.url,
                avatar_emoji: tab.avatar_emoji,
                avatar_color: tab.avatar_color,
                avatar_photo: tab.avatar_photo,
                cookie_container_id: tab.cookie_container_id
              };
              window.lunaIntegration.showTabMenu(e, backendTab);
            }
          }
        };
      });

      this.tabs.forEach((t) => delete t.justAdded);
      
      // Update mobile bottom bar if on mobile (debounced to avoid excessive updates)
      if (window.mobileUI && window.mobileUI.isMobile && window.mobileUI.isMobile()) {
        if (window.lunaIntegration && window.lunaIntegration.renderMobileBottomBar) {
          window.lunaIntegration.renderMobileBottomBar();
        }
      }
    };

    // Return debounced render function
    return function () {
      const now = Date.now();
      if (renderTimeout) {
        clearTimeout(renderTimeout);
      }
      
      // If enough time has passed, render immediately
      if (now - lastRenderTime >= RENDER_DEBOUNCE_MS) {
        lastRenderTime = now;
        doRender.call(this);
      } else {
        // Otherwise, schedule a render
        renderTimeout = setTimeout(() => {
          lastRenderTime = Date.now();
          doRender.call(this);
        }, RENDER_DEBOUNCE_MS);
      }
    };
  })();
}

window.addEventListener('load', async () => {
  window.scr = null;
  const { ScramjetController } = $scramjetLoadController();
  const connection = new BareMuxConnection('/baremux/worker.js');
  const { log, warn, error } = logUtils;

  const getOption = (key, fallback) => {
    const item = JSON.parse(localStorage.getItem('options') || '{}')[key];
    return item !== '' && item ? item : fallback;
  };

  const ws = getOption('wServer', CONFIG.ws);
  const transport = CONFIG.transport;
  let c = self.__uv$config;

  const setTransport = async () => {
    try {
      await connection.setTransport(transport, [{ wisp: ws }]);
      log(`Set transport: ${transport}`);
    } catch (e) {
      error('setTransport failed:', e);
      throw e;
    }
  };

  await setTransport();

  window.scr = new ScramjetController({
    files: {
      wasm: '/scram/scramjet.wasm.wasm',
      all: '/scram/scramjet.all.js',
      sync: '/scram/scramjet.sync.js',
    },
    flags: { rewriterLogs: false, scramitize: false, cleanErrors: true, sourcemaps: true },
  });

  try {
    await scr.init();
    log('scr.init() complete');
  } catch (err) {
    error('scr.init() failed:', err);
    throw err;
  }

  const sws = [{ path: '/s_sw.js', scope: '/scramjet/' }, { path: '/uv/sw.js' }];

  for (const sw of sws) {
    try {
      await navigator.serviceWorker.register(sw.path, sw.scope ? { scope: sw.scope } : undefined);
    } catch (err) {
      warn(`SW reg err (${sw.path}):`, err);
    }
  }

  await setTransport();

  let tabManager;
  try {
    tabManager = new TabManager([c.encodeUrl, c.decodeUrl]);
  } catch (err) {
    error('TabManager init failed:', err);
    throw err;
  }

  // Get URL from query params or sessionStorage
  const urlParams = new URLSearchParams(window.location.search);
  const queryUrl = urlParams.get('url') || sessionStorage.getItem('query');
  
  if (queryUrl && queryUrl !== 'tabs://new') {
    // If there's a URL, navigate to it
    if (tabManager.tabs[0].url === '/new' || tabManager.tabs[0].url === 'tabs://new') {
      tabManager.updateUrl(queryUrl);
    } else {
      tabManager.navigate(queryUrl);
    }
    sessionStorage.removeItem('query');
  }

  setInterval(setTransport, 30000);

  const domMap = {
    'n-bk': () => tabManager.back(),
    'n-fw': () => tabManager.forward(),
    'n-rl': () => tabManager.reload(),
    'settings-btn': () => {
      // Navigate to settings page
      window.parent.postMessage({ action: 'navigate', to: '/settings' }, '*');
    },
  };

  Object.entries(domMap).forEach(([id, fn]) =>
    document.getElementById(id)?.addEventListener('click', fn),
  );

  const bookmarkBtn = document.getElementById('bookmark-btn');
  if (bookmarkBtn) {
    bookmarkBtn.addEventListener('click', () => {
    const bookmark = document.getElementById('bookmark');
    const setBookmark = (add) => {
      const old = JSON.parse(localStorage.getItem('options'));
      const metaInfo = tabManager.returnMeta();
      const result = {
        ...old,
        quickLinks: add
          ? [...old.quickLinks, { link: metaInfo.url, icon: 'null', name: metaInfo.name }]
          : old.quickLinks.filter((q) => !(q.link === metaInfo.url && q.name === metaInfo.name)),
      };
      localStorage.setItem('options', JSON.stringify(result));
    };

    if (bookmark.getAttribute('fill') === 'currentColor') {
      bookmark.setAttribute('fill', 'none');
      setBookmark(false);
    } else {
      bookmark.setAttribute('fill', 'currentColor');
      setBookmark(true);
    }
    });
  }

  document.addEventListener('newFrame', (e) => {
    const bookmark = document.getElementById('bookmark');
    const options = JSON.parse(localStorage.getItem('options')) || { quickLinks: [] };
    const quickLinks = options.quickLinks || [];
    if (bookmark) {
      bookmark.setAttribute(
        'fill',
        quickLinks.some((q) => q.link === e.detail.url) ? 'currentColor' : 'none',
      );
    }
  });

  // Setup menu button and popover
  const menuBtn = document.getElementById('menu-btn');
  const menuPopover = document.getElementById('menu-popover');
  
  if (menuBtn && menuPopover) {
    // Prevent default popover behavior and use manual toggle
    menuBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      const isOpen = menuPopover.getAttribute('aria-hidden') === 'false';
      if (isOpen) {
        menuPopover.setAttribute('aria-hidden', 'true');
        menuBtn.setAttribute('aria-expanded', 'false');
      } else {
        // Close any other open menus first
        document.querySelectorAll('[id^="menu-popover"], [id^="tab-menu-dropdown"]').forEach(menu => {
          if (menu !== menuPopover) {
            menu.setAttribute('aria-hidden', 'true');
          }
        });
        
        menuPopover.setAttribute('aria-hidden', 'false');
        menuBtn.setAttribute('aria-expanded', 'true');
      }
    }, true); // Use capture phase to ensure it runs first

    // Close menu when clicking outside
    const closeMenuOnOutsideClick = (e) => {
      if (menuPopover && menuPopover.getAttribute('aria-hidden') === 'false') {
        if (!menuBtn.contains(e.target) && !menuPopover.contains(e.target)) {
          menuPopover.setAttribute('aria-hidden', 'true');
          menuBtn.setAttribute('aria-expanded', 'false');
        }
      }
    };
    
    // Use capture phase for outside click detection
    document.addEventListener('click', closeMenuOnOutsideClick, true);
    document.addEventListener('mousedown', closeMenuOnOutsideClick, true);
  }

  // Setup toggle for proxy indicator
  const toggleProxyIndicator = document.getElementById('toggle-proxy-indicator');
  const proxyIndicatorStatus = document.getElementById('proxy-indicator-status');
  
  // Function to update the status display
  const updateProxyIndicatorStatus = () => {
    const isEnabled = localStorage.getItem('showProxyIndicator') === 'true';
    if (proxyIndicatorStatus) {
      proxyIndicatorStatus.textContent = isEnabled ? 'ON' : 'OFF';
      proxyIndicatorStatus.style.color = isEnabled ? '#10b981' : '#6b7280';
    }
    // Update indicator immediately if tab is active
    if (tabManager && tabManager.active()) {
      tabManager.updateNotionWorkerIndicator(tabManager.active());
    }
  };

  if (toggleProxyIndicator) {
    // Initialize status display
    updateProxyIndicatorStatus();
    
    // Add click handler
    toggleProxyIndicator.addEventListener('click', () => {
      const currentValue = localStorage.getItem('showProxyIndicator') === 'true';
      localStorage.setItem('showProxyIndicator', (!currentValue).toString());
      updateProxyIndicatorStatus();
      
      // Close menu after toggle
      if (menuPopover) {
        menuPopover.setAttribute('aria-hidden', 'true');
      }
      if (menuBtn) {
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }
});
