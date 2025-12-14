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

  auto: {
    create: (url, manager, tab) => {
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
      this.ui.value = this.tabs.length > 0 && !this.isNewTab(this.tabs[0].url) ? this.tabs[0].url : '';
      this.ui.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = this.ui.value.trim();
          this.updateUrl(val);
          if (val !== 'tabs://new') this.ui.value = this.formatInputUrl(val);
          this.ui.blur();
        }
      });
    }

    window.addEventListener('resize', () => {
      this.updateAddBtn();
      this.updateWidths();
    });

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

  formatInputUrl = (input, search = this.search) =>
    /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/[^\s]*)?$/i.test(input)
      ? /^https?:\/\//.test(input)
        ? input
        : 'https://' + input
      : search + encodeURIComponent(input);

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
      f.style.zIndex = active ? 10 : 0;
      f.style.opacity = active ? '1' : '0';
      f.style.pointerEvents = active ? 'auto' : 'none';
      f.classList.toggle('f-active', active);
    }
    
    if (chatContainer) {
      chatContainer.style.zIndex = active ? 10 : 0;
      chatContainer.style.opacity = active ? '1' : '0';
      chatContainer.style.pointerEvents = active ? 'auto' : 'none';
      chatContainer.classList.toggle('f-active', active);
    }
    
    if (dashboardContainer) {
      dashboardContainer.style.zIndex = active ? 10 : 0;
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
    } else if (urlBar && !activeTab) {
      urlBar.style.display = 'flex';
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
        if (!document.getElementById(`iframe-${t.id}`)) {
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
      if (this.ui) this.ui.value = decodedUrl;
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
      if (this.ui) this.ui.value = decodedUrl;
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

    t.url = newUrl;

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
      this.ui.value = decodedUrl;
      this.showBg(false);
      this.emitNewFrame();
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
          this.ui.value = this.ex(nextTab.url);
        }
      }
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
        this.ui.value = this.ex(activeTab.url);
      } else {
        this.ui.value = '';
      }
    }
    
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
      
      // Si el iframe no existe, crearlo primero
      if (!f && activeTab.url) {
        // Crear el iframe usando createIframes (que maneja chat, dashboard, etc.)
        this.createIframes();
        f = document.getElementById(`iframe-${activeTab.id}`);
      }
      
      if (f && activeTab.url) {
        const currentSrc = f.src || '';
        // Quick check: only navigate if clearly empty/placeholder
        if (!currentSrc || currentSrc === '/new' || currentSrc === 'tabs://new') {
          const handler = TYPE[this.prType] || TYPE.auto;
          handler.navigate(activeTab.url, this, activeTab, f);
        } else if (!currentSrc.includes('http') && !currentSrc.includes('scramjet') && !currentSrc.includes('uv/service')) {
          // Only do expensive check if src doesn't look like a URL
          const handler = TYPE[this.prType] || TYPE.auto;
          handler.navigate(activeTab.url, this, activeTab, f);
        }
      } else if (activeTab.url && !f) {
        // Si aún no existe el iframe después de createIframes, crear uno directamente
        const handler = TYPE[this.prType] || TYPE.auto;
        handler.create(activeTab.url, this, activeTab);
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
    // Don't return URL for special URLs (chat, AI dashboard, etc.)
    const url = t.url && !this.isNewTab(t.url) && !this.isSpecialUrl(t.url) ? this.ex(t.url) : '';
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
    this.showBg(false);
    const handler = TYPE[this.prType] || TYPE.auto;
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
      
      // Check for custom avatar first (from backend)
      if (t.avatar_photo) {
        iconHtml = `<img src="${t.avatar_photo}" alt="" class="w-full h-full rounded-full object-cover" />`;
        hasCustomIcon = true;
      } else if (t.avatar_emoji) {
        iconHtml = `<span class="text-sm">${t.avatar_emoji}</span>`;
        hasCustomIcon = true;
      }
      
      // If no custom avatar, try favicon for regular URLs
      if (!hasCustomIcon && !isChat && !isDashboard) {
        try {
          const url = t.url;
          if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            const urlObj = new URL(url);
            iconHtml = `<img src="https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32" alt="" class="w-4 h-4 object-contain" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='block';" />`;
            hasCustomIcon = true;
          }
        } catch {}
      }
      
      // Special icons for chat and dashboard
      if (isChat) {
        iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-[#4285f4]"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
        hasCustomIcon = true;
      } else if (isDashboard) {
        iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-[#4285f4]"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="9" x2="9" y1="21" y2="9"/></svg>`;
        hasCustomIcon = true;
      }
      
      // Default icon if nothing else
      if (!hasCustomIcon) {
        iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9" x2="15" y1="15" y2="15"/></svg>`;
      }
      
      // Determine border color for icon container
      const borderColor = t.avatar_color || '#e8eaed';
      const iconColor = t.avatar_color || '#6b7280';
      
      // Tamaños adaptativos: TopBar más pequeño, sidebar compacto con círculo un poco más grande
      const iconSize = isTopBar ? 'w-5 h-5' : 'w-6 h-6'; // Compacto: w-6 h-6 para dar más espacio al círculo
      const textSize = isTopBar ? 'text-xs' : 'text-xs'; // Compacto: text-xs en lugar de text-sm
      const padding = isTopBar ? 'px-2.5 py-1.5' : 'px-2 py-1.5'; // Compacto: px-2 py-1.5 en lugar de px-3 py-2.5
      const gap = isTopBar ? 'gap-2' : 'gap-2'; // Compacto: gap-2 en lugar de gap-3
      const maxWidth = isTopBar ? 'max-w-[100px]' : '';
      
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
        console.log('[Render] moreTabIds from localStorage:', Array.from(moreTabIds));
        if (moreTabIds.size > 0) {
          const beforeCount = tabsToShow.length;
          visibleTabs = tabsToShow.filter(t => {
            // Normalize to string for consistent comparison
            const tabId = String(t.backendId || t.id);
            const shouldShow = !moreTabIds.has(tabId);
            if (!shouldShow) {
              console.log('[Render] Hiding tab:', tabId, 'because it is in More');
            }
            return shouldShow;
          });
          console.log('[Render] Filtered tabs: before=', beforeCount, 'after=', visibleTabs.length);
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

  document.getElementById('bookmark-btn').addEventListener('click', () => {
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
});
