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
      urlInterval: 1000,
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
          // Initialize chat when container is created
          if (window.lunaIntegration) {
            const spaceId = t.url.split('/').pop();
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
      console.info('[info] back(): no history to go back');
      return;
    }

    hist.position--;
    const decodedUrl = hist.urls[hist.position];
    if (decodedUrl) {
      const handler = TYPE[this.prType] || TYPE.scr;
      const iframe = document.getElementById(`iframe-${activeTab.id}`);
      handler.navigate(decodedUrl, this, activeTab, iframe);
      if (this.ui) this.ui.value = decodedUrl;
      console.log('[info] back(): navigated to', decodedUrl);
      this.emitNewFrame();
    }
  };

  forward = () => {
    const activeTab = this.active();
    if (!activeTab) return;

    const hist = this.history.get(activeTab.id);
    if (!hist || hist.position >= hist.urls.length - 1) {
      console.info('[info] forward(): no history to go forward');
      return;
    }

    hist.position++;
    const decodedUrl = hist.urls[hist.position];
    if (decodedUrl) {
      const handler = TYPE[this.prType] || TYPE.scr;
      const iframe = document.getElementById(`iframe-${activeTab.id}`);
      handler.navigate(decodedUrl, this, activeTab, iframe);
      if (this.ui) this.ui.value = decodedUrl;
      console.log('[info] forward(): navigated to', decodedUrl);
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
    } catch (err) {
      console.warn('[err] reload():', err);
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

    const updateTitle = (tries = 10) => {
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

  activate = (id) => {
    if (this.active()?.id === id) return;
    this.tabs.forEach((t) => (t.active = t.id === id));
    this.render();
    this.showActive();
    if (this.ui) {
      const activeTab = this.active();
      // Don't show URL for special URLs (chat, AI dashboard, etc.)
      if (activeTab && !this.isNewTab(activeTab.url) && !this.isSpecialUrl(activeTab.url)) {
        this.ui.value = this.ex(activeTab.url);
      } else {
        this.ui.value = '';
      }
    }
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

  render = (() => {
    const tabTemplate = (t, op, showClose) => {
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
      
      return `
      <div ${t.justAdded ? 'data-m="bounce-up" data-m-duration="0.2"' : ''} 
           class="tab-item group relative flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
             t.active
               ? 'bg-[#4285f4]/10 text-[#4285f4] font-medium shadow-sm'
               : 'text-[#202124] hover:bg-[#e8eaed]'
           }" 
           data-tab-id="${t.id}"
           ${t.backendId ? `data-sortable-id="${t.backendId}"` : ''}>
        <div class="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style="border: 1px solid ${borderColor}; color: ${iconColor}">
          ${iconHtml}
        </div>
        <span class="flex-1 text-sm truncate" title="${this.escapeHTML(t.title)}">${this.escapeHTML(t.title)}</span>
        ${showClose && !isChat && !isDashboard ? `<button class="close-tab shrink-0 p-0.5 opacity-0 group-hover:opacity-100 hover:text-[#202124] transition-opacity" data-tab-id="${t.id}" title="Close ${this.escapeHTML(t.title)}"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>` : ''}
      </div>`.trim();
    };

    return function () {
      const op = JSON.parse(localStorage.getItem('options') || '{}');
      const showClose = this.tabs.length > 1;

      // Filtrar tabs: si hay un espacio activo, NO mostrar los tabs del espacio en el sidebar
      // (solo se muestran en el TopBar para evitar duplicados visuales)
      let tabsToShow = this.tabs;
      if (window.lunaIntegration && window.lunaIntegration.activeSpace && window.lunaIntegration.spaceTabs) {
        const spaceTabUrls = new Set(
          window.lunaIntegration.spaceTabs
            .map(t => {
              const url = t.url || t.bookmark_url;
              if (!url) return null;
              return window.lunaIntegration.normalizeUrl(url);
            })
            .filter(Boolean)
        );
        
        tabsToShow = this.tabs.filter(t => {
          const tUrl = t.url || '';
          if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return true;
          const normalizedUrl = window.lunaIntegration.normalizeUrl(tUrl);
          return !spaceTabUrls.has(normalizedUrl);
        });
      }
      
      this.tc.innerHTML = tabsToShow.map((t) => tabTemplate(t, op, showClose)).join('');

      this.tabs.forEach((t) => delete t.justAdded);
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
    bookmark.setAttribute(
      'fill',
      options.quickLinks.some((q) => q.link === e.detail.url) ? 'currentColor' : 'none',
    );
  });
});
