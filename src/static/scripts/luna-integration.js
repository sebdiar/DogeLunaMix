// Luna Integration - Integrate backend tabs with TabManager
const API_URL = '';

class LunaIntegration {
  constructor() {
    this.token = localStorage.getItem('dogeub_token');
    this.user = JSON.parse(localStorage.getItem('dogeub_user') || 'null');
    this.activeSpace = null;
    this.projects = [];
    this.users = [];
    this.personalTabs = []; // Tabs sin space_id (personales)
    this.spaceTabs = []; // Tabs del space activo
    this.savedPersonalTabs = null; // Tabs personales guardados cuando se abre un espacio
    this.showingModal = false; // Flag to prevent TabManager.add from running
    this.mouseY = 0; // Track mouse Y for drag and drop
    
    this.init();
  }

  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
      ...options.headers
    };

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem('dogeub_token');
          localStorage.removeItem('dogeub_user');
          this.token = null;
          this.user = null;
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ action: 'navigate', to: '/login' }, '*');
          } else {
            window.location.href = '/login';
          }
          throw new Error('UNAUTHORIZED');
        }
        throw new Error(`Request failed: ${response.status}`);
      }

      return response.json();
    } catch (err) {
      if (err.message === 'UNAUTHORIZED') {
        throw err;
      }
      throw err;
    }
  }

  async init() {
    
    // Wait for TabManager to be ready
    const waitForTabManager = () => {
      return new Promise((resolve) => {
        if (window.tabManager) {
          resolve();
        } else {
          const checkInterval = setInterval(() => {
            if (window.tabManager) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 5000);
        }
      });
    };

    await waitForTabManager();

    // Setup event listeners
    document.getElementById('project-btn')?.addEventListener('click', () => this.createProject());
    document.getElementById('dm-btn')?.addEventListener('click', () => this.showUserPicker());
    
    
    // tab-btn handler will be set up in setupTabManagerMonitoring after TabManager initializes
    
    document.getElementById('close-space-btn')?.addEventListener('click', () => this.clearActiveSpace());

    if (!this.token || !this.user) {
      this.renderUserInfo(); // Render login prompt
      const projectsContainer = document.getElementById('projects-cont');
      const usersContainer = document.getElementById('users-cont');
      const personalTabsContainer = document.getElementById('personal-tabs-cont');
      
      if (projectsContainer) {
        projectsContainer.innerHTML = '';
      }
      if (usersContainer) {
        usersContainer.innerHTML = '';
      }
      if (personalTabsContainer) {
        personalTabsContainer.innerHTML = '';
      }
      return;
    }

    this.renderUserInfo(); // Render user info
    await this.loadPersonalTabs();
    await this.loadProjects();
    await this.loadUsers();

    // Monitor TabManager for changes
    this.setupTabManagerMonitoring();
    
    // Intercept clicks on personal tabs to close active space
    this.setupPersonalTabsClickHandler();
  }

  setupPersonalTabsClickHandler() {
    // Intercept clicks on tabs-cont to close active space when clicking a tab
    // Los tabs son los mismos, pero al hacer click en el sidebar, cerramos el espacio activo
    const tabsContainer = document.getElementById('tabs-cont');
    if (!tabsContainer) return;
    
    // Use event delegation to catch clicks on tabs
    tabsContainer.addEventListener('click', (e) => {
      const tabEl = e.target.closest('.tab-item');
      if (!tabEl) return;
      
      const tabId = +tabEl.dataset.tabId;
      if (!tabId) return;
      
      // Si hay un espacio activo, cerrarlo al hacer click en cualquier tab del sidebar
      if (this.activeSpace) {
        e.stopPropagation(); // Prevent TabManager's default handler
        this.clearActiveSpace();
        // Then activate the tab
        setTimeout(() => {
          window.tabManager?.activate(tabId);
        }, 50);
      }
    }, true); // Use capture phase to intercept before TabManager
  }

  setupTabManagerMonitoring() {
    if (!window.tabManager) return;

    // Override TabManager's onclick for tab-btn to show modal instead
    const setupTabButton = () => {
      const tabBtn = document.getElementById('tab-btn');
      if (!tabBtn) {
        setTimeout(setupTabButton, 100);
        return;
      }
      
      // Clear any existing onclick handlers
      tabBtn.onclick = null;
      
      // Remove any existing event listeners by cloning the button
      const newBtn = tabBtn.cloneNode(true);
      tabBtn.parentNode?.replaceChild(newBtn, tabBtn);
      
      // Add our modal handler
      newBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.handleNewTab();
      });
      
      // Update TabManager's reference
      if (window.tabManager) {
        window.tabManager.ab = newBtn;
      }
    };
    
    setupTabButton();

    // Intercept activate to update TopBar
    const originalActivate = window.tabManager.activate?.bind(window.tabManager);
    if (originalActivate) {
      window.tabManager.activate = (...args) => {
        const result = originalActivate.apply(window.tabManager, args);
        setTimeout(() => {
          if (this.activeSpace) {
            this.renderTopBar();
          }
        }, 50);
        return result;
      };
    }

    // Intercept add method - prevent it if modal is showing
    const originalAdd = window.tabManager.add?.bind(window.tabManager);
    if (originalAdd) {
      window.tabManager.add = (...args) => {
        // If we're showing the modal, don't execute TabManager's add
        if (this.showingModal) {
          return;
        }
        const result = originalAdd.apply(window.tabManager, args);
        setTimeout(() => {
          if (this.activeSpace) {
            this.renderTopBar();
          }
        }, 100);
        return result;
      };
    }

    // Intercept close method to sync with backend
    const originalClose = window.tabManager.close?.bind(window.tabManager);
    
    if (originalClose) {
      window.tabManager.close = (id) => {
        
        // Get tab before closing
        const tabToClose = window.tabManager.tabs.find(t => t.id === id);
        console.log('Tab to close:', tabToClose);
        
        // If tab has a URL, try to delete from backend BEFORE closing
        if (tabToClose && tabToClose.url && this.token) {
          const url = tabToClose.url;
          console.log('Tab URL:', url);
          
          if (url !== '/new' && url !== 'tabs://new' && !url.startsWith('tabs://') && !url.startsWith('luna://') && !url.startsWith('doge://')) {
            console.log('Will delete from backend:', url);
            // Delete from backend (async but don't await to avoid blocking UI)
            this.deleteTabFromBackend(url).then(() => {
              console.log('✅ Successfully deleted from backend');
            }).catch(err => {
              console.error('❌ Failed to delete tab from backend:', err);
            });
          } else {
            console.log('Skipping backend deletion (special URL)');
          }
        } else {
          console.log('Skipping backend deletion (no URL or no token)');
        }
        
        // Close in TabManager
        const result = originalClose.apply(window.tabManager, [id]);
        
        return result;
      };
    } else {
      console.error('❌ Could not intercept TabManager.close - originalClose not found');
    }

    // Monitor render to update TopBar
    const originalRender = window.tabManager.render?.bind(window.tabManager);
    if (originalRender) {
      window.tabManager.render = (...args) => {
        const result = originalRender.apply(window.tabManager, args);
        setTimeout(() => {
          if (this.activeSpace) {
            this.renderTopBar();
          }
        }, 50);
        return result;
      };
    }
  }

  async loadPersonalTabs() {
    if (!this.token) return;
    
    try {
      const { tabs } = await this.request('/api/tabs');
      
      // Remove duplicates by URL - keep only the most recent
      const urlMap = new Map();
      tabs.forEach(tab => {
        const url = tab.url || tab.bookmark_url;
        if (!url) return;
        
        const normalizedUrl = this.normalizeUrl(url);
        const existing = urlMap.get(normalizedUrl);
        
        // Keep the most recent tab (by created_at or id)
        if (!existing || (tab.created_at > existing.created_at) || 
            (tab.created_at === existing.created_at && tab.id > existing.id)) {
          urlMap.set(normalizedUrl, tab);
        } else {
          // Delete duplicate from backend
          this.deleteDuplicateTab(tab.id).catch(err => 
            console.error('Failed to delete duplicate tab:', err)
          );
        }
      });
      
      this.personalTabs = Array.from(urlMap.values());
      
      // Sync tabs from backend to TabManager (solo si no hay espacio activo)
      if (!this.activeSpace && window.tabManager && this.personalTabs.length > 0) {
        await this.syncTabsToTabManager();
      }
      
      this.renderPersonalTabs();
      console.log('Loaded personal tabs:', this.personalTabs.length);
      
      // Setup drag and drop for tabs after render
      setTimeout(() => {
        this.setupDragAndDrop('tabs-cont', this.personalTabs, false, async ({ draggedId, targetId, position }) => {
          try {
            const oldIndex = this.personalTabs.findIndex(t => t.id === draggedId);
            const newIndex = this.personalTabs.findIndex(t => t.id === targetId);
            let finalIndex = newIndex;
            if (position === 'after') {
              finalIndex = newIndex + 1;
            }
            
            const updates = [];
            const newTabs = [...this.personalTabs];
            const [dragged] = newTabs.splice(oldIndex, 1);
            newTabs.splice(finalIndex, 0, dragged);
            
            newTabs.forEach((tab, index) => {
              updates.push({ id: tab.id, position: index });
            });
            
            await this.request('/api/tabs/reorder', {
              method: 'POST',
              body: JSON.stringify({ updates })
            });
            await this.loadPersonalTabs();
          } catch (err) {
            console.error('Failed to reorder tabs:', err);
          }
        });
      }, 150);
    } catch (err) {
      console.error('Failed to load personal tabs:', err);
      if (!err.message.includes('UNAUTHORIZED')) {
        const container = document.getElementById('personal-tabs-cont');
        if (container) {
          container.innerHTML = '<div class="text-xs text-red-400 px-2 py-1">Error loading tabs</div>';
        }
      }
    }
  }

  async deleteDuplicateTab(tabId) {
    try {
      await this.request(`/api/tabs/${tabId}`, { method: 'DELETE' });
    } catch (err) {
      // Ignore errors - tab might already be deleted
    }
  }

  async deleteTabFromBackend(url) {
    if (!this.token || !url) return;
    
    try {
      console.log('Deleting tab from backend:', url);
      
      // Get all personal tabs from backend
      const { tabs } = await this.request('/api/tabs');
      
      // Find tab with matching URL
      const tabToDelete = tabs.find(t => {
        const tabUrl = t.url || t.bookmark_url;
        if (!tabUrl) return false;
        return this.normalizeUrl(tabUrl) === this.normalizeUrl(url);
      });
      
      if (tabToDelete) {
        console.log('Found tab to delete:', tabToDelete.id, tabToDelete.title);
        // Delete from backend
        await this.request(`/api/tabs/${tabToDelete.id}`, { method: 'DELETE' });
        console.log('Tab deleted from backend successfully');
        
        // Reload personal tabs from backend to ensure sync
        await this.loadPersonalTabs();
      } else {
        console.log('Tab not found in backend for URL:', url);
      }
    } catch (err) {
      console.error('Failed to delete tab from backend:', err);
    }
  }

  async syncTabsToTabManager() {
    // Si hay un espacio activo, no cargar tabs personales en TabManager
    // Los tabs personales se mantienen en el sidebar, pero TabManager muestra los tabs del espacio
    if (this.activeSpace) return;
    
    if (!window.tabManager || !this.token) {
      // Si no hay token, limpiar tabs (no mostrar /new)
      if (window.tabManager) {
        window.tabManager.tabs = [];
        window.tabManager.nextId = 1;
        if (window.tabManager.render) window.tabManager.render();
      }
      return;
    }
    
    // Cargar tabs personales del backend en TabManager al inicio
    const tabManagerTabs = window.tabManager.tabs || [];
    
    // Si hay tabs del backend, SIEMPRE reemplazar el tab /new inicial
    if (this.personalTabs.length > 0) {
      // Reemplazar todos los tabs (incluido el /new inicial) con los tabs del backend
      window.tabManager.tabs = [];
      window.tabManager.nextId = 1;
      
      for (let i = 0; i < this.personalTabs.length; i++) {
        const backendTab = this.personalTabs[i];
        const url = backendTab.url || backendTab.bookmark_url;
        if (!url) continue;
        
        const tab = {
          id: window.tabManager.nextId++,
          title: backendTab.title || 'Untitled',
          url: url,
          active: i === 0, // Activate first tab from backend
          justAdded: false,
          // Include avatar info from backend
          avatar_emoji: backendTab.avatar_emoji,
          avatar_color: backendTab.avatar_color,
          avatar_photo: backendTab.avatar_photo,
          backendId: backendTab.id // Store backend ID for reference
        };
        
        window.tabManager.tabs.push(tab);
      }
      
      // Render and create iframes
      if (window.tabManager.render) {
        window.tabManager.render();
      }
      
      if (window.tabManager.createIframes) {
        window.tabManager.createIframes();
      }
      
      if (window.tabManager.showActive) {
        window.tabManager.showActive();
      }
      
      return;
    }
    
    // Si no hay tabs del backend pero hay tabs cargados (excepto el /new inicial), sincronizar
    const alreadyLoaded = tabManagerTabs.length > 1 || 
      (tabManagerTabs.length === 1 && 
       tabManagerTabs[0].url !== '/new' && 
       tabManagerTabs[0].url !== 'tabs://new');
    
    if (alreadyLoaded) {
      // Ya hay tabs cargados - sincronizar: eliminar tabs que no están en backend, agregar los que faltan
      const backendUrls = new Set(
        this.personalTabs
          .map(t => {
            const url = t.url || t.bookmark_url;
            return url ? this.normalizeUrl(url) : null;
          })
          .filter(Boolean)
      );
      
      // Eliminar tabs de TabManager que no están en el backend (solo tabs personales)
      const tabsToRemove = [];
      tabManagerTabs.forEach(t => {
        const tUrl = t.url || '';
        if (tUrl === '/new' || tUrl === 'tabs://new' || t.spaceId) return; // No eliminar New Tab ni tabs de espacios
        const normalizedUrl = this.normalizeUrl(tUrl);
        if (!backendUrls.has(normalizedUrl)) {
          tabsToRemove.push(t.id);
        }
      });
      
      // Cerrar tabs que no están en backend (en orden inverso para evitar problemas con índices)
      tabsToRemove.reverse().forEach(id => {
        if (window.tabManager.tabs.length > 1) {
          window.tabManager.close(id);
        }
      });
      
      // Agregar tabs del backend que no están en TabManager
      this.personalTabs.forEach(backendTab => {
        const url = backendTab.url || backendTab.bookmark_url;
        if (!url) return;
        
        const normalizedUrl = this.normalizeUrl(url);
        const exists = tabManagerTabs.some(t => {
          const tUrl = t.url || '';
          if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return false;
          return this.normalizeUrl(tUrl) === normalizedUrl;
        });
        
        if (!exists) {
          const tab = {
            id: window.tabManager.nextId++,
            title: backendTab.title || 'Untitled',
            url: url,
            active: false,
            justAdded: false,
            // Include avatar info from backend
            avatar_emoji: backendTab.avatar_emoji,
            avatar_color: backendTab.avatar_color,
            avatar_photo: backendTab.avatar_photo,
            backendId: backendTab.id // Store backend ID for reference
          };
          window.tabManager.tabs.push(tab);
        }
      });
    }
    // Si no hay tabs del backend, dejar el tab /new inicial como está
  }

  async loadProjects() {
    if (!this.token) return;
    
    try {
      const { spaces } = await this.request('/api/spaces?category=project');
      this.projects = spaces || [];
      
      
      this.renderProjects();
    } catch (err) {
      console.error('Failed to load projects:', err);
      const container = document.getElementById('projects-cont');
      if (container) {
        container.innerHTML = '<div class="text-xs text-red-400 px-2 py-1">Error loading projects</div>';
      }
    }
  }

  async loadUsers() {
    if (!this.token) return;
    
    try {
      const { spaces } = await this.request('/api/spaces?category=user');
      this.users = spaces || [];
      this.renderUsers();
    } catch (err) {
      console.error('Failed to load users:', err);
      const container = document.getElementById('users-cont');
      if (container) {
        container.innerHTML = '<div class="text-xs text-red-400 px-2 py-1">Error loading messages</div>';
      }
    }
  }

  renderPersonalTabs() {
    // Los tabs del sidebar son EXACTAMENTE los tabs de TabManager (arriba)
    // No mostrar tabs separados - los tabs se muestran en tabs-cont (TabManager)
    const container = document.getElementById('personal-tabs-cont');
    if (container) {
      container.innerHTML = '';
    }
    // Los tabs reales se renderizan automáticamente por TabManager en #tabs-cont
  }

  createFileIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'w-3.5 h-3.5');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('d', 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z');
    svg.appendChild(path);
    return svg;
  }

  async openTab(tab) {
    // Los tabs del sidebar SON los tabs de TabManager - solo activar el que ya existe
    if (!window.tabManager) return;

    const url = tab.url || tab.bookmark_url;
    if (!url) return;

    // Normalize URL for comparison
    const normalizedUrl = this.normalizeUrl(url);
    
    // Buscar el tab en TabManager que tiene esta URL
    const existingTab = window.tabManager.tabs?.find(t => {
      if (!t.url) return false;
      const tUrl = t.url.trim();
      if (tUrl === '/new' || tUrl === 'tabs://new' || !tUrl) return false;
      return this.normalizeUrl(tUrl) === normalizedUrl;
    });

    if (existingTab) {
      // Tab existe - solo activarlo
      window.tabManager.activate(existingTab.id);
    } else {
      console.warn('Tab not found in TabManager:', url, 'This should not happen if tabs are synced');
    }
  }

  async saveTabToBackend(tab, existingTabId) {
    // NO guardar tabs automáticamente en el backend
    // Los tabs solo se guardan cuando el usuario explícitamente los crea como bookmarks
    // Esto previene duplicados
    return;
  }

  handleNewTab() {
    // Show modal to select tab type (Browser or AI Dashboard)
    this.showNewTabModal();
  }

  showNewTabModal() {
    // If modal is already showing, don't create another one
    if (this.showingModal) {
      return;
    }
    
    // Remove existing modal if any
    const existingModal = document.getElementById('new-tab-modal');
    if (existingModal) {
      existingModal.remove();
    }
    
    // Set flag to prevent TabManager.add from running
    this.showingModal = true;

    // Create modal HTML - exactly like luna-chat
    const modal = document.createElement('div');
    modal.id = 'new-tab-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center';
    modal.style.zIndex = '9999'; // Ensure it's on top of everything
    modal.innerHTML = `
      <div class="bg-[#f5f7fa] border border-[#e8eaed] rounded-lg shadow-xl w-full max-w-md">
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-[#e8eaed]">
          <h2 id="modal-title" class="text-lg font-semibold text-[#202124]">Create New Tab</h2>
          <button id="modal-close" class="p-1 hover:bg-[#e8eaed] rounded transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-[#5f6368]">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <!-- Body -->
        <div id="modal-body" class="p-4">
          <!-- Step 1: Choose type will be rendered here -->
        </div>
      </div>
    `;

    // Add modal to DOM first
    document.body.appendChild(modal);

    let step = 1; // 1 = choose type, 2 = fill details
    let tabType = null; // 'browser' or 'ai-dashboard'
    let title = '';
    let url = '';
    let prompt = '';

    const updateModal = () => {
      // Use querySelector within modal instead of getElementById globally
      const modalBody = modal.querySelector('#modal-body');
      const modalTitle = modal.querySelector('#modal-title');
      
      if (!modalBody || !modalTitle) {
        console.error('Modal elements not found');
        return;
      }

      if (step === 1) {
        modalTitle.textContent = 'Create New Tab';
        modalBody.innerHTML = `
          <div class="space-y-3">
            <button id="select-browser" class="w-full flex items-center gap-3 p-4 border-2 border-[#e8eaed] hover:border-[#4285f4] rounded-lg transition-colors text-left group">
              <div class="p-2 bg-white rounded-lg group-hover:bg-[#4285f4] group-hover:text-white transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="2" x2="12" y2="6"></line>
                  <line x1="12" y1="18" x2="12" y2="22"></line>
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                  <line x1="2" y1="12" x2="6" y2="12"></line>
                  <line x1="18" y1="12" x2="22" y2="12"></line>
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                  <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                </svg>
              </div>
              <div class="flex-1">
                <div class="font-medium text-[#202124]">Browser Tab</div>
                <div class="text-sm text-[#5f6368]">Navigate to any website</div>
              </div>
            </button>
            <button id="select-ai-dashboard" class="w-full flex items-center gap-3 p-4 border-2 border-[#e8eaed] hover:border-[#4285f4] rounded-lg transition-colors text-left group">
              <div class="p-2 bg-white rounded-lg group-hover:bg-[#4285f4] group-hover:text-white transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
                  <circle cx="12" cy="12" r="5"></circle>
                </svg>
              </div>
              <div class="flex-1">
                <div class="font-medium text-[#202124]">AI Dashboard</div>
                <div class="text-sm text-[#5f6368]">Create custom dashboard with AI</div>
              </div>
            </button>
          </div>
        `;

        const selectBrowser = modal.querySelector('#select-browser');
        const selectAiDashboard = modal.querySelector('#select-ai-dashboard');
        
        if (selectBrowser) {
          selectBrowser.addEventListener('click', () => {
            tabType = 'browser';
            step = 2;
            updateModal();
          });
        }
        
        if (selectAiDashboard) {
          selectAiDashboard.addEventListener('click', () => {
            tabType = 'ai-dashboard';
            step = 2;
            updateModal();
          });
        }
      } else if (tabType === 'browser') {
        modalTitle.textContent = 'New Browser Tab';
        modalBody.innerHTML = `
          <div class="space-y-3">
            <div>
              <label class="block text-sm font-medium text-[#202124] mb-1">Title</label>
              <input id="tab-title" type="text" placeholder="Google" class="w-full bg-white border border-[#e8eaed] rounded-lg px-3 py-2 text-[#202124] focus:outline-none focus:border-[#4285f4]" autofocus />
            </div>
            <div>
              <label class="block text-sm font-medium text-[#202124] mb-1">URL</label>
              <input id="tab-url" type="url" placeholder="https://google.com" class="w-full bg-white border border-[#e8eaed] rounded-lg px-3 py-2 text-[#202124] focus:outline-none focus:border-[#4285f4]" />
            </div>
            <div class="flex gap-2 pt-2">
              <button id="modal-back" class="flex-1 px-4 py-2 border border-[#e8eaed] rounded-lg text-[#202124] hover:bg-[#e8eaed] transition-colors">Back</button>
              <button id="modal-create" class="flex-1 px-4 py-2 bg-[#4285f4] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">Create</button>
            </div>
          </div>
        `;

        const titleInput = modal.querySelector('#tab-title');
        const urlInput = modal.querySelector('#tab-url');
        const createBtn = modal.querySelector('#modal-create');
        const backBtn = modal.querySelector('#modal-back');

        if (titleInput && urlInput && createBtn) {
          titleInput.value = title;
          urlInput.value = url;

          const updateCreateButton = () => {
            createBtn.disabled = !titleInput.value.trim() || !urlInput.value.trim();
          };

          titleInput.addEventListener('input', () => {
            title = titleInput.value;
            updateCreateButton();
          });
          urlInput.addEventListener('input', () => {
            url = urlInput.value;
            updateCreateButton();
          });

          updateCreateButton();

          if (backBtn) {
            backBtn.addEventListener('click', () => {
              step = 1;
              updateModal();
            });
          }

          createBtn.addEventListener('click', async () => {
            if (!title.trim() || !url.trim()) return;
            await this.createNewTab({ type: 'browser', title: title.trim(), url: url.trim() });
            this.closeModal(modal);
          });
        }
      } else if (tabType === 'ai-dashboard') {
        modalTitle.textContent = 'New AI Dashboard Tab';
        modalBody.innerHTML = `
          <div class="space-y-3">
            <div>
              <label class="block text-sm font-medium text-[#202124] mb-1">Title</label>
              <input id="tab-title" type="text" placeholder="Stock Tracker" class="w-full bg-white border border-[#e8eaed] rounded-lg px-3 py-2 text-[#202124] focus:outline-none focus:border-[#4285f4]" autofocus />
            </div>
            <div>
              <label class="block text-sm font-medium text-[#202124] mb-1">Prompt</label>
              <textarea id="tab-prompt" placeholder="Create a dashboard for tracking stock with photo uploads..." rows="4" class="w-full bg-white border border-[#e8eaed] rounded-lg px-3 py-2 text-[#202124] focus:outline-none focus:border-[#4285f4] resize-none"></textarea>
            </div>
            <div class="flex gap-2 pt-2">
              <button id="modal-back" class="flex-1 px-4 py-2 border border-[#e8eaed] rounded-lg text-[#202124] hover:bg-[#e8eaed] transition-colors">Back</button>
              <button id="modal-create" class="flex-1 px-4 py-2 bg-[#4285f4] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">Create</button>
            </div>
          </div>
        `;

        const titleInput = modal.querySelector('#tab-title');
        const promptInput = modal.querySelector('#tab-prompt');
        const createBtn = modal.querySelector('#modal-create');
        const backBtn = modal.querySelector('#modal-back');

        if (titleInput && promptInput && createBtn) {
          titleInput.value = title;
          promptInput.value = prompt;

          const updateCreateButton = () => {
            createBtn.disabled = !titleInput.value.trim() || !promptInput.value.trim();
          };

          titleInput.addEventListener('input', () => {
            title = titleInput.value;
            updateCreateButton();
          });
          promptInput.addEventListener('input', () => {
            prompt = promptInput.value;
            updateCreateButton();
          });

          updateCreateButton();

          if (backBtn) {
            backBtn.addEventListener('click', () => {
              step = 1;
              updateModal();
            });
          }

          createBtn.addEventListener('click', async () => {
            if (!title.trim() || !prompt.trim()) return;
            await this.createNewTab({ type: 'ai-dashboard', title: title.trim(), prompt: prompt.trim() });
            this.closeModal(modal);
          });
        }
      }
    };

    // Close handlers
    const closeBtn = modal.querySelector('#modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closeModal(modal);
      });
    }
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeModal(modal);
      }
    });

    // Update modal content
    updateModal();
  }

  closeModal(modal) {
    this.showingModal = false; // Clear flag
    if (modal && modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
  }

  async createNewTab(tabData) {
    try {
      // Create tab in backend
      const { tab } = await this.request('/api/tabs', {
        method: 'POST',
        body: JSON.stringify({
          title: tabData.title,
          url: tabData.type === 'ai-dashboard' ? `doge://ai-dashboard/${Date.now()}` : tabData.url,
          type: tabData.type || 'browser'
          // Note: metadata can be stored in a separate table later if needed
          // For now, the prompt can be retrieved from the tab's metadata field if we add it to the schema
        })
      });

      // Reload personal tabs to include the new one
      await this.loadPersonalTabs();
      
      // Open the new tab in TabManager
      if (window.tabManager && this.personalTabs.length > 0) {
        const newTab = this.personalTabs.find(t => t.id === tab.id);
        if (newTab) {
          await this.openTab(newTab);
        }
      }
    } catch (err) {
      console.error('Failed to create tab:', err);
      alert('Failed to create tab');
    }
  }

  async selectProject(projectId) {
    const project = this.projects.find(p => p.id === projectId);
    if (!project) return;

    await this.loadSpace(project);
  }

  async selectUser(userId) {
    const user = this.users.find(u => u.id === userId);
    if (!user) return;

    await this.loadSpace(user);
  }

  async loadSpace(space) {
    this.activeSpace = space;
    this.renderProjects();
    this.renderUsers();

    // Load tabs for this space - NO cambiar TabManager, solo mostrar en TopBar
    try {
      const { tabs } = await this.request(`/api/spaces/${space.id}`);
      this.spaceTabs = tabs || [];
      this.renderTopBar();
      
      // Actualizar sidebar para filtrar tabs del espacio
      if (window.tabManager && window.tabManager.render) {
        window.tabManager.render();
      }
      
      // Automáticamente abrir el primer tab del espacio
      if (this.spaceTabs.length > 0) {
        const firstTab = this.spaceTabs[0];
        setTimeout(() => {
          this.selectSpaceTab(firstTab);
        }, 150);
      }
    } catch (err) {
      console.error('Failed to load space tabs:', err);
    }
  }

  renderTopBar() {
    const topbarSpace = document.getElementById('topbar-space');
    const topbarSpaceName = document.getElementById('topbar-space-name');
    const topbarTabsCont = document.getElementById('topbar-tabs-cont');
    
    if (!topbarSpace || !topbarSpaceName || !topbarTabsCont) return;

    if (!this.activeSpace) {
      // Hide TopBar when no space is active
      topbarSpace.classList.add('hidden');
      return;
    }

    // Show TopBar
    topbarSpace.classList.remove('hidden');
    topbarSpace.style.display = 'flex'; // Ensure it's displayed
    topbarSpaceName.textContent = this.activeSpace.display_name || this.activeSpace.name;

    // Render space tabs in TopBar
    if (!this.spaceTabs || this.spaceTabs.length === 0) {
      topbarTabsCont.innerHTML = '';
      return;
    }

    const tabManagerTabs = window.tabManager?.tabs || [];
    const activeTab = tabManagerTabs.find(t => t.active);

    topbarTabsCont.innerHTML = '';
    
    const showClose = this.spaceTabs.length > 1; // Mostrar X si hay más de 1 tab

    this.spaceTabs.forEach(tab => {
      const tabUrl = tab.url || '';
      const isChat = tabUrl.startsWith('luna://chat/') || tabUrl.startsWith('doge://chat/');
      const isActive = activeTab && this.normalizeUrl(activeTab.url || '') === this.normalizeUrl(tabUrl);

      // TopBar estilo LUNA - horizontal como tabs del navegador
      const tabEl = document.createElement('div');
      tabEl.className = `tab-item group relative flex items-center gap-2 px-3 py-1.5 rounded-t-md cursor-pointer transition-all shrink-0 border-b-2 ${
        isActive
          ? 'bg-white border-[#4285f4] text-[#4285f4] font-medium'
          : 'bg-transparent border-transparent text-[#5f6368] hover:bg-[#f5f7fa] hover:text-[#202124]'
      }`;
      tabEl.dataset.spaceTabId = tab.id;
      tabEl.onclick = (e) => {
        if (!e.target.closest('.close-space-tab')) {
          this.selectSpaceTab(tab);
        }
      };

      // Icon/Avatar - EXACTAMENTE igual a tabs externos (mismo estilo)
      let iconHtml = '';
      let hasFavicon = false;
      // Solo intentar obtener favicon para URLs válidas y normales
      if (!isChat && tabUrl && !tabUrl.startsWith('luna://') && !tabUrl.startsWith('doge://') && !tabUrl.startsWith('tabs://')) {
        try {
          const urlObj = new URL(tabUrl);
          // Solo obtener favicon si la URL es válida (http/https)
          if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
            iconHtml = `<img src="https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32" alt="" class="w-4 h-4 object-contain" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='block';" />`;
            hasFavicon = true;
          }
        } catch (e) {
          // URL inválida, no intentar obtener favicon
        }
      }
      
      if (isChat) {
        iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-[#4285f4]"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
      } else if (!hasFavicon) {
        if (tab.avatar_photo) {
          iconHtml = `<img src="${tab.avatar_photo}" alt="" class="w-full h-full rounded-full object-cover" />`;
        } else if (tab.avatar_emoji) {
          iconHtml = `<span class="text-sm">${tab.avatar_emoji}</span>`;
        } else {
          iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9" x2="15" y1="15" y2="15"/></svg>`;
        }
      }

      // Contenedor de icono - estilo TopBar horizontal (más pequeño)
      const iconContainer = document.createElement('div');
      if (isChat) {
        iconContainer.className = 'shrink-0';
        iconContainer.innerHTML = iconHtml;
      } else {
        iconContainer.className = 'w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 border border-[#e8eaed]';
        iconContainer.style.border = `1px solid ${tab.avatar_color || '#e8eaed'}`;
        iconContainer.style.color = tab.avatar_color || '#6b7280';
        iconContainer.innerHTML = iconHtml;
      }

      const titleSpan = document.createElement('span');
      titleSpan.className = 'text-xs truncate max-w-[120px]';
      titleSpan.textContent = tab.title;

      tabEl.appendChild(iconContainer);
      tabEl.appendChild(titleSpan);

      // Close button - estilo TopBar (más pequeño)
      if (showClose && !isChat) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-space-tab shrink-0 ml-1 w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#e8eaed] rounded transition-opacity';
        closeBtn.dataset.spaceTabId = tab.id;
        closeBtn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          this.deleteSpaceTab(tab.id);
        };
        tabEl.appendChild(closeBtn);
      }

      topbarTabsCont.appendChild(tabEl);
    });

    // Add tab button - estilo TopBar
    const addBtn = document.createElement('button');
    addBtn.className = 'ml-1 px-2 py-1 text-[#5f6368] hover:text-[#202124] hover:bg-[#e8eaed] rounded transition-colors shrink-0';
    addBtn.innerHTML = '<i data-lucide="plus" class="w-3.5 h-3.5"></i>';
    addBtn.title = 'Add tab';
    addBtn.onclick = () => this.addSpaceTab();
    topbarTabsCont.appendChild(addBtn);
    
    // Setup close space button
    const closeSpaceBtn = document.getElementById('close-space-btn');
    if (closeSpaceBtn) {
      closeSpaceBtn.onclick = () => this.clearActiveSpace();
    }
  }

  selectSpaceTab(tab) {
    // Los tabs son los MISMOS - si ya existe uno con esta URL, activarlo (no crear duplicado)
    if (!window.tabManager) return;

    const url = tab.url || tab.bookmark_url;
    if (!url) return;

    const normalizedUrl = this.normalizeUrl(url);
    const tabManagerTabs = window.tabManager.tabs || [];
    
    // Buscar si el tab ya está abierto en TabManager (es el MISMO tab)
    const existingTab = tabManagerTabs.find(t => {
      const tUrl = t.url || '';
      if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return false;
      return this.normalizeUrl(tUrl) === normalizedUrl;
    });

    if (existingTab) {
      // Tab ya existe - solo activarlo (es el MISMO tab)
      window.tabManager.activate(existingTab.id);
      // Si es chat, asegurar que esté inicializado
      if (this.isChatUrl(url) && window.lunaIntegration) {
        const spaceId = url.split('/').pop();
        const chatContainer = document.getElementById(`chat-${existingTab.id}`);
        if (chatContainer && !chatContainer.querySelector('.chat-container')) {
          window.lunaIntegration.initChat(existingTab.id, spaceId);
        }
      }
    } else {
      // Tab no existe - agregarlo (es un tab nuevo)
      window.tabManager.add();
      setTimeout(() => {
        const newTab = window.tabManager.tabs[window.tabManager.tabs.length - 1];
        if (newTab) {
          // Establecer URL y título directamente
          newTab.url = url;
          newTab.title = tab.title || 'Untitled';
          // NO marcar con spaceId - son los mismos tabs
          
          // Crear contenedor apropiado (chat, dashboard, o iframe)
          if (window.tabManager.isChatUrl && window.tabManager.isChatUrl(url)) {
            // Chat - se creará automáticamente en createIframes
            window.tabManager.createIframes();
            const spaceId = url.split('/').pop();
            setTimeout(() => {
              if (window.lunaIntegration) {
                window.lunaIntegration.initChat(newTab.id, spaceId);
              }
            }, 100);
          } else if (window.tabManager.isSpecialUrl && window.tabManager.isSpecialUrl(url)) {
            // Dashboard u otro tipo especial
            window.tabManager.createIframes();
          } else {
            // URL normal - usar updateUrl
            if (window.tabManager.updateUrl) {
              window.tabManager.updateUrl(url);
            }
          }
          
          // Renderizar
          if (window.tabManager.render) {
            window.tabManager.render();
          }
          window.tabManager.showActive();
        }
      }, 100);
    }

    this.renderTopBar();
  }

  isChatUrl(url) {
    return url && (url.startsWith('luna://chat/') || url.startsWith('doge://chat/'));
  }

  async deleteSpaceTab(tabId) {
    if (!this.activeSpace) return;

    // No permitir eliminar Chat tab
    const tab = this.spaceTabs.find(t => t.id === tabId);
    if (tab && (tab.url?.startsWith('luna://chat/') || tab.url?.startsWith('doge://chat/'))) {
      return;
    }

    try {
      await this.request(`/api/tabs/${tabId}`, { method: 'DELETE' });
      
      // Reload space tabs
      const { tabs } = await this.request(`/api/spaces/${this.activeSpace.id}`);
      this.spaceTabs = tabs || [];
      this.renderTopBar();
      
      // Si el tab estaba abierto en TabManager, cerrarlo también
      if (window.tabManager) {
        const tabUrl = tab?.url || tab?.bookmark_url;
        if (tabUrl) {
          const normalizedUrl = this.normalizeUrl(tabUrl);
          const tabToClose = window.tabManager.tabs.find(t => {
            const tUrl = t.url || '';
            if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return false;
            return this.normalizeUrl(tUrl) === normalizedUrl;
          });
          
          if (tabToClose && window.tabManager.tabs.length > 1) {
            window.tabManager.close(tabToClose.id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to delete space tab:', err);
      alert('Failed to delete tab');
    }
  }

  async addSpaceTab() {
    const title = prompt('Tab title:');
    if (!title) return;
    const url = prompt('Tab URL:');
    if (!url) return;

    if (!this.activeSpace) return;

    try {
      const { tab } = await this.request('/api/tabs', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          url: url.trim(),
          space_id: this.activeSpace.id,
          type: 'browser'
        })
      });
      
      // Reload space tabs
      const { tabs } = await this.request(`/api/spaces/${this.activeSpace.id}`);
      this.spaceTabs = tabs || [];
      this.renderTopBar();
    } catch (err) {
      console.error('Failed to add tab:', err);
      alert('Failed to add tab');
    }
  }

  // Clear active space (go back to personal tabs)
  clearActiveSpace() {
    this.activeSpace = null;
    this.spaceTabs = [];
    this.renderProjects();
    this.renderUsers();
    this.renderTopBar();
    
    // Actualizar sidebar para mostrar todos los tabs nuevamente
    if (window.tabManager && window.tabManager.render) {
      window.tabManager.render();
    }
    
    // NO cerrar tabs - los tabs son los mismos, solo cambiamos la vista
    // El TopBar se oculta y los tabs siguen ahí
  }


  renderProjects() {
    const container = document.getElementById('projects-cont');
    if (!container) return;

    if (this.projects.length === 0) {
      container.innerHTML = '';
      return;
    }

    // Build hierarchy tree - EXACTLY like luna-chat
    const buildTree = () => {
      const roots = this.projects.filter(p => !p.parent_id);
      const children = this.projects.filter(p => p.parent_id);
      
      const tree = [];
      
      const addChildren = (parent, depth = 0) => {
        tree.push({ ...parent, depth });
        
        // Use is_expanded exactly like luna-chat (defaults to true if undefined)
        if (parent.is_expanded !== false) {
          const kids = children.filter(c => c.parent_id === parent.id);
          kids.sort((a, b) => (a.position || 0) - (b.position || 0));
          kids.forEach(kid => addChildren(kid, depth + 1));
        }
      };
      
      roots.sort((a, b) => (a.position || 0) - (b.position || 0));
      roots.forEach(root => addChildren(root));
      return tree;
    };

    const hierarchicalProjects = buildTree();
    
    container.innerHTML = '';
    hierarchicalProjects.forEach(project => {
      const isActive = this.activeSpace?.id === project.id;
      const hasChildren = this.projects.some(p => p.parent_id === project.id);
      
      let iconHtml = '';
      if (project.avatar_photo) {
        iconHtml = `<img src="${project.avatar_photo}" alt="" class="w-full h-full rounded-full object-cover" />`;
      } else if (project.avatar_emoji) {
        iconHtml = `<span class="text-sm">${project.avatar_emoji}</span>`;
      } else {
        iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
      }
      
      // Create wrapper div with marginLeft for indentation (like luna-chat SortableItem)
      const wrapperEl = document.createElement('div');
      wrapperEl.style.marginLeft = `${project.depth * 16}px`; // EXACTLY like luna-chat (16px per depth)
      wrapperEl.className = 'relative';
      wrapperEl.setAttribute('data-sortable-id', project.id);
      
      const projectEl = document.createElement('div');
      projectEl.className = `group flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all ${
        isActive ? 'bg-[#4285f4]/10 text-[#4285f4] font-medium shadow-sm' : 'text-[#202124] hover:bg-[#e8eaed]'
      }`;
      projectEl.style.cursor = 'pointer';
      
      // Chevron for expand/collapse (EXACTLY like luna-chat)
      const chevronHtml = hasChildren 
        ? `<button class="p-0.5 hover:bg-gray-100 rounded transition-colors z-10 expand-btn" data-project-id="${project.id}">
            ${project.is_expanded !== false 
              ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>'
              : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'
            }
          </button>`
        : '<div class="w-5"></div>'; // Spacer if no children
      
      projectEl.innerHTML = `
        ${chevronHtml}
        <div class="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style="border: 1px solid ${project.avatar_color || '#e8eaed'}; color: ${project.avatar_color || '#6b7280'}">
          ${iconHtml}
        </div>
        <span class="flex-1 text-sm truncate">${this.escapeHTML(project.name)}</span>
        <button class="project-archive-btn opacity-0 group-hover:opacity-100 hover:text-[#4285f4] transition-opacity p-0.5 cursor-pointer" data-project-id="${project.id}" title="Archive" style="cursor: pointer;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
      `;
      
      // Set event listener AFTER setting innerHTML
      projectEl.addEventListener('click', (e) => {
        // Handle expand/collapse button
        const expandBtn = e.target.closest('.expand-btn');
        if (expandBtn) {
          e.stopPropagation();
          const projectId = expandBtn.getAttribute('data-project-id');
          this.toggleProjectExpanded(projectId);
          return;
        }
        
        // Handle archive button (checkmark)
        const archiveBtn = e.target.closest('.project-archive-btn');
        if (archiveBtn) {
          e.stopPropagation();
          const projectId = archiveBtn.getAttribute('data-project-id');
          this.archiveProject(projectId);
          return;
        }
        
        // Don't trigger click if clicking on drag indicator or archive button
        if (!e.target.closest('.drop-indicator') && !e.target.closest('.project-archive-btn')) {
          this.selectProject(project.id);
        }
      });
      
      wrapperEl.appendChild(projectEl);
      container.appendChild(wrapperEl);
    });
    
    // Setup drag and drop for projects
    this.setupDragAndDrop('projects-cont', this.projects, true, async ({ draggedId, targetId, position, targetParentId }) => {
      try {
        await this.request(`/api/spaces/reorder`, {
          method: 'POST',
          body: JSON.stringify({
            spaceId: draggedId,
            targetId,
            position,
            targetParentId
          })
        });
        await this.loadProjects();
      } catch (err) {
        console.error('Failed to reorder projects:', err);
      }
    });
  }

  async toggleProjectExpanded(projectId) {
    const project = this.projects.find(p => p.id === projectId);
    if (!project) return;

    // Toggle expanded state - EXACTLY like luna-chat
    const newExpanded = !project.is_expanded;
    
    try {
      await this.request(`/api/spaces/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({
          is_expanded: newExpanded
        })
      });
      
      // Update local state
      project.is_expanded = newExpanded;
      
      // Re-render to show updated hierarchy
      this.renderProjects();
    } catch (err) {
      console.error('Failed to toggle project expanded:', err);
    }
  }

  async archiveProject(projectId) {
    const project = this.projects.find(p => p.id === projectId);
    if (!project) return;
    
    // Optimistic UI: Remove project immediately from view
    const projectIndex = this.projects.findIndex(p => p.id === projectId);
    if (projectIndex !== -1) {
      this.projects.splice(projectIndex, 1);
      this.renderProjects(); // Update UI immediately
    }
    
    // Close active space if it was the archived project
    if (this.activeSpace?.id === projectId) {
      this.clearActiveSpace();
    }
    
    try {
      // Archive in backend (this may take a moment due to Notion sync)
      await this.request(`/api/spaces/${projectId}/archive`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true })
      });
      
      // Reload projects to ensure sync is correct (in background)
      this.loadProjects().catch(err => {
        console.error('Failed to reload projects after archiving:', err);
      });
    } catch (err) {
      console.error('Failed to archive project:', err);
      // Restore project if archive failed
      if (projectIndex !== -1) {
        this.projects.splice(projectIndex, 0, project);
        this.renderProjects();
      }
      alert('Failed to archive project. Please try again.');
    }
  }

  renderUsers() {
    const container = document.getElementById('users-cont');
    if (!container) return;

    if (this.users.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = '';
    this.users.forEach(user => {
      const isActive = this.activeSpace?.id === user.id;
      
      // Get display name - prefer display_name, then name (but skip if it's an email)
      let displayName = user.display_name || user.name || 'Unknown';
      
      // If name looks like an email, try to extract a better name
      if (displayName.includes('@') && !user.display_name) {
        // Extract name from email or use email prefix
        const emailParts = displayName.split('@');
        displayName = emailParts[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      }
      
      // If still looks like email, try to get from other_user if available
      if (displayName.includes('@') && user.other_user_name) {
        displayName = user.other_user_name;
      }
      
      const initial = displayName[0]?.toUpperCase() || 'U';
      
      const userEl = document.createElement('div');
      userEl.className = `flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all relative ${
        isActive ? 'bg-[#4285f4]/10 text-[#4285f4] font-medium shadow-sm' : 'text-[#202124] hover:bg-[#e8eaed]'
      }`;
      userEl.setAttribute('data-sortable-id', user.id);
      
      userEl.innerHTML = `
        <div class="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-medium flex-shrink-0 overflow-hidden">
          ${user.other_user_photo ? `<img src="${user.other_user_photo}" alt="" class="w-full h-full object-cover" />` : `<span>${initial}</span>`}
        </div>
        <span class="flex-1 text-sm truncate">${this.escapeHTML(displayName)}</span>
      `;
      
      // Set event listener AFTER setting innerHTML
      userEl.addEventListener('click', (e) => {
        if (!e.target.closest('.drop-indicator')) {
          this.selectUser(user.id);
        }
      });
      
      container.appendChild(userEl);
    });
    
    // Setup drag and drop for users
    this.setupDragAndDrop('users-cont', this.users, false, async ({ draggedId, targetId, position }) => {
      try {
        const oldIndex = this.users.findIndex(u => u.id === draggedId);
        const newIndex = this.users.findIndex(u => u.id === targetId);
        let finalIndex = newIndex;
        if (position === 'after') {
          finalIndex = newIndex + 1;
        }
        
        const updates = [];
        const newUsers = [...this.users];
        const [dragged] = newUsers.splice(oldIndex, 1);
        newUsers.splice(finalIndex, 0, dragged);
        
        newUsers.forEach((user, index) => {
          updates.push({ id: user.id, position: index });
        });
        
        await this.request('/api/spaces/reorder', {
          method: 'POST',
          body: JSON.stringify({ updates })
        });
        await this.loadUsers();
      } catch (err) {
        console.error('Failed to reorder users:', err);
      }
    });
  }

  async createProject() {
    const name = prompt('Project name:');
    if (!name) return;

    try {
      const { space } = await this.request('/api/spaces', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          category: 'project'
        })
      });
      this.projects.push(space);
      this.renderProjects();
    } catch (err) {
      console.error('Failed to create project:', err);
      alert('Failed to create project');
    }
  }

  async showUserPicker() {
    try {
      const { users } = await this.request('/api/users');
      const userList = users.map(u => `${u.name || u.email} (${u.email})`).join('\n');
      const selected = prompt(`Select user:\n\n${userList}\n\nEnter email:`);
      if (!selected) return;

      const user = users.find(u => u.email === selected || u.name === selected);
      if (!user) {
        alert('User not found');
        return;
      }

      const { space } = await this.request('/api/spaces', {
        method: 'POST',
        body: JSON.stringify({
          name: user.name || user.email,
          category: 'user'
        })
      });

      this.users.push(space);
      this.renderUsers();
      this.selectUser(space.id);
    } catch (err) {
      console.error('Failed to show user picker:', err);
      alert('Failed to load users');
    }
  }

  normalizeUrl(url) {
    if (!url) return '';
    try {
      // Remove trailing slashes and normalize
      let normalized = url.trim();
      if (!normalized.startsWith('http://') && !normalized.startsWith('https://') && 
          !normalized.startsWith('luna://') && !normalized.startsWith('doge://') &&
          !normalized.startsWith('tabs://')) {
        normalized = 'https://' + normalized;
      }
      const urlObj = new URL(normalized);
      // Normalize: remove trailing slash, lowercase hostname
      return `${urlObj.protocol}//${urlObj.hostname.toLowerCase()}${urlObj.pathname.replace(/\/$/, '')}${urlObj.search}${urlObj.hash}`;
    } catch {
      return url.trim().toLowerCase();
    }
  }

  renderUserInfo() {
    const userInfoCont = document.getElementById('user-info-cont');
    if (!userInfoCont) return;

    if (this.user) {
      const initial = (this.user.name || this.user.email || 'U')[0].toUpperCase();
      userInfoCont.innerHTML = `
        <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-sm font-medium flex-shrink-0 overflow-hidden">
          ${this.user.avatar_photo ? `<img src="${this.user.avatar_photo}" alt="" class="w-full h-full object-cover" />` : `<span>${initial}</span>`}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm text-[#202124] font-medium truncate">${this.user.name || this.user.email}</div>
          <div class="text-xs text-[#5f6368]">Online</div>
        </div>
        <button id="logout-btn" class="p-1.5 text-[#5f6368] hover:text-red-500 transition-colors rounded-lg" title="Logout">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
        </button>
      `;
      document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
    } else {
      userInfoCont.innerHTML = `
        <button onclick="window.parent.postMessage({ action: 'navigate', to: '/login' }, '*')" class="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[#4285f4] text-white hover:bg-blue-600 transition-colors text-sm justify-center">
          Login
        </button>
      `;
    }
  }

  logout() {
    localStorage.removeItem('dogeub_token');
    localStorage.removeItem('dogeub_user');
    this.token = null;
    this.user = null;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ action: 'navigate', to: '/login' }, '*');
    } else {
      window.location.href = '/login';
    }
  }

  escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Chat functionality
  async initChat(tabId, spaceId) {
    const chatContainer = document.getElementById(`chat-${tabId}`);
    if (!chatContainer || !spaceId) return;

    try {
      const { chat, participants } = await this.request(`/api/chat/space/${spaceId}`);
      if (!chat) return;

      this.renderChat(chatContainer, chat.id, participants);
      this.loadChatMessages(chatContainer, chat.id);
    } catch (err) {
      console.error('Failed to init chat:', err);
      const wrapper = chatContainer.querySelector('.chat-wrapper');
      if (wrapper) {
        wrapper.innerHTML = `
          <div style="padding: 20px; text-align: center; color: #5f6368;">
            Failed to load chat
          </div>
        `;
      }
    }
  }

  renderChat(container, chatId, participants) {
    const wrapper = container.querySelector('.chat-wrapper');
    if (!wrapper) return;

    wrapper.innerHTML = `
      <div class="chat-container" style="display: flex; flex-direction: column; height: 100%;">
        <div class="chat-messages" style="flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; background: #ffffff;" data-chat-id="${chatId}">
          <!-- Messages will be rendered here -->
        </div>
        <div class="chat-input-container" style="border-top: 1px solid #e8eaed; padding: 12px 16px; background: #ffffff;">
          <form class="chat-form" style="display: flex; gap: 8px;">
            <input 
              type="text" 
              class="chat-input" 
              placeholder="Type a message..." 
              style="flex: 1; padding: 10px 14px; border: 1px solid #e8eaed; border-radius: 20px; outline: none; font-size: 14px; font-family: 'Geist', sans-serif; background: #f5f7fa;"
              autocomplete="off"
            />
            <button 
              type="submit"
              style="padding: 10px 20px; background: #4285f4; color: white; border: none; border-radius: 20px; cursor: pointer; font-size: 14px; font-weight: 500; font-family: 'Geist', sans-serif;"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    `;

    // Attach send handler
    const form = wrapper.querySelector('.chat-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = wrapper.querySelector('.chat-input');
        const message = input?.value?.trim();
        if (message) {
          this.sendChatMessage(chatId, message);
          input.value = '';
        }
      });
    }
  }

  async loadChatMessages(container, chatId) {
    const messagesContainer = container.querySelector('.chat-messages');
    if (!messagesContainer) return;

    try {
      const { messages } = await this.request(`/api/chat/${chatId}/messages`);
      this.renderChatMessages(messagesContainer, messages || []);
      
      // Scroll to bottom
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }

  renderChatMessages(container, messages) {
    const user = this.user;
    container.innerHTML = '';

    if (messages.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: #5f6368; padding: 40px 20px; flex: 1; display: flex; align-items: center; justify-content: center;">
          No messages yet. Start the conversation!
        </div>
      `;
      return;
    }

    messages.forEach(msg => {
      const isOwn = msg.user_id === user?.id;
      const userName = msg.user?.name || msg.user?.email || 'Unknown';
      const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const msgEl = document.createElement('div');
      msgEl.style.cssText = `display: flex; ${isOwn ? 'justify-content: flex-end;' : 'justify-content: flex-start;'}; margin-bottom: 4px;`;
      
      msgEl.innerHTML = `
        <div style="max-width: 60%; ${isOwn ? 'margin-left: auto;' : 'margin-right: auto;'}">
          ${!isOwn ? `<div style="font-size: 12px; color: #5f6368; margin-bottom: 4px; padding: 0 12px;">${this.escapeHTML(userName)}</div>` : ''}
          <div style="
            padding: 10px 14px;
            border-radius: ${isOwn ? '18px 18px 4px 18px' : '18px 18px 18px 4px'};
            background: ${isOwn ? '#4285f4' : '#f1f3f5'};
            color: ${isOwn ? '#ffffff' : '#202124'};
            font-size: 14px;
            line-height: 1.4;
            word-wrap: break-word;
          ">
            ${this.escapeHTML(msg.message)}
          </div>
          <div style="font-size: 11px; color: ${isOwn ? '#4285f4' : '#5f6368'}; margin-top: 4px; padding: 0 12px; text-align: ${isOwn ? 'right' : 'left'};">
            ${time}
          </div>
        </div>
      `;
      
      container.appendChild(msgEl);
    });
  }

  // Drag and Drop implementation - copied from luna-chat
  setupDragAndDrop(containerId, items, allowHierarchy, onReorder) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let draggedElement = null;
    let draggedId = null;
    let dropIndicator = null;
    let mouseY = 0;
    let activationDistance = 5; // Same as luna-chat
    let dragStartY = 0;
    let isDragging = false;

    // Track mouse Y position
    const handleMouseMove = (e) => {
      mouseY = e.clientY;
      this.mouseY = e.clientY;
      if (isDragging && draggedElement) {
        this.handleDragMove(e, container, items, allowHierarchy, (indicator) => {
          dropIndicator = indicator;
          this.updateDropIndicators(containerId, indicator);
        });
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    container.addEventListener('mousedown', (e) => {
      const itemElement = e.target.closest('[data-sortable-id]');
      if (!itemElement) return;

      draggedId = itemElement.dataset.sortableId;
      draggedElement = itemElement;
      dragStartY = e.clientY;
      isDragging = false;

      const handleMouseMoveDrag = (e) => {
        const distance = Math.abs(e.clientY - dragStartY);
        if (distance >= activationDistance && !isDragging) {
          isDragging = true;
          draggedElement.style.opacity = '0.3';
          this.handleDragStart(draggedElement);
        }
      };

      const handleMouseUp = async (e) => {
        window.removeEventListener('mousemove', handleMouseMoveDrag);
        window.removeEventListener('mouseup', handleMouseUp);

        if (isDragging && draggedElement) {
          draggedElement.style.opacity = '1';
          
          const overElement = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sortable-id]');
          if (overElement && overElement !== draggedElement) {
            const targetId = overElement.dataset.sortableId;
            await this.handleDragEnd(draggedId, targetId, items, allowHierarchy, dropIndicator, onReorder);
            
            // Reload to show new order
            if (containerId === 'tabs-cont') {
              await this.loadPersonalTabs();
            } else if (containerId === 'projects-cont') {
              await this.loadProjects();
            } else if (containerId === 'users-cont') {
              await this.loadUsers();
            }
          }
          
          this.clearDropIndicators(containerId);
          dropIndicator = null;
        }
        
        draggedElement = null;
        draggedId = null;
        isDragging = false;
      };

      window.addEventListener('mousemove', handleMouseMoveDrag);
      window.addEventListener('mouseup', handleMouseUp);
    });
  }

  handleDragStart(element) {
    element.style.cursor = 'grabbing';
  }

  handleDragMove(e, container, items, allowHierarchy, setDropIndicator) {
    const overElement = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sortable-id]');
    if (!overElement) {
      setDropIndicator(null);
      return;
    }

    const overId = overElement.dataset.sortableId;
    const targetItem = items.find(s => s.id === overId);
    if (!targetItem) {
      setDropIndicator(null);
      return;
    }

    const overRect = overElement.getBoundingClientRect();
    const relativeY = this.mouseY - overRect.top;
    const percentage = (relativeY / overRect.height) * 100;

    let position;

    if (allowHierarchy) {
      if (targetItem?.parent_id) {
        if (percentage < 50) {
          position = 'before';
        } else {
          position = 'after';
        }
      } else {
        if (percentage < 33) {
          position = 'before';
        } else if (percentage > 67) {
          position = 'after';
        } else {
          position = 'inside';
        }
      }
    } else {
      if (percentage < 50) {
        position = 'before';
      } else {
        position = 'after';
      }
    }

    setDropIndicator({ targetId: overId, position });
  }

  async handleDragEnd(draggedId, targetId, items, allowHierarchy, dropIndicator, onReorder) {
    if (!draggedId || !targetId || draggedId === targetId) return;

    const draggedItem = items.find(s => s.id === draggedId);
    const targetItem = items.find(s => s.id === targetId);

    if (!draggedItem || !targetItem) return;

    let position = dropIndicator?.position || 'before';
    let targetParentId = targetItem.parent_id || null;

    if (allowHierarchy && targetItem.parent_id && (position === 'before' || position === 'after')) {
      targetParentId = targetItem.parent_id;
    }

    await onReorder({
      draggedId: draggedItem.id,
      targetId: targetItem.id,
      position,
      targetParentId
    });
  }

  updateDropIndicators(containerId, indicator) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Remove all existing indicators
    container.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    container.querySelectorAll('[data-sortable-id]').forEach(el => {
      el.classList.remove('drop-inside');
    });

    if (!indicator) return;

    const targetElement = container.querySelector(`[data-sortable-id="${indicator.targetId}"]`);
    if (!targetElement) return;

    const indicatorLine = document.createElement('div');
    indicatorLine.className = 'drop-indicator';
    indicatorLine.style.cssText = `
      position: absolute;
      left: 0;
      right: 0;
      height: 2px;
      background-color: #4285f4;
      z-index: 20;
      pointer-events: none;
    `;

    if (indicator.position === 'before') {
      indicatorLine.style.top = '0';
      targetElement.style.position = 'relative';
      targetElement.insertBefore(indicatorLine, targetElement.firstChild);
    } else if (indicator.position === 'after') {
      indicatorLine.style.bottom = '0';
      targetElement.style.position = 'relative';
      targetElement.appendChild(indicatorLine);
    } else if (indicator.position === 'inside') {
      targetElement.classList.add('drop-inside');
      targetElement.style.backgroundColor = '#4285f425';
    }
  }

  clearDropIndicators(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    container.querySelectorAll('[data-sortable-id]').forEach(el => {
      el.classList.remove('drop-inside');
      el.style.backgroundColor = '';
    });
  }

  async sendChatMessage(chatId, message) {
    try {
      const { message: newMsg } = await this.request(`/api/chat/${chatId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message })
      });

      // Reload messages to show the new one
      const chatContainer = document.querySelector(`[data-chat-id="${chatId}"]`)?.closest('.chat-wrapper');
      if (chatContainer) {
        this.loadChatMessages(chatContainer, chatId);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      alert('Failed to send message');
    }
  }
}

// Initialize - wait for TabManager to be ready

let lunaIntegration;

const initLunaIntegration = () => {
  // Wait for TabManager to be available
  const checkTabManager = () => {
    if (window.tabManager) {
      try {
        lunaIntegration = new LunaIntegration();
        window.lunaIntegration = lunaIntegration;
      } catch (err) {
        console.error('❌ Error creating LunaIntegration:', err);
        console.error('Error stack:', err.stack);
      }
    } else {
      // Check again in 50ms (faster polling)
      setTimeout(checkTabManager, 50);
    }
  };
  
  // Start checking immediately
  checkTabManager();
};

// Initialize as soon as possible
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLunaIntegration);
} else {
  // DOM already loaded, start immediately
  initLunaIntegration();
}

