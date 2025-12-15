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
    this.menuCloseListener = null; // Track menu close listener
    this.currentChatId = null; // Current active chat ID for message sending
    
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

    // Desktop More dropdown handlers
    const moreBtn = document.getElementById('sidebar-more-btn');
    if (moreBtn) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = document.getElementById('more-dropdown');
        if (dropdown && dropdown.classList.contains('active')) {
          this.hideMoreDropdown();
        } else {
          this.showMoreDropdown();
        }
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const moreBtn = document.getElementById('sidebar-more-btn');
      const dropdown = document.getElementById('more-dropdown');
      if (moreBtn && dropdown && !moreBtn.contains(e.target) && !dropdown.contains(e.target)) {
        this.hideMoreDropdown();
      }
    });

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

    // Load preferences from backend first (this will cache them)
    await this.loadPreferences();

    // Update desktop More tabs
    await this.updateDesktopMoreTabs();

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
      const submenu = document.getElementById('tab-submenu');
      if (!tabBtn || !submenu) {
        setTimeout(setupTabButton, 100);
        return;
      }
      
      // Toggle submenu on button click
      tabBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        submenu.classList.toggle('hidden');
        return false;
      }, true); // Use capture phase
      
      // Browser Tab option
      const browserBtn = submenu.querySelector('.tab-submenu-browser');
      if (browserBtn) {
        browserBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          submenu.classList.add('hidden');
          // Open edit modal in create mode for browser tab
          // SIEMPRE crear tab personal cuando se crea desde el sidebar (sin space_id)
          this.showEditTabModal({
            id: null,
            title: '',
            url: '',
            bookmark_url: '',
            avatar_emoji: null,
            avatar_color: null,
            avatar_photo: null,
            space_id: null // SIEMPRE null para tabs creados desde el sidebar
          }, true); // true = isNewTab
          return false;
        }, true);
      }
      
      // AI Dashboard option
      const aiBtn = submenu.querySelector('.tab-submenu-ai');
      if (aiBtn) {
        aiBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          submenu.classList.add('hidden');
          // For AI Dashboard, still use the old flow for now
          this.showNewTabModal();
          return false;
        }, true);
      }
      
      // Close submenu when clicking outside (with capture phase)
      document.addEventListener('click', (e) => {
        if (!tabBtn.contains(e.target) && !submenu.contains(e.target)) {
          submenu.classList.add('hidden');
        }
      }, true);
      
      // Update TabManager's reference if it exists
      if (window.tabManager) {
        window.tabManager.ab = tabBtn;
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
        
        // If tab has a backendId, delete from backend using ID (more reliable)
        if (tabToClose && tabToClose.backendId && this.token) {
          // Delete from backend using ID (works for all tab types including AI Dashboard)
          this.deleteTabFromBackendById(tabToClose.backendId).catch(() => {
            // Ignore errors
          });
        } else if (tabToClose && tabToClose.url && this.token) {
          // Fallback: try to delete by URL (only for non-special URLs)
          const url = tabToClose.url;
          
          if (url !== '/new' && url !== 'tabs://new' && !url.startsWith('tabs://') && !url.startsWith('luna://chat/') && !url.startsWith('doge://chat/')) {
            // Delete from backend (async but don't await to avoid blocking UI)
            // Include AI Dashboards (doge://ai-dashboard) - they should be deleted
            this.deleteTabFromBackend(url).catch(() => {
              // Ignore errors
            });
          }
        }
        
        // Close in TabManager
        const result = originalClose.apply(window.tabManager, [id]);
        
        return result;
      };
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
      
      // CRÍTICO: Ordenar primero por position para mantener el orden del backend
      // El backend ya los devuelve ordenados por position ASC, pero asegurémonos
      // Tabs con position null/undefined van al final
      // Si tienen la misma posición, ordenar por created_at (más reciente al final)
      const sortedTabs = (tabs || []).sort((a, b) => {
        const posA = a.position != null ? a.position : 999999999;
        const posB = b.position != null ? b.position : 999999999;
        if (posA !== posB) return posA - posB;
        // Si misma posición, ordenar por created_at (más reciente al final para mantener orden de creación)
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateA - dateB; // Más antiguo primero, más reciente al final
      });
      
      // Remove duplicates by URL - keep only the most recent, manteniendo el orden
      const seenUrls = new Set();
      const deduplicated = [];
      const duplicateIds = [];
      
      // Iterar en orden para mantener la posición
      for (const tab of sortedTabs) {
        const url = tab.url || tab.bookmark_url;
        if (!url) continue;
        
        const normalizedUrl = this.normalizeUrl(url);
        
        if (!seenUrls.has(normalizedUrl)) {
          seenUrls.add(normalizedUrl);
          deduplicated.push(tab);
        } else {
          // Es duplicado - marcarlo para eliminación
          duplicateIds.push(tab.id);
        }
      }
      
      // Eliminar duplicados del backend (async, no bloquear)
      if (duplicateIds.length > 0) {
        Promise.all(duplicateIds.map(id => this.deleteDuplicateTab(id).catch(() => {})));
      }
      
      // Ya están ordenados y sin duplicados
      this.personalTabs = deduplicated;
      
      // ARREGLAR tabs con position 0: si hay múltiples tabs con position 0, reordenarlos
      const tabsWithZeroPos = this.personalTabs.filter(t => t.position === 0 || t.position == null);
      if (tabsWithZeroPos.length > 1) {
        // Reordenar: asignar posiciones secuenciales comenzando desde el máximo + 1
        let maxPosition = -1;
        for (const tab of this.personalTabs) {
          if (tab.position != null && tab.position > maxPosition) {
            maxPosition = tab.position;
          }
        }
        
        const updates = tabsWithZeroPos.map((tab, index) => ({
          id: tab.id,
          position: maxPosition + 1 + index
        }));
        
        // Actualizar en backend (async, no esperar)
        this.request('/api/tabs/reorder', {
          method: 'POST',
          body: JSON.stringify({ updates })
        }).then(() => {
          this.loadPersonalTabs();
        }).catch(() => {});
      }
      
      // Sync tabs from backend to TabManager (solo si no hay espacio activo)
      if (!this.activeSpace && window.tabManager) {
        await this.syncTabsToTabManager();
      }
      
      this.renderPersonalTabs();
      
      // Setup drag and drop for tabs after render - with support for moving to/from More
      setTimeout(() => {
        this.setupDragAndDrop('tabs-cont', this.personalTabs, false, async ({ draggedId, targetId, position, dropTarget }) => {
          try {
            // Check if dropping on More dropdown or More button
            if (dropTarget === 'more-dropdown-content') {
              const draggedIdStr = String(draggedId);
              
              // Move tab to More - try to find tab by id or backendId
              let tab = this.personalTabs.find(t => {
                const tId = String(t.id);
                const tBackendId = t.backendId ? String(t.backendId) : null;
                return tId === draggedIdStr || tBackendId === draggedIdStr;
              });
              
              if (!tab && window.tabManager) {
                tab = window.tabManager.tabs.find(t => {
                  const tId = String(t.id);
                  const tBackendId = t.backendId ? String(t.backendId) : null;
                  return tId === draggedIdStr || tBackendId === draggedIdStr;
                });
              }
              
              const tabIdToMove = tab ? String(tab.backendId || tab.id) : draggedIdStr;
              await this.moveTabToMore(tabIdToMove);
              return;
            }
            
            const oldIndex = this.personalTabs.findIndex(t => t.id === draggedId);
            const newIndex = this.personalTabs.findIndex(t => t.id === targetId);
            
            // Calcular finalIndex ANTES de remover el elemento
            let finalIndex = newIndex;
            if (position === 'after') {
              finalIndex = newIndex + 1;
            }
            
            // OPTIMISTIC UI: Actualizar inmediatamente
            const newTabs = [...this.personalTabs];
            const [dragged] = newTabs.splice(oldIndex, 1);
            
            // Ajustar finalIndex si removimos un elemento antes de la posición objetivo
            // Si oldIndex < finalIndex, el elemento ya fue removido, así que ajustar
            if (oldIndex < finalIndex) {
              finalIndex -= 1;
            }
            
            newTabs.splice(finalIndex, 0, dragged);
            
            // Actualizar posiciones localmente
            for (let index = 0; index < newTabs.length; index++) {
              newTabs[index].position = index;
            }
            
            // Actualizar estado
            this.personalTabs = newTabs;
            
            // CRÍTICO: Reordenar tabs en TabManager según el nuevo orden
            if (window.tabManager?.tabs) {
              // Crear un mapa de backendId -> tab de TabManager
              const tabMap = new Map();
              for (const t of window.tabManager.tabs) {
                if (t.backendId) {
                  tabMap.set(t.backendId, t);
                }
              }
              
              // Reordenar según el nuevo orden de personalTabs
              const reorderedTabs = [];
              for (const personalTab of newTabs) {
                const tabManagerTab = tabMap.get(personalTab.id);
                if (tabManagerTab) {
                  reorderedTabs.push(tabManagerTab);
                  tabMap.delete(personalTab.id);
                }
              }
              
              // Agregar tabs restantes
              reorderedTabs.push(...tabMap.values());
              
              window.tabManager.tabs = reorderedTabs;
              window.tabManager.render();
            }
            
            // Llamar al backend en segundo plano
            const updates = newTabs.map((tab, index) => ({ id: tab.id, position: index }));
            
            this.request('/api/tabs/reorder', {
              method: 'POST',
              body: JSON.stringify({ updates })
            }).catch(() => {
              // Si falla, recargar desde el backend
              this.loadPersonalTabs().catch(() => {});
            });
          } catch {
            // Ignore errors
          }
        });
        
        // Setup drag and drop for More dropdown - with support for moving to sidebar
        this.setupMoreDropdownDragAndDrop();
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
    } catch {
      // Ignore errors - tab might already be deleted
    }
  }

  async deleteTabFromBackendById(tabId) {
    if (!this.token || !tabId) return;
    
    try {
      // Delete directly using ID (works for all tab types including AI Dashboard)
      await this.request(`/api/tabs/${tabId}`, { method: 'DELETE' });
      
      // Reload personal tabs to ensure sync (only if not in a space)
      if (!this.activeSpace) {
        await this.loadPersonalTabs();
        await this.syncTabsToTabManager();
      }
    } catch {
      // Ignore errors - tab might already be deleted
    }
  }

  async deleteTabFromBackend(url) {
    if (!this.token || !url) return;
    
    try {
      
      // Get all personal tabs from backend
      const { tabs } = await this.request('/api/tabs');
      
      // Find tab with matching URL
      const tabToDelete = tabs.find(t => {
        const tabUrl = t.url || t.bookmark_url;
        if (!tabUrl) return false;
        return this.normalizeUrl(tabUrl) === this.normalizeUrl(url);
      });
      
      if (tabToDelete) {
        // Delete from backend
        await this.request(`/api/tabs/${tabToDelete.id}`, { method: 'DELETE' });
        
        // Reload personal tabs from backend to ensure sync
        await this.loadPersonalTabs();
      }
    } catch {
      // Ignore errors
    }
  }

  async syncTabsToTabManager() {
    // Si hay un espacio activo, no cargar tabs personales en TabManager
    if (this.activeSpace) return;
    
    if (!window.tabManager || !this.token) {
      if (window.tabManager) {
        window.tabManager.tabs = [];
        window.tabManager.nextId = 1;
        if (window.tabManager.render) window.tabManager.render();
      }
      return;
    }
    
    // CRÍTICO: this.personalTabs ya está ordenado por position (de loadPersonalTabs)
    // Solo necesitamos mantener ese orden exacto al sincronizar con TabManager
    
    const tabManagerTabs = window.tabManager.tabs || [];
    const currentlyActiveTab = tabManagerTabs.find(t => t.active);
    const activeTabUrl = currentlyActiveTab ? this.normalizeUrl(currentlyActiveTab.url || '') : null;
    
    // Crear mapa de tabs existentes por URL (para reutilizar objetos existentes)
    const existingTabsMap = new Map();
    for (const t of tabManagerTabs) {
      const tUrl = t.url || '';
      if (tUrl && tUrl !== '/new' && tUrl !== 'tabs://new' && !t.spaceId) {
        existingTabsMap.set(this.normalizeUrl(tUrl), t);
      }
    }
    
    // Reconstruir array en el MISMO orden que this.personalTabs (ya ordenado por position)
    const newTabs = [];
    for (const backendTab of this.personalTabs) {
      const url = backendTab.url || backendTab.bookmark_url;
      if (!url) continue;
      
      const normalizedUrl = this.normalizeUrl(url);
      let tab = existingTabsMap.get(normalizedUrl);
      
      if (tab) {
        // Tab existente: actualizar datos pero mantener el objeto
        tab.title = backendTab.title || null;
        tab.avatar_emoji = backendTab.avatar_emoji;
        tab.avatar_color = backendTab.avatar_color;
        tab.avatar_photo = backendTab.avatar_photo;
        tab.backendId = backendTab.id;
        tab.active = activeTabUrl === normalizedUrl;
        // Preserve or set timestamps for memory management
        if (!tab.createdAt && backendTab.created_at) {
          tab.createdAt = new Date(backendTab.created_at).getTime();
        }
        if (!tab.lastAccessed) {
          tab.lastAccessed = backendTab.updated_at ? new Date(backendTab.updated_at).getTime() : Date.now();
        }
      } else {
        // Nuevo tab: crear nuevo objeto
        tab = {
          id: window.tabManager.nextId++,
          title: backendTab.title || null,
          url: url,
          active: false,
          justAdded: false,
          avatar_emoji: backendTab.avatar_emoji,
          avatar_color: backendTab.avatar_color,
          avatar_photo: backendTab.avatar_photo,
          backendId: backendTab.id,
          createdAt: backendTab.created_at ? new Date(backendTab.created_at).getTime() : Date.now(),
          lastAccessed: backendTab.updated_at ? new Date(backendTab.updated_at).getTime() : Date.now()
        };
      }
      
      // Agregar en el orden exacto de this.personalTabs (que ya está ordenado por position)
      newTabs.push(tab);
    }
    
    // Si no hay tab activo, activar el primero
    let shouldActivateFirst = false;
    let firstTabId = null;
    if (newTabs.length > 0 && !newTabs.some(t => t.active)) {
      newTabs[0].active = true;
      shouldActivateFirst = true;
      firstTabId = newTabs[0].id;
    }
    
    // Reemplazar array completo
    window.tabManager.tabs = newTabs;
    
    // Renderizar (single consolidated render - updateDesktopMoreTabs sets skipRender=true)
    if (window.tabManager.render) window.tabManager.render();
    if (window.tabManager.createIframes) window.tabManager.createIframes();
    if (window.tabManager.showActive) window.tabManager.showActive();
    
    // Update desktop More tabs after syncing (skip render since we just rendered)
    await this.updateDesktopMoreTabs(true);
    
    // Si activamos el primer tab, llamar a activate() para cargar su URL automáticamente
    if (shouldActivateFirst && firstTabId && window.tabManager && window.tabManager.activate) {
      // Use requestAnimationFrame for optimal timing after DOM updates
      requestAnimationFrame(() => {
        const tab = window.tabManager.tabs.find(t => t.id === firstTabId);
        if (tab) {
          window.tabManager.tabs.forEach((t) => (t.active = t.id === firstTabId));
          window.tabManager.activate(firstTabId, true);
        }
      });
    }
  }

  async loadProjects() {
    if (!this.token) return;
    
    try {
      const { spaces } = await this.request('/api/spaces?category=project');
      this.projects = spaces || [];
      
      this.renderProjects();
      
      // Crear tabs Dashboard faltantes para proyectos existentes
      this.createMissingDashboardTabs();
    } catch (err) {
      console.error('Failed to load projects:', err);
      const container = document.getElementById('projects-cont');
      if (container) {
        container.innerHTML = '<div class="text-xs text-red-400 px-2 py-1">Error loading projects</div>';
      }
    }
  }

  async createMissingDashboardTabs() {
    if (!this.token) return;
    
    // Solo ejecutar una vez - usar localStorage para trackear
    const hasRun = localStorage.getItem('dashboard_tabs_created');
    if (hasRun) return; // Ya se ejecutó antes
    
    try {
      // Para cada proyecto que tenga notion_page_url
      for (const project of this.projects) {
        if (!project.notion_page_url) continue;
        
        try {
          // Verificar si ya tiene un tab Dashboard
          const { tabs } = await this.request(`/api/spaces/${project.id}`);
          const hasDashboard = tabs && tabs.some(t => 
            t.title === 'Dashboard' && 
            (t.url === project.notion_page_url || t.bookmark_url === project.notion_page_url)
          );
          
          // Si no tiene Dashboard, crearlo
          if (!hasDashboard) {
            await this.request('/api/tabs', {
              method: 'POST',
              body: JSON.stringify({
                url: project.notion_page_url,
                title: 'Dashboard',
                type: 'browser',
                space_id: project.id
              })
            });
          }
        } catch (err) {
          // Continuar con el siguiente proyecto si hay error
          continue;
        }
      }
      
      // Marcar como ejecutado
      localStorage.setItem('dashboard_tabs_created', 'true');
    } catch (err) {
      // Ignore errors
    }
  }

  // Mobile UI functions
  initMobileViews() {
    try {
      if (!window.mobileUI || typeof window.mobileUI.isMobile !== 'function' || !window.mobileUI.isMobile()) return;
      
      // Render mobile bottom bar tabs
      this.renderMobileBottomBar();
    } catch (err) {
      // Silently fail if mobile UI is not available
      console.error('Error initializing mobile views:', err);
    }
  }

  renderMobileBottomBar() {
    try {
      if (!window.tabManager || !window.mobileUI || typeof window.mobileUI.isMobile !== 'function' || !window.mobileUI.isMobile()) return;

    const container = document.getElementById('mobile-tabs-container');
    if (!container) return;

    const tabs = window.tabManager.tabs || [];
    const personalTabs = tabs.filter(t => {
      const url = t.url || '';
      return url && url !== '/new' && url !== 'tabs://new' && !t.spaceId && !this.isChatUrl(url);
    });

    // Calcular cuántos tabs pueden mostrarse (6 totales menos Proyectos, Messenger, More = 3 slots)
    const fixedButtons = 3; // Proyectos, Messenger, More
    const maxTabsVisible = 6 - fixedButtons; // Máximo 3 tabs visibles
    
    // Si hay más tabs, los excedentes van a "More"
    const visibleTabs = personalTabs.slice(0, maxTabsVisible);
    const moreTabs = personalTabs.slice(maxTabsVisible);

    container.innerHTML = '';

    // Render visible tabs usando el MISMO template del sidebar (tabTemplate)
    visibleTabs.forEach(tab => {
      const tabItem = document.createElement('div');
      tabItem.className = 'bottom-nav-item';
      if (tab.active) tabItem.classList.add('active');
      
      // USAR EL TEMPLATE EXISTENTE para obtener icono
      const tabHtml = window.tabManager.tabTemplate(tab, false, false);
      const tabWrapper = document.createElement('div');
      tabWrapper.innerHTML = tabHtml;
      const originalTabEl = tabWrapper.firstElementChild;
      
      if (originalTabEl) {
        // Extraer icono del template
        const iconContainer = originalTabEl.querySelector('.w-7, .w-5, [class*="w-"]');
        let iconHtml = '';
        if (iconContainer) {
          iconHtml = iconContainer.outerHTML;
        }
        
        // Crear estructura bottom bar
        const iconDiv = document.createElement('div');
        iconDiv.className = 'icon';
        if (iconContainer) {
          iconDiv.innerHTML = iconContainer.innerHTML;
        }
        
        const labelSpan = document.createElement('span');
        labelSpan.className = 'label';
        labelSpan.textContent = tab.title || 'Tab';
        
        tabItem.appendChild(iconDiv);
        tabItem.appendChild(labelSpan);
        
        tabItem.addEventListener('click', () => {
          if (window.tabManager) {
            window.tabManager.activate(tab.id);
            if (window.mobileUI && window.mobileUI.hideAll) {
              window.mobileUI.hideAll();
            }
          }
        });
        
        container.appendChild(tabItem);
      }
    });

    // Store more tabs for "More" view
    this.mobileMoreTabs = moreTabs;
    
    // Setup event listeners for mobile bottom nav items
    try {
      const bottomNav = document.querySelector('#mobile-tabs-container')?.parentElement;
      if (bottomNav) {
        bottomNav.addEventListener('click', (e) => {
          try {
            const clickedItem = e.target.closest('.bottom-nav-item');
            if (!clickedItem) return;
            
            const label = clickedItem.querySelector('.label')?.textContent?.trim();
            
            if (label === 'Proyectos' || label?.includes('Proyectos')) {
              if (window.mobileUI && typeof window.mobileUI.show === 'function') {
                window.mobileUI.show('mobile-projects-view');
                setTimeout(() => {
                  this.renderMobileProjects();
                }, 50);
              }
            } else if (label === 'Messenger' || label?.includes('Messenger')) {
              if (window.mobileUI && typeof window.mobileUI.show === 'function') {
                window.mobileUI.show('mobile-messenger-view');
                setTimeout(() => {
                  this.renderMobileMessenger();
                }, 50);
              }
            }
          } catch (err) {
            console.error('Error handling mobile nav click:', err);
          }
        });
      }
    } catch (err) {
      console.error('Error setting up mobile nav listeners:', err);
    }
    } catch (err) {
      console.error('Error rendering mobile bottom bar:', err);
    }
  }

  renderMobileProjects() {
    // REUTILIZAR CÓDIGO EXISTENTE: Clonar TODA la sección del sidebar (incluyendo header con botón "+")
    const projectsCont = document.getElementById('projects-cont');
    const mobileContainer = document.getElementById('mobile-projects-content');
    if (!projectsCont || !mobileContainer) return;
    
    // Find parent section - projects-cont is directly inside the section div (which includes header)
    const fullSection = projectsCont.parentElement;
    if (!fullSection) return;
    
    // Clonar TODA la sección (header + contenido)
    const cloned = fullSection.cloneNode(true);
    mobileContainer.innerHTML = '';
    mobileContainer.appendChild(cloned);
    
    // Re-attach event listeners for mobile
    // 1. Botón "+" para crear proyectos
    const projectBtn = cloned.querySelector('#project-btn');
    if (projectBtn) {
      projectBtn.addEventListener('click', () => {
        this.createProject();
      });
    }
    
    // 2. Event listeners para proyectos
    cloned.querySelectorAll('.project-item').forEach(item => {
      const projectId = item.closest('[data-sortable-id]')?.getAttribute('data-sortable-id');
      if (!projectId) return;
      
      item.addEventListener('click', (e) => {
        // Handle expand/collapse
        const expandBtn = e.target.closest('.expand-btn');
        if (expandBtn) {
          e.stopPropagation();
          this.toggleProjectExpanded(projectId);
          // Re-render mobile view to reflect changes
          this.renderMobileProjects();
          return;
        }
        
        // Handle archive
        const archiveBtn = e.target.closest('.project-archive-btn');
        if (archiveBtn) {
          e.stopPropagation();
          this.archiveProject(projectId);
          return;
        }
        
        // Select project
        if (!e.target.closest('.drop-indicator') && !e.target.closest('.project-archive-btn')) {
          this.selectProject(projectId);
          if (window.mobileUI && window.mobileUI.hideAll) {
            window.mobileUI.hideAll();
          }
        }
      });
    });
  }

  renderMobileMessenger() {
    // REUTILIZAR CÓDIGO EXISTENTE: Clonar TODA la sección del sidebar (incluyendo header con botón "+")
    const usersCont = document.getElementById('users-cont');
    const mobileContainer = document.getElementById('mobile-messenger-content');
    if (!usersCont || !mobileContainer) return;
    
    // Find parent section - users-cont is directly inside the section div (which includes header)
    const fullSection = usersCont.parentElement;
    if (!fullSection) return;
    
    // Clonar TODA la sección (header + contenido)
    const cloned = fullSection.cloneNode(true);
    mobileContainer.innerHTML = '';
    mobileContainer.appendChild(cloned);
    
    // Re-attach event listeners for mobile
    // 1. Botón "+" para crear mensajes
    const dmBtn = cloned.querySelector('#dm-btn');
    if (dmBtn) {
      dmBtn.addEventListener('click', () => {
        this.showUserPicker();
      });
    }
    
    // 2. Event listeners para usuarios
    cloned.querySelectorAll('.user-item').forEach(item => {
      const userId = item.closest('[data-sortable-id]')?.getAttribute('data-sortable-id');
      if (!userId) return;
      
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.drop-indicator')) {
          this.selectUser(userId);
          if (window.mobileUI && window.mobileUI.hideAll) {
            window.mobileUI.hideAll();
          }
        }
      });
    });
  }

  // Unified renderMore function - works for both mobile and desktop
  renderMore(isEditing = false, platform = 'mobile') {
    const isMobile = platform === 'mobile';
    const containerId = isMobile ? 'mobile-more-content' : 'more-dropdown-content';
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    // Use appropriate tabs array
    const moreTabs = isMobile ? (this.mobileMoreTabs || []) : (this.desktopMoreTabs || []);
    if (moreTabs.length === 0) {
      container.innerHTML = '<div class="text-center text-gray-500 py-8 px-4">No additional tabs</div>';
      return;
    }

    if (isMobile) {
      // Mobile: render as grid (4 columnas)
      moreTabs.forEach((tab, index) => {
        const tabItem = document.createElement('div');
        tabItem.className = 'mobile-more-item';
        tabItem.dataset.tabId = tab.id;
        tabItem.dataset.index = index;
        
        const tabHtml = window.tabManager.tabTemplate(tab, false, false);
        const tabWrapper = document.createElement('div');
        tabWrapper.innerHTML = tabHtml;
        const iconContainer = tabWrapper.querySelector('.w-7, .w-5');
        
        let iconHtml = '';
        if (iconContainer) {
          iconHtml = iconContainer.innerHTML;
        }
        
        let scaledIconHtml = iconHtml;
        if (iconContainer) {
          scaledIconHtml = `<div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">${iconContainer.innerHTML}</div>`;
        }
        
        tabItem.innerHTML = `
          <div class="mobile-more-item-icon" style="border: 1px solid ${tab.avatar_color || '#e8eaed'}; color: ${tab.avatar_color || '#6b7280'}; background-color: ${tab.avatar_color ? `${tab.avatar_color}15` : 'transparent'}">
            ${scaledIconHtml}
          </div>
          <div class="mobile-more-item-label">${this.escapeHTML(tab.title || 'Tab')}</div>
        `;

        if (!isEditing) {
          tabItem.addEventListener('click', () => {
            if (window.tabManager) {
              window.tabManager.activate(tab.id);
              if (window.mobileUI && window.mobileUI.hideAll) {
                window.mobileUI.hideAll();
              }
            }
          });
        }

        container.appendChild(tabItem);
      });
    } else {
      // Desktop: render using the SAME template as sidebar tabs (with circles and three dots)
      moreTabs.forEach((tab, index) => {
        // Use the exact same template with showMenu=true to get the three dots
        const tabHtml = window.tabManager.tabTemplate(tab, true, false);
        const tabWrapper = document.createElement('div');
        tabWrapper.innerHTML = tabHtml;
        const tabEl = tabWrapper.firstElementChild;
        
        if (tabEl) {
          // Ensure it has the correct classes and data attributes
          tabEl.dataset.tabId = tab.id;
          tabEl.dataset.index = index;
          tabEl.dataset.sortableId = tab.id;
          
          // Ensure it has the tab-item class
          if (!tabEl.classList.contains('tab-item')) {
            tabEl.classList.add('tab-item');
          }
          
          // Add mx-2 for margin like sidebar tabs
          if (!tabEl.classList.contains('mx-2')) {
            tabEl.classList.add('mx-2');
          }

          if (!isEditing) {
            tabEl.addEventListener('click', (e) => {
              // Don't trigger if clicking on menu button
              if (e.target.closest('.tab-menu-btn')) {
                return;
              }
              if (window.tabManager) {
                window.tabManager.activate(tab.id);
                this.hideMoreDropdown();
              }
            });
          }

          container.appendChild(tabEl);
        }
      });
    }

    if (isEditing) {
      if (isMobile) {
        this.setupMobileMoreDragAndDrop(true);
      } else {
        this.setupMoreDropdownDragAndDrop();
      }
    }
  }

  // Alias for backward compatibility
  renderMobileMore(isEditing = false) {
    this.renderMore(isEditing, 'mobile');
  }

  // Show/hide more dropdown
  showMoreDropdown() {
    const dropdown = document.getElementById('more-dropdown');
    const moreBtn = document.getElementById('sidebar-more-btn');
    if (dropdown && moreBtn) {
      // Calculate position relative to the button
      const rect = moreBtn.getBoundingClientRect();
      dropdown.style.left = `${rect.right + 8}px`;
      dropdown.style.top = `${rect.top}px`;
      dropdown.classList.add('active');
      this.renderMore(false, 'desktop');
      // Setup drag and drop after rendering
      setTimeout(() => {
        this.setupMoreDropdownDragAndDrop();
      }, 50);
    }
  }

  hideMoreDropdown() {
    const dropdown = document.getElementById('more-dropdown');
    if (dropdown) {
      dropdown.classList.remove('active');
    }
  }

  setupMobileMoreDragAndDrop(isEditing) {
    if (!isEditing) return;

    const container = document.getElementById('mobile-more-content');
    if (!container) return;

    const items = container.querySelectorAll('.mobile-more-item');
    let draggedElement = null;
    let draggedIndex = null;

    items.forEach((item, index) => {
      // Remove existing listeners by cloning
      const newItem = item.cloneNode(true);
      item.parentNode.replaceChild(newItem, item);
      
      newItem.addEventListener('touchstart', (e) => {
        e.preventDefault();
        draggedElement = newItem;
        draggedIndex = parseInt(newItem.dataset.index);
        newItem.classList.add('dragging');
        newItem.style.opacity = '0.5';
      }, { passive: false });

      newItem.addEventListener('touchmove', (e) => {
        if (!draggedElement) return;
        e.preventDefault();
        
        const touch = e.touches[0];
        const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        const targetItem = elementBelow?.closest('.mobile-more-item');
        
        if (targetItem && targetItem !== draggedElement) {
          const targetIndex = parseInt(targetItem.dataset.index);
          if (targetIndex !== draggedIndex) {
            // Swap elements
            if (draggedIndex < targetIndex) {
              container.insertBefore(draggedElement, targetItem.nextSibling);
            } else {
              container.insertBefore(draggedElement, targetItem);
            }
            
            // Update indices
            Array.from(container.children).forEach((item, idx) => {
              item.dataset.index = idx;
            });
            
            draggedIndex = targetIndex;
            
            // Reorder tabs array - use the current draggedIndex before update
            const moreTabs = this.mobileMoreTabs || [];
            const [draggedTab] = moreTabs.splice(draggedIndex, 1);
            moreTabs.splice(targetIndex, 0, draggedTab);
            this.mobileMoreTabs = moreTabs;
          }
        }
      }, { passive: false });

      newItem.addEventListener('touchend', (e) => {
        if (!draggedElement) return;
        e.preventDefault();
        
        draggedElement.classList.remove('dragging');
        draggedElement.style.opacity = '';
        
        // Save new order to backend
        this.saveMobileTabsOrder();
        
        draggedElement = null;
        draggedIndex = null;
      }, { passive: false });
    });
  }

  // Calculate and update desktop More tabs - based on user's custom arrangement
  // skipRender: set to true when called from syncTabsToTabManager to avoid double render
  async updateDesktopMoreTabs(skipRender = false) {
    if (!window.tabManager) return;

    const tabs = window.tabManager.tabs || [];
    const personalTabs = tabs.filter(t => {
      const url = t.url || '';
      return url && url !== '/new' && url !== 'tabs://new' && !t.spaceId && !this.isChatUrl(url);
    });

    // Load which tabs are in "More" from backend (use sync version if cache available)
    const moreTabIds = this.getDesktopMoreTabIdsSync();
    
    // Filter tabs that are in "More" - normalize IDs to strings for comparison
    const moreTabs = personalTabs.filter(t => {
      const tabId = String(t.backendId || t.id);
      return moreTabIds.has(tabId);
    });
    
    this.desktopMoreTabs = moreTabs;

    // Always show More button if there are personal tabs OR tabs in More (user can move them)
    const moreBtn = document.getElementById('sidebar-more-btn');
    if (moreBtn) {
      if (personalTabs.length > 0 || moreTabs.length > 0) {
        moreBtn.style.display = 'flex';
      } else {
        moreBtn.style.display = 'none';
      }
    }

    // Re-render tabs to exclude the ones in "More" (skip if already rendering from sync)
    if (!skipRender && window.tabManager && window.tabManager.render) {
      window.tabManager.render();
    }
  }

  // Cache for preferences to avoid repeated API calls
  _preferencesCache = null;
  _preferencesCacheTime = null;
  _preferencesCacheTimeout = 5000; // Cache for 5 seconds

  // Load preferences from backend (with caching)
  async loadPreferences() {
    // Return cached value if available and fresh
    if (this._preferencesCache && this._preferencesCacheTime) {
      const age = Date.now() - this._preferencesCacheTime;
      if (age < this._preferencesCacheTimeout) {
        return this._preferencesCache;
      }
    }

    if (!this.token) {
      return { desktop_more_tab_ids: [], mobile_more_tab_ids: [] };
    }

    try {
      const data = await this.request('/api/users/preferences');
      this._preferencesCache = data.preferences || { desktop_more_tab_ids: [], mobile_more_tab_ids: [] };
      this._preferencesCacheTime = Date.now();
      return this._preferencesCache;
    } catch (err) {
      console.error('Failed to load preferences:', err);
      // Return empty defaults on error
      return { desktop_more_tab_ids: [], mobile_more_tab_ids: [] };
    }
  }

  // Save preferences to backend
  async savePreferences(preferences) {
    if (!this.token) return;

    try {
      await this.request('/api/users/preferences', {
        method: 'PUT',
        body: JSON.stringify(preferences)
      });
      
      // Update cache immediately with new preferences
      const currentCache = this._preferencesCache || {};
      this._preferencesCache = {
        ...currentCache,
        ...preferences
      };
      this._preferencesCacheTime = Date.now();
    } catch (err) {
      console.error('Failed to save preferences:', err);
    }
  }

  // Get/set which tabs are in "More" - BACKEND for persistence across devices
  async getDesktopMoreTabIds() {
    const prefs = await this.loadPreferences();
    const tabIds = (prefs.desktop_more_tab_ids || []).map(id => String(id));
    return new Set(tabIds);
  }

  // Sync version uses cache - call loadPreferences() first to populate cache
  getDesktopMoreTabIdsSync() {
    if (this._preferencesCache) {
      const tabIds = (this._preferencesCache.desktop_more_tab_ids || []).map(id => String(id));
      return new Set(tabIds);
    }
    return new Set();
  }

  async setDesktopMoreTabIds(tabIds) {
    const tabIdsArray = Array.from(tabIds).map(id => String(id));
    await this.savePreferences({ desktop_more_tab_ids: tabIdsArray });
  }

  // Get/set which tabs are in "More" from backend (mobile)
  async getMobileMoreTabIds() {
    const preferences = await this.loadPreferences();
    return new Set(preferences.mobile_more_tab_ids || []);
  }

  getMobileMoreTabIdsSync() {
    if (this._preferencesCache) {
      return new Set(this._preferencesCache.mobile_more_tab_ids || []);
    }
    return new Set();
  }

  async setMobileMoreTabIds(tabIds) {
    const tabIdsArray = Array.from(tabIds);
    await this.savePreferences({ mobile_more_tab_ids: tabIdsArray });
  }


  // Setup drag and drop for more dropdown (desktop) - reuse existing system
  setupMoreDropdownDragAndDrop() {
    const container = document.getElementById('more-dropdown-content');
    if (!container) return;

    // Use the same drag and drop system as tabs-cont
    this.setupDragAndDrop('more-dropdown-content', this.desktopMoreTabs || [], false, async ({ draggedId, targetId, position, dropTarget }) => {
      const draggedIdStr = String(draggedId);
      
      try {
        // Check if dropping on sidebar (tabs-cont) - MOVE OUT OF MORE
        if (dropTarget === 'tabs-cont') {
          // Find tab by id or backendId
          const tab = this.desktopMoreTabs.find(t => 
            String(t.id) === draggedIdStr || String(t.backendId) === draggedIdStr
          );
          const tabIdToMove = tab ? String(tab.backendId || tab.id) : draggedIdStr;
          await this.moveTabFromMore(tabIdToMove);
          return;
        }
        
        // Reordering within More dropdown
        const oldIndex = this.desktopMoreTabs.findIndex(t => 
          String(t.id) === draggedIdStr || String(t.backendId) === draggedIdStr
        );
        const targetIdStr = String(targetId);
        const newIndex = this.desktopMoreTabs.findIndex(t => 
          String(t.id) === targetIdStr || String(t.backendId) === targetIdStr
        );
        
        
        if (oldIndex === -1) {
          console.error('[More] Could not find dragged tab');
          return;
        }
        
        let finalIndex = newIndex === -1 ? this.desktopMoreTabs.length : newIndex;
        if (position === 'after' && newIndex !== -1) {
          finalIndex = newIndex + 1;
        }
        
        const [draggedTab] = this.desktopMoreTabs.splice(oldIndex, 1);
        if (oldIndex < finalIndex) finalIndex--;
        this.desktopMoreTabs.splice(finalIndex, 0, draggedTab);
        
        await this.saveDesktopTabsOrder();
        this.renderMore(false, 'desktop');
        setTimeout(() => this.setupMoreDropdownDragAndDrop(), 50);
      } catch (err) {
        console.error('[More] Failed to handle drag:', err);
      }
    });
  }

  async saveDesktopTabsOrder() {
    // Save which tabs are in "More" to backend
    const moreTabIds = new Set((this.desktopMoreTabs || []).map(t => String(t.backendId || t.id)).filter(Boolean));
    await this.setDesktopMoreTabIds(moreTabIds);
  }

  // Move tab to/from More - ASYNC for backend persistence
  async moveTabToMore(tabId) {
    const tabIdStr = String(tabId);
    const moreTabIds = await this.getDesktopMoreTabIds();
    moreTabIds.add(tabIdStr);
    await this.setDesktopMoreTabIds(moreTabIds);
    
    // Update UI
    await this.updateDesktopMoreTabs();
    
    // Force re-render of sidebar tabs
    if (window.tabManager && window.tabManager.render) {
      window.tabManager.render();
    }
    
    // Re-render More dropdown if open
    const dropdown = document.getElementById('more-dropdown');
    if (dropdown && dropdown.classList.contains('active')) {
      this.renderMore(false, 'desktop');
      setTimeout(() => this.setupMoreDropdownDragAndDrop(), 50);
    }
  }

  async moveTabFromMore(tabId) {
    const tabIdStr = String(tabId);
    const moreTabIds = await this.getDesktopMoreTabIds();
    moreTabIds.delete(tabIdStr);
    await this.setDesktopMoreTabIds(moreTabIds);
    
    // Update UI
    await this.updateDesktopMoreTabs();
    
    // Force re-render of sidebar tabs
    if (window.tabManager && window.tabManager.render) {
      window.tabManager.render();
    }
    
    // Re-render More dropdown if open
    const dropdown = document.getElementById('more-dropdown');
    if (dropdown && dropdown.classList.contains('active')) {
      this.renderMore(false, 'desktop');
      setTimeout(() => this.setupMoreDropdownDragAndDrop(), 50);
    }
  }

  async saveMobileTabsOrder() {
    // Combine visible tabs and more tabs to get full order
    const tabs = window.tabManager.tabs || [];
    const personalTabs = tabs.filter(t => {
      const url = t.url || '';
      return url && url !== '/new' && url !== 'tabs://new' && !t.spaceId && !this.isChatUrl(url);
    });

    const fixedButtons = 3;
    const maxTabsVisible = 6 - fixedButtons;
    const visibleTabs = personalTabs.slice(0, maxTabsVisible);
    const moreTabs = this.mobileMoreTabs || [];

    // Save which tabs are in "More" to backend
    const mobileMoreTabIds = new Set((moreTabs || []).map(t => t.backendId || t.id).filter(Boolean));
    await this.setMobileMoreTabIds(mobileMoreTabIds);

    // Combine in correct order
    const allTabs = [...visibleTabs, ...moreTabs];
    
    // Update positions
    const updates = allTabs.map((tab, index) => {
      if (tab.backendId) {
        return { id: tab.backendId, position: index };
      }
      return null;
    }).filter(Boolean);

    if (updates.length > 0) {
      try {
        await this.request('/api/tabs/reorder', {
          method: 'POST',
          body: JSON.stringify({ updates })
        });
        // Reload tabs to sync
        await this.loadPersonalTabs();
        await this.syncTabsToTabManager();
        if (window.mobileUI && typeof window.mobileUI.isMobile === 'function' && window.mobileUI.isMobile()) {
          try {
            this.renderMobileBottomBar();
          } catch (err) {
            console.error('Error rendering mobile bottom bar:', err);
          }
        }
      } catch (err) {
        console.error('Failed to save tabs order:', err);
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
    }
  }

  async saveTabToBackend() {
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
    modal.className = 'fixed inset-0 bg-[#000000]/30 flex items-center justify-center';
    modal.style.zIndex = '9999'; // Ensure it's on top of everything
    modal.style.backdropFilter = 'blur(4px)';
    modal.innerHTML = `
      <div class="bg-white border border-[#e8eaed] rounded-xl shadow-2xl w-full max-w-md">
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
        // Modal elements not found - return silently
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
            if (!url.trim()) return;
            // Si title está vacío, enviar null (el backend usará la URL como título por defecto)
            await this.createNewTab({ type: 'browser', title: title.trim() || null, url: url.trim() });
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
      // El space_id debe venir explícitamente en tabData
      // Si no viene, es un tab personal (null)
      const spaceId = tabData.space_id !== undefined ? tabData.space_id : null;
      
      // Preparar el request body
      const requestBody = {
        url: tabData.type === 'ai-dashboard' ? `doge://ai-dashboard/${Date.now()}` : tabData.url,
        type: tabData.type || 'browser',
        space_id: spaceId
      };
      
      // Solo incluir title si tiene valor (si no, el backend usará URL como título)
      if (tabData.title && tabData.title.trim()) {
        requestBody.title = tabData.title.trim();
      }
      
      // Create tab in backend
      const { tab } = await this.request('/api/tabs', {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });

      // Recargar tabs según el contexto
      if (this.activeSpace) {
        // Si estamos en un espacio, recargar los tabs del espacio
        const { tabs } = await this.request(`/api/spaces/${this.activeSpace.id}`);
        this.spaceTabs = tabs || [];
        this.renderTopBar();
        // Abrir el nuevo tab
        const spaceTab = this.spaceTabs.find(t => t.id === tab.id);
        if (spaceTab) {
          await this.selectSpaceTab(spaceTab);
        }
      } else {
        // Reload personal tabs to include the new one
        await this.loadPersonalTabs();
        
        // Open the new tab in TabManager
        if (window.tabManager && this.personalTabs.length > 0) {
          const newTab = this.personalTabs.find(t => t.id === tab.id);
          if (newTab) {
            await this.openTab(newTab);
          }
        }
      }
    } catch (err) {
      console.error('Failed to create tab:', err);
      
      // Try to get more details from the error response
      let errorMsg = err.message || 'Unknown error';
      if (err.details) {
        errorMsg += ': ' + err.details;
      }
      
      alert('Failed to create tab: ' + errorMsg);
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
    // NO cerrar tabs - los tabs se mantienen abiertos como en un browser normal
    // Solo cambiar qué espacio está activo y qué se muestra en TopBar vs sidebar
    
    this.activeSpace = space;
    this.renderProjects();
    this.renderUsers();

      // Load tabs for this space - NO cambiar TabManager, solo mostrar en TopBar
      try {
        const { tabs } = await this.request(`/api/spaces/${space.id}`);
        // Sort tabs by position to ensure correct order
        this.spaceTabs = (tabs || []).sort((a, b) => (a.position || 0) - (b.position || 0));
        this.renderTopBar();
      
      // Actualizar sidebar para filtrar tabs del espacio
      if (window.tabManager && window.tabManager.render) {
        window.tabManager.render();
      }
      
      // Cargar tabs del espacio en TabManager si no están ya cargados
      // Esto asegura que cuando regresas a un proyecto, los tabs que creaste sigan ahí
      if (this.spaceTabs && this.spaceTabs.length > 0 && window.tabManager) {
        const spaceTabUrls = new Set(
          this.spaceTabs.map(t => {
            const url = t.url || t.bookmark_url;
            return url ? this.normalizeUrl(url) : null;
          }).filter(Boolean)
        );
        
        // Cargar tabs del espacio que no están en TabManager
        for (const spaceTab of this.spaceTabs) {
          const url = spaceTab.url || spaceTab.bookmark_url;
          if (!url) continue;
          
          const normalizedUrl = this.normalizeUrl(url);
          const exists = window.tabManager.tabs.some(t => {
            const tUrl = t.url || '';
            if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return false;
            return this.normalizeUrl(tUrl) === normalizedUrl;
          });
          
          if (!exists) {
            // Tab no está en TabManager - agregarlo
            const newTab = {
              id: window.tabManager.nextId++,
              url: url,
              title: spaceTab.title || null,
              active: false,
              favicon: spaceTab.favicon || null,
              backendId: spaceTab.id,
              avatar_emoji: spaceTab.avatar_emoji || null,
              avatar_color: spaceTab.avatar_color || null,
              avatar_photo: spaceTab.avatar_photo || null,
              cookie_container_id: spaceTab.cookie_container_id || 'default',
              spaceId: space.id
            };
            window.tabManager.tabs.push(newTab);
          }
        }
        
        // Buscar si hay algún tab activo del espacio en TabManager
        const activeSpaceTab = window.tabManager.tabs.find(t => {
          if (!t.active) return false;
          const tUrl = t.url || '';
          if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return false;
          return spaceTabUrls.has(this.normalizeUrl(tUrl));
        });
        
        if (activeSpaceTab) {
          // Ya hay un tab activo del espacio - no hacer nada
        } else {
          // No hay tab activo - abrir el primer tab del espacio (según position)
          const firstTab = this.spaceTabs[0];
          if (firstTab) {
            await this.selectSpaceTab(firstTab);
          }
        }
        
      // Renderizar para mostrar los tabs cargados
      if (window.tabManager.render) {
        window.tabManager.render();
      }
      
      // Update mobile bottom bar if on mobile
      if (window.mobileUI && typeof window.mobileUI.isMobile === 'function' && window.mobileUI.isMobile()) {
        setTimeout(() => {
          try {
            this.renderMobileBottomBar();
          } catch (err) {
            console.error('Error rendering mobile bottom bar:', err);
          }
        }, 100);
      }
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
      topbarSpace.style.display = 'none';
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

    topbarTabsCont.innerHTML = '';

    // USAR EXACTAMENTE LOS MISMOS TABS DE TabManager - CÓDIGO ÚNICO
    // Los tabs del TopBar son EXACTAMENTE los mismos que están en TabManager
    // Solo filtramos los que pertenecen al espacio activo
    const spaceTabUrls = new Set(
      this.spaceTabs.map(t => {
        const url = t.url || t.bookmark_url;
        return url ? this.normalizeUrl(url) : null;
      }).filter(Boolean)
    );

    // Filtrar tabs de TabManager que pertenecen a este espacio
    let spaceTabsInTabManager = (window.tabManager?.tabs || []).filter(t => {
      const tUrl = t.url || '';
      if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return false;
      return spaceTabUrls.has(this.normalizeUrl(tUrl));
    });
    
    // Ordenar según el orden del backend (position) - mapear cada tab de TabManager con su backend tab
    spaceTabsInTabManager = spaceTabsInTabManager.sort((a, b) => {
      const backendTabA = this.spaceTabs.find(t => {
        const url = t.url || t.bookmark_url;
        return url && this.normalizeUrl(url) === this.normalizeUrl(a.url || '');
      });
      const backendTabB = this.spaceTabs.find(t => {
        const url = t.url || t.bookmark_url;
        return url && this.normalizeUrl(url) === this.normalizeUrl(b.url || '');
      });
      
      const positionA = backendTabA?.position || 0;
      const positionB = backendTabB?.position || 0;
      return positionA - positionB;
    });

    // USAR EXACTAMENTE EL MISMO tabTemplate - CÓDIGO ÚNICO
    // Estos son los MISMOS objetos de TabManager, solo cambia isTopBar=true
    spaceTabsInTabManager.forEach(tabManagerTab => {
      // USAR EL OBJETO REAL DE TabManager - NO CREAR COPIA
      const tabHtml = window.tabManager.tabTemplate(tabManagerTab, true, true); // showMenu=true, isTopBar=true
      
      const tabWrapper = document.createElement('div');
      tabWrapper.innerHTML = tabHtml;
      const tabEl = tabWrapper.firstElementChild;
      
      // Buscar el tab del backend correspondiente para los handlers
      const backendTab = this.spaceTabs.find(t => {
        const url = t.url || t.bookmark_url;
        if (!url) return false;
        return this.normalizeUrl(url) === this.normalizeUrl(tabManagerTab.url || '');
      });
      
      // Agregar data-sortable-id para drag & drop (usar backendId)
      if (backendTab && tabEl) {
        tabEl.setAttribute('data-sortable-id', backendTab.id);
      }
      
      // Event handlers
      tabEl.onclick = (e) => {
        // Don't trigger tab selection if clicking menu button or menu itself
        if (!e.target.closest('.tab-menu-btn') && !e.target.closest('.tab-menu-dropdown')) {
          if (backendTab) {
            this.selectSpaceTab(backendTab);
          } else {
            // Si no hay backendTab, activar directamente el tab de TabManager
            window.tabManager?.activate(tabManagerTab.id);
          }
        }
      };

      // Menu button handler (3 dots) - EXACTAMENTE EL MISMO CÓDIGO QUE SIDEBAR
      // Usar el mismo handler que el sidebar para garantizar comportamiento idéntico
      const menuBtn = tabEl.querySelector('.tab-menu-btn');
      if (menuBtn) {
        // Si tiene backendId, obtener datos actualizados del backend (igual que sidebar)
        menuBtn.onclick = async (e) => {
          e.stopPropagation();
          
          // Si el tab tiene backendId, obtener datos actualizados del backend
          if (tabManagerTab.backendId) {
            try {
              const response = await this.request(`/api/tabs/${tabManagerTab.backendId}`);
              // Asegurar que el tab del backend tenga space_id correcto
              if (!response.tab.space_id && this.activeSpace) {
                response.tab.space_id = this.activeSpace.id;
              }
              this.showTabMenu(e, response.tab);
            } catch {
              // Si falla, usar datos del tab actual
              // IMPORTANTE: Incluir space_id del backendTab o del activeSpace
              const fallbackTab = {
                id: tabManagerTab.backendId,
                title: tabManagerTab.title,
                url: tabManagerTab.url,
                bookmark_url: tabManagerTab.url,
                avatar_emoji: tabManagerTab.avatar_emoji,
                avatar_color: tabManagerTab.avatar_color,
                avatar_photo: tabManagerTab.avatar_photo,
                cookie_container_id: tabManagerTab.cookie_container_id,
                space_id: backendTab?.space_id || (this.activeSpace?.id || null) // CRÍTICO: Incluir space_id
              };
              this.showTabMenu(e, fallbackTab);
            }
          } else if (backendTab) {
            // Si hay backendTab pero no backendId, usar backendTab directamente
            this.showTabMenu(e, backendTab);
          } else {
            // Tab sin backendId (tab nuevo o local) - crear objeto temporal
            const tempTab = {
              id: null,
              title: tabManagerTab.title,
              url: tabManagerTab.url,
              bookmark_url: tabManagerTab.url,
              avatar_emoji: tabManagerTab.avatar_emoji,
              avatar_color: tabManagerTab.avatar_color,
              avatar_photo: tabManagerTab.avatar_photo,
              cookie_container_id: tabManagerTab.cookie_container_id
            };
            this.showTabMenu(e, tempTab);
          }
        };
      }

      topbarTabsCont.appendChild(tabEl);
    });

    // Setup drag and drop for TopBar tabs
    setTimeout(() => {
      this.setupDragAndDrop('topbar-tabs-cont', this.spaceTabs, false, async ({ draggedId, targetId, position }) => {
          try {
            const oldIndex = this.spaceTabs.findIndex(t => t.id === draggedId);
            const newIndex = this.spaceTabs.findIndex(t => t.id === targetId);
            
            // Calcular finalIndex ANTES de remover el elemento
            let finalIndex = newIndex;
            if (position === 'after') {
              finalIndex = newIndex + 1;
            }
            
            // OPTIMISTIC UI: Actualizar inmediatamente
            const newTabs = [...this.spaceTabs];
            const [dragged] = newTabs.splice(oldIndex, 1);
            
            // Ajustar finalIndex si removimos un elemento antes de la posición objetivo
            if (oldIndex < finalIndex) {
              finalIndex -= 1;
            }
            
            newTabs.splice(finalIndex, 0, dragged);
          
          // Actualizar posiciones localmente
          for (let index = 0; index < newTabs.length; index++) {
            newTabs[index].position = index;
          }
          
          // Actualizar estado y renderizar INMEDIATAMENTE
          this.spaceTabs = newTabs;
          this.renderTopBar();
          
          // Llamar al backend en segundo plano (sin await para no bloquear)
          const updates = newTabs.map((tab, index) => ({ id: tab.id, position: index }));
          
          this.request('/api/tabs/reorder', {
            method: 'POST',
            body: JSON.stringify({ updates })
          }).catch(err => {
                  // Si falla, recargar desde el backend
            this.request(`/api/spaces/${this.activeSpace.id}`).then(({ tabs }) => {
              this.spaceTabs = (tabs || []).sort((a, b) => (a.position || 0) - (b.position || 0));
              this.renderTopBar();
            }).catch(() => {});
          });
        } catch {
          // Ignore errors
        }
      });
    }, 150);

    // Add tab button - estilo TopBar (SVG directo para evitar problemas de lucide)
    const addBtn = document.createElement('button');
    addBtn.className = 'ml-1 px-2 py-1 text-[#5f6368] hover:text-[#202124] hover:bg-[#e8eaed] rounded transition-colors shrink-0 flex items-center justify-center';
    addBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    addBtn.title = 'Add tab';
    addBtn.onclick = () => this.addSpaceTab();
    topbarTabsCont.appendChild(addBtn);
  }

  // Esta función ya no es necesaria - usamos tabTemplate de TabManager directamente

  selectSpaceTab(tab) {
    // Los tabs son los MISMOS - si ya existe uno con esta URL, activarlo (no crear duplicado)
    if (!window.tabManager) return;

    const url = tab.url || tab.bookmark_url;
    if (!url) return;

    const normalizedUrl = this.normalizeUrl(url);
    const tabManagerTabs = window.tabManager.tabs || [];
    
    // Buscar si el tab ya está abierto en TabManager (es el MISMO tab)
    // IMPORTANTE: Excluir tabs con /new o tabs://new (estos son tabs "nuevos" no inicializados)
    const existingTab = tabManagerTabs.find(t => {
      const tUrl = t.url || '';
      if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return false;
      // Comparar URLs normalizadas
      return this.normalizeUrl(tUrl) === normalizedUrl;
    });

    if (existingTab) {
      // Tab ya existe - solo activarlo (es el MISMO tab)
      window.tabManager.activate(existingTab.id);
      // Si es chat, asegurar que esté inicializado INMEDIATAMENTE
      if (this.isChatUrl(url)) {
        const spaceId = url.split('/').pop();
        const chatContainer = document.getElementById(`chat-${existingTab.id}`);
        if (chatContainer) {
          // Inicializar chat inmediatamente si no está inicializado
          if (!chatContainer.querySelector('.chat-container')) {
            this.initChat(existingTab.id, spaceId);
          }
        } else {
          // Si el container no existe, crearlo e inicializar
          window.tabManager.createIframes();
          const newChatContainer = document.getElementById(`chat-${existingTab.id}`);
          if (newChatContainer) {
            this.initChat(existingTab.id, spaceId);
          }
        }
      }
    } else {
      // Tab no existe - crear nuevo tab directamente con la URL correcta
      // NO usar add() porque crea un tab con /new por defecto
      // En su lugar, crear tab directamente en TabManager
      const newTab = {
        id: window.tabManager.nextId++,
        url: url,
        title: tab.title || null,
        active: true,
        favicon: tab.favicon || null,
        backendId: tab.id, // Guardar el ID del backend para referencia
        avatar_emoji: tab.avatar_emoji || null,
        avatar_color: tab.avatar_color || null,
        avatar_photo: tab.avatar_photo || null,
        cookie_container_id: tab.cookie_container_id || 'default',
        spaceId: tab.space_id || null // Guardar space_id para identificar tabs del espacio
      };
      
      // Desactivar todos los tabs existentes
      window.tabManager.tabs.forEach(t => t.active = false);
      
      window.tabManager.tabs.push(newTab);
      
      // Crear contenedor apropiado (chat, dashboard, o iframe)
      if (window.tabManager.isChatUrl && window.tabManager.isChatUrl(url)) {
        // Chat - crear e inicializar INMEDIATAMENTE sin delay
        window.tabManager.createIframes();
        const spaceId = url.split('/').pop();
        // Inicializar inmediatamente sin setTimeout
        const chatContainer = document.getElementById(`chat-${newTab.id}`);
        if (chatContainer) {
          this.initChat(newTab.id, spaceId);
        }
      } else if (window.tabManager.isSpecialUrl && window.tabManager.isSpecialUrl(url)) {
        // Dashboard u otro tipo especial
        window.tabManager.createIframes();
      } else {
        // URL normal - usar navigate para cargar correctamente
        if (window.tabManager.navigate) {
          window.tabManager.navigate(url);
        } else if (window.tabManager.updateUrl) {
          window.tabManager.updateUrl(url);
        }
      }
      
      // Renderizar y mostrar
      if (window.tabManager.render) {
        window.tabManager.render();
      }
      window.tabManager.showActive();
      if (window.tabManager.track) {
        window.tabManager.track(newTab.id);
      }
    }

    this.renderTopBar();
  }

  isChatUrl(url) {
    return url && (url.startsWith('luna://chat/') || url.startsWith('doge://chat/'));
  }

  // Show 3-dots menu for TopBar tabs
  showTabMenu(e, tab) {
    // Close any existing menu
    const existingMenu = document.querySelector('.tab-menu-dropdown');
    if (existingMenu) {
      existingMenu.remove();
      // Remove existing listener
      if (this.menuCloseListener) {
        document.removeEventListener('click', this.menuCloseListener);
        document.removeEventListener('mousedown', this.menuCloseListener);
        window.removeEventListener('blur', this.menuCloseListener);
      }
    }

    const isChat = tab.url?.startsWith('luna://chat/') || tab.url?.startsWith('doge://chat/');
    const button = e.target.closest('.tab-menu-btn');
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'tab-menu-dropdown absolute bg-white border border-[#e8eaed] rounded-lg shadow-lg py-1 z-50 min-w-[160px]';
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;

    // Cookie containers list (hardcoded for now, can be made dynamic later)
    const cookieContainers = [
      { id: 'default', name: 'Default' },
      { id: 'container1', name: 'Container 1' },
      { id: 'container2', name: 'Container 2' },
      { id: 'container3', name: 'Container 3' }
    ];

    menu.innerHTML = `
      <button class="tab-menu-edit w-full flex items-center gap-2 px-3 py-2 text-sm text-[#202124] hover:bg-[#f5f7fa] transition-colors text-left" data-tab-id="${tab.id}">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
        <span>Edit</span>
      </button>
      <div class="relative">
        <button class="tab-menu-container w-full flex items-center gap-2 px-3 py-2 text-sm text-[#202124] hover:bg-[#f5f7fa] transition-colors text-left" data-tab-id="${tab.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" x2="21" y1="9" y2="9"></line>
            <line x1="9" x2="9" y1="21" y2="9"></line>
          </svg>
          <span>Cookie Container</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-auto">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
        <div class="tab-container-submenu hidden absolute left-full top-0 ml-1 bg-white border border-[#e8eaed] rounded-lg shadow-lg py-1 min-w-[140px]">
          ${cookieContainers.map(container => `
            <button class="tab-container-option w-full flex items-center gap-2 px-3 py-2 text-sm text-[#202124] hover:bg-[#f5f7fa] transition-colors text-left ${tab.cookie_container_id === container.id ? 'bg-[#4285f4]/10 text-[#4285f4]' : ''}" data-tab-id="${tab.id}" data-container-id="${container.id}">
              <span>${this.escapeHTML(container.name)}</span>
              ${tab.cookie_container_id === container.id ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-auto"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
            </button>
          `).join('')}
        </div>
      </div>
      ${!isChat ? `
        <button class="tab-menu-close w-full flex items-center gap-2 px-3 py-2 text-sm text-[#ef4444] hover:bg-[#fef2f2] transition-colors text-left" data-tab-id="${tab.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
          <span>Close</span>
        </button>
      ` : ''}
    `;

    document.body.appendChild(menu);

      // Event handlers
      const editBtn = menu.querySelector('.tab-menu-edit');
      if (editBtn) {
        editBtn.onclick = (e) => {
          e.stopPropagation();
        // Cerrar submenu si existe
        if (menu._submenuCloseHandler) {
          document.removeEventListener('click', menu._submenuCloseHandler, true);
        }
        // Remover listener del contenedor de iframes si existe
        if (menu._fcnCloseHandler) {
          const fcnContainer = document.getElementById('fcn');
          if (fcnContainer) {
            fcnContainer.removeEventListener('click', menu._fcnCloseHandler, true);
          }
        }
        menu.remove();
        // Remove listener when closing
        if (this.menuCloseListener) {
          document.removeEventListener('click', this.menuCloseListener, true);
          document.removeEventListener('mousedown', this.menuCloseListener, true);
          window.removeEventListener('blur', this.menuCloseListener);
          this.menuCloseListener = null;
        }
        this.showEditTabModal(tab);
        };
      }

    const containerBtn = menu.querySelector('.tab-menu-container');
    if (containerBtn) {
      containerBtn.onmouseenter = () => {
        const submenu = menu.querySelector('.tab-container-submenu');
        if (submenu) {
          submenu.classList.remove('hidden');
        }
      };
      menu.onmouseleave = () => {
        const submenu = menu.querySelector('.tab-container-submenu');
        if (submenu) {
          submenu.classList.add('hidden');
        }
      };
    }

    const containerOptions = menu.querySelectorAll('.tab-container-option');
    containerOptions.forEach(option => {
      option.onclick = async (e) => {
        e.stopPropagation();
        const containerId = option.dataset.containerId;
        // Cerrar submenu si existe
        if (menu._submenuCloseHandler) {
          document.removeEventListener('click', menu._submenuCloseHandler, true);
        }
        // Remover listener del contenedor de iframes si existe
        if (menu._fcnCloseHandler) {
          const fcnContainer = document.getElementById('fcn');
          if (fcnContainer) {
            fcnContainer.removeEventListener('click', menu._fcnCloseHandler, true);
          }
        }
        menu.remove();
        // Remove listener when closing
        if (this.menuCloseListener) {
          document.removeEventListener('click', this.menuCloseListener, true);
          document.removeEventListener('mousedown', this.menuCloseListener, true);
          window.removeEventListener('blur', this.menuCloseListener);
          this.menuCloseListener = null;
        }
        await this.updateTabContainer(tab.id, containerId);
      };
    });

    const closeBtn = menu.querySelector('.tab-menu-close');
    if (closeBtn) {
      closeBtn.onclick = async (e) => {
        e.stopPropagation();
        // Cerrar submenu si existe
        if (menu._submenuCloseHandler) {
          document.removeEventListener('click', menu._submenuCloseHandler, true);
        }
        // Remover listener del contenedor de iframes si existe
        if (menu._fcnCloseHandler) {
          const fcnContainer = document.getElementById('fcn');
          if (fcnContainer) {
            fcnContainer.removeEventListener('click', menu._fcnCloseHandler, true);
          }
        }
        menu.remove();
        // Remove listener when closing
        if (this.menuCloseListener) {
          document.removeEventListener('click', this.menuCloseListener, true);
          document.removeEventListener('mousedown', this.menuCloseListener, true);
          window.removeEventListener('blur', this.menuCloseListener);
          this.menuCloseListener = null;
        }
        
        // CERRAR TAB: Funciona igual para tabs personales Y tabs de espacios
        // Usar el MISMO código para ambos casos
        // IMPORTANTE: Verificar space_id del tab para determinar si es tab de espacio o personal
        const hasSpaceId = tab.space_id !== null && tab.space_id !== undefined;
        
        if (hasSpaceId) {
          // Tab de espacio: usar deleteSpaceTab
          // Pasar el objeto tab completo para evitar problemas de sincronización
          await this.deleteSpaceTab(tab.id, tab); // Pasar tab completo como segundo parámetro
        } else {
          // Tab personal: cerrar desde TabManager (que ya maneja el backend)
          if (window.tabManager) {
            // Buscar el tab en TabManager por backendId o URL
            const tabUrl = tab.url || tab.bookmark_url;
            const tabManagerTab = window.tabManager.tabs.find(t => {
              if (tab.id && t.backendId === tab.id) return true;
              if (tabUrl) {
                const tUrl = t.url || '';
                if (tUrl && tUrl !== '/new' && tUrl !== 'tabs://new') {
                  return this.normalizeUrl(tUrl) === this.normalizeUrl(tabUrl);
                }
              }
              return false;
            });
            
            if (tabManagerTab) {
              // Cerrar usando TabManager.close (que ya está interceptado para manejar el backend)
              window.tabManager.close(tabManagerTab.id);
            } else {
              // Si no está en TabManager, eliminar directamente del backend
              try {
                await this.request(`/api/tabs/${tab.id}`, { method: 'DELETE' });
                // Recargar tabs personales
                await this.loadPersonalTabs();
                await this.syncTabsToTabManager();
              } catch (err) {
                console.error('Failed to delete personal tab:', err);
                alert('Failed to delete tab');
              }
            }
          } else {
            // Fallback: eliminar directamente del backend
            try {
              await this.request(`/api/tabs/${tab.id}`, { method: 'DELETE' });
              await this.loadPersonalTabs();
              await this.syncTabsToTabManager();
            } catch (err) {
              console.error('Failed to delete personal tab:', err);
              alert('Failed to delete tab');
            }
          }
        }
      };
    }

    // Close menu when clicking outside - usando listeners globales para detectar clics en iframe
    const closeMenu = (event) => {
      // Verificar si el clic fue fuera del menú y del botón
      const target = event.target;
      const clickedInsideMenu = menu.contains(target);
      const clickedOnButton = button && button.contains(target);
      
      // Si no se hizo clic dentro del menú ni en el botón, cerrar
      if (!clickedInsideMenu && !clickedOnButton) {
        // Cerrar submenu si existe
        if (menu._submenuCloseHandler) {
          document.removeEventListener('click', menu._submenuCloseHandler, true);
        }
        // Remover listeners del contenedor de iframes si existen
        const fcnContainer = document.getElementById('fcn');
        if (fcnContainer && menu._fcnCloseHandler) {
          fcnContainer.removeEventListener('click', menu._fcnCloseHandler, true);
          fcnContainer.removeEventListener('mousedown', menu._fcnCloseHandler, true);
        }
        menu.remove();
        document.removeEventListener('click', closeMenu, true);
        document.removeEventListener('mousedown', closeMenu, true);
        window.removeEventListener('blur', closeMenu);
        if (this.menuCloseListener) {
          this.menuCloseListener = null;
        }
      }
    };
    
    // Guardar referencia para poder removerla después
    this.menuCloseListener = closeMenu;
    
    // Agregar listener directamente al contenedor de iframes para detectar clicks en el webview
    const fcnContainer = document.getElementById('fcn');
    if (fcnContainer) {
      const fcnCloseHandler = (e) => {
        // Si se hace clic en el contenedor de iframes, cerrar el menú
        if (menu && menu.parentNode) {
          closeMenu(e);
        }
      };
      fcnContainer.addEventListener('click', fcnCloseHandler, true);
      fcnContainer.addEventListener('mousedown', fcnCloseHandler, true);
      menu._fcnCloseHandler = fcnCloseHandler;
    }
    
    // Listeners globales en document y window para capturar eventos incluso cuando el mouse está sobre el iframe
    setTimeout(() => {
      document.addEventListener('click', closeMenu, true); // Capture phase - intercepta antes del iframe
      document.addEventListener('mousedown', closeMenu, true); // También mousedown
      window.addEventListener('blur', closeMenu); // También blur para cuando se pierde el foco
    }, 0);
  }

  // Show Edit Tab Modal (Luna style - allows editing name, URL, and icon)
  showEditTabModal(tab, isNewTab = false) {
    // Remove existing modal if any
    const existingModal = document.getElementById('edit-tab-modal');
    if (existingModal) {
      existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'edit-tab-modal';
    modal.className = 'fixed inset-0 bg-[#000000]/30 flex items-center justify-center z-[10000]';
    modal.style.backdropFilter = 'blur(4px)';

    const COLORS = [
      null,
      '#4285f4',
      '#9333ea',
      '#10b981',
      '#059669',
      '#84cc16',
      '#f59e0b',
      '#ef4444',
      '#ec4899',
    ];

    // Initialize form data
    let formData = {
      title: tab.title || '',
      url: tab.url || tab.bookmark_url || '',
      emoji: tab.avatar_emoji || '',
      color: tab.avatar_color || null,
      photo: tab.avatar_photo || null
    };

    const updatePreview = () => {
      const preview = modal.querySelector('#icon-preview');
      if (!preview) return;
      
      if (formData.photo) {
        preview.innerHTML = `<img src="${formData.photo}" alt="Avatar" class="w-full h-full rounded-full object-cover" />`;
      } else if (formData.emoji) {
        preview.innerHTML = `<span class="text-3xl">${formData.emoji}</span>`;
      } else {
        preview.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="9" x2="15" y1="15" y2="15"/></svg>`;
      }
    };

    modal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-md" onclick="event.stopPropagation()">
        <div class="flex items-center justify-between px-4 py-3 border-b border-[#e8eaed]">
          <h2 class="text-base font-semibold text-[#202124]">${isNewTab ? 'Create New Tab' : 'Edit Tab'}</h2>
          <button id="edit-modal-close" class="p-1 hover:bg-[#e8eaed] rounded-full transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-[#5f6368]">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="p-4 space-y-4">
          <!-- Icon Preview -->
          <div class="flex justify-center relative">
            <div
              id="icon-preview"
              class="w-16 h-16 rounded-full flex items-center justify-center border-4"
              style="border-color: ${formData.color || '#e8eaed'}; color: ${formData.color || '#6b7280'}; background-color: transparent"
            ></div>
            <label class="absolute bottom-0 right-0 w-6 h-6 bg-[#4285f4] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#3367d6] transition-colors" style="transform: translate(25%, 25%);">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <input type="file" accept="image/*" class="hidden" id="photo-upload" />
            </label>
          </div>

          <!-- Title -->
          <div>
            <label class="block text-xs font-medium text-[#202124] mb-1.5">Tab Name</label>
            <input
              type="text"
              id="edit-tab-title"
              value="${this.escapeHTML(formData.title)}"
              class="w-full px-3 py-2 border border-[#e8eaed] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4285f4] focus:border-transparent"
              placeholder="Enter tab name"
            />
          </div>

          <!-- URL -->
          <div>
            <label class="block text-xs font-medium text-[#202124] mb-1.5">URL</label>
            <input
              type="text"
              id="edit-tab-url"
              value="${this.escapeHTML(formData.url)}"
              class="w-full px-3 py-2 border border-[#e8eaed] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4285f4] focus:border-transparent"
              placeholder="https://example.com"
            />
          </div>

          <!-- Emoji -->
          <div>
            <label class="block text-xs font-medium text-[#202124] mb-1.5">Emoji or Text (optional)</label>
            <input
              type="text"
              id="edit-tab-emoji"
              value="${this.escapeHTML(formData.emoji)}"
              maxlength="2"
              class="w-full px-3 py-2 border border-[#e8eaed] rounded-lg text-center text-lg focus:outline-none focus:ring-2 focus:ring-[#4285f4] focus:border-transparent"
              placeholder="😀 or A"
            />
          </div>

          <!-- Color -->
          <div>
            <label class="block text-xs font-medium text-[#202124] mb-2">Select Color</label>
            <div class="flex gap-2 justify-center flex-wrap">
              ${COLORS.map(c => `
                <button
                  class="color-option w-8 h-8 rounded-full transition-all ${formData.color === c ? 'ring-2 ring-offset-1 ring-[#4285f4] scale-110' : 'hover:scale-105'}"
                  style="background-color: ${c || '#f3f4f6'}; border: ${c ? 'none' : '2px solid #e5e7eb'}"
                  data-color="${c || 'null'}"
                  title="${c ? '' : 'No color'}"
                >
                  ${!c ? '<span class="text-[#9aa0a6] text-[10px]">∅</span>' : ''}
                </button>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#e8eaed]">
          <button id="edit-modal-cancel" class="px-3 py-1.5 text-sm text-[#5f6368] hover:bg-[#f5f7fa] rounded-lg transition-colors">
            Cancel
          </button>
          <button id="edit-modal-save" class="px-3 py-1.5 text-sm bg-[#4285f4] text-white rounded-lg hover:bg-[#3367d6] transition-colors">
            ${isNewTab ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    updatePreview();

    // Event handlers
    const titleInput = modal.querySelector('#edit-tab-title');
    const urlInput = modal.querySelector('#edit-tab-url');
    const emojiInput = modal.querySelector('#edit-tab-emoji');
    const photoUpload = modal.querySelector('#photo-upload');
    const colorOptions = modal.querySelectorAll('.color-option');
    const closeBtn = modal.querySelector('#edit-modal-close');
    const cancelBtn = modal.querySelector('#edit-modal-cancel');
    const saveBtn = modal.querySelector('#edit-modal-save');

    titleInput.addEventListener('input', (e) => {
      formData.title = e.target.value;
    });

    urlInput.addEventListener('input', (e) => {
      formData.url = e.target.value;
    });

    emojiInput.addEventListener('input', (e) => {
      formData.emoji = e.target.value.slice(0, 2);
      updatePreview();
    });

    photoUpload.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
          formData.photo = reader.result;
          updatePreview();
        };
        reader.readAsDataURL(file);
      }
    });

    colorOptions.forEach(option => {
      option.addEventListener('click', () => {
        const color = option.dataset.color === 'null' ? null : option.dataset.color;
        formData.color = color;
        const preview = modal.querySelector('#icon-preview');
        if (preview) {
          preview.style.borderColor = color || '#e8eaed';
          preview.style.color = color || '#6b7280';
        }
        colorOptions.forEach(opt => {
          if (opt.dataset.color === option.dataset.color) {
            opt.classList.add('ring-2', 'ring-offset-1', 'ring-[#4285f4]', 'scale-110');
          } else {
            opt.classList.remove('ring-2', 'ring-offset-1', 'ring-[#4285f4]', 'scale-110');
          }
        });
      });
    });

    const closeModal = () => {
      modal.remove();
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    saveBtn.addEventListener('click', async () => {
      try {
        let createdTab = null;
        
        if (isNewTab) {
          // Create new tab
          // Usar el space_id del objeto tab (que viene del contexto donde se abrió el modal)
          // Si se abrió desde el sidebar, tab.space_id será null (tab personal)
          // Si se abrió desde el TopBar, tab.space_id será el id del espacio (tab del proyecto)
          const spaceId = tab?.space_id !== undefined ? tab.space_id : null;
          // Si title está vacío, no enviarlo (el backend usará URL como título por defecto)
          // Si title tiene valor, enviarlo (será fijo)
          const requestBody = {
            url: formData.url.trim(),
            space_id: spaceId,
            type: 'browser',
            avatar_emoji: formData.emoji || null,
            avatar_color: formData.color,
            avatar_photo: formData.photo
          };
          
          // Solo incluir title si tiene valor
          if (formData.title.trim()) {
            requestBody.title = formData.title.trim();
          }
          
          const response = await this.request('/api/tabs', {
            method: 'POST',
            body: JSON.stringify(requestBody)
          });
          createdTab = response.tab;
        } else {
          // Update existing tab
          await this.updateTab(tab.id, {
            title: formData.title.trim(),
            url: formData.url.trim(),
            avatar_emoji: formData.emoji || null,
            avatar_color: formData.color,
            avatar_photo: formData.photo
          });
        }
        closeModal();
        
        // Recargar tabs según el contexto
        if (this.activeSpace) {
          // Si estamos en un espacio, recargar los tabs del espacio
          const { tabs } = await this.request(`/api/spaces/${this.activeSpace.id}`);
          this.spaceTabs = tabs || [];
          this.renderTopBar();
          
          // Si es un tab nuevo, abrirlo
          if (isNewTab && createdTab) {
            const spaceTab = this.spaceTabs.find(t => t.id === createdTab.id);
            if (spaceTab) {
              await this.selectSpaceTab(spaceTab);
            }
          }
        } else {
          // Si es un tab personal, recargar tabs personales
          await this.loadPersonalTabs();
          await this.syncTabsToTabManager();
          
          // NO activar el nuevo tab automáticamente - debe aparecer al final sin activarse
          // El tab ya está en el backend con la posición correcta (al final)
          // syncTabsToTabManager lo agregará al final de TabManager sin activarlo
        }
        
        // Sincronizar cambios con TabManager (los tabs son los mismos)
        if (window.tabManager) {
          // Código duplicado eliminado - ya se hizo arriba
          if (this.activeSpace) {
            // Si es un tab de espacio, solo actualizar TabManager si no es un tab nuevo
            // Para tabs nuevos, ya se recargaron los tabs del espacio arriba
            if (!isNewTab && tab.id) {
              try {
                const updatedTab = await this.request(`/api/tabs/${tab.id}`);
                const tabUrl = updatedTab.tab.url || updatedTab.tab.bookmark_url;
                if (tabUrl && window.tabManager.tabs) {
                  const tabManagerTab = window.tabManager.tabs.find(t => {
                    const tUrl = t.url || '';
                    if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return false;
                    return this.normalizeUrl(tUrl) === this.normalizeUrl(tabUrl);
                  });
                  if (tabManagerTab) {
                    tabManagerTab.title = updatedTab.tab.title;
                    tabManagerTab.avatar_emoji = updatedTab.tab.avatar_emoji;
                    tabManagerTab.avatar_color = updatedTab.tab.avatar_color;
                    tabManagerTab.avatar_photo = updatedTab.tab.avatar_photo;
                  }
                }
              } catch (err) {
                // Si falla la actualización, no es crítico - los tabs ya se recargaron arriba
                // Ignore update errors
              }
            }
          }
          if (window.tabManager.render) {
            window.tabManager.render();
          }
        }
      } catch (err) {
        console.error('Failed to save tab:', err);
        alert(`Failed to ${isNewTab ? 'create' : 'update'} tab`);
      }
    });
  }

  async updateTab(tabId, data) {
    return this.request(`/api/tabs/${tabId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async updateTabContainer(tabId, containerId) {
    try {
      await this.updateTab(tabId, { cookie_container_id: containerId });
      // Reload space tabs
      if (this.activeSpace) {
        const { tabs } = await this.request(`/api/spaces/${this.activeSpace.id}`);
        this.spaceTabs = tabs || [];
        this.renderTopBar();
      }
      // Sincronizar cambios con TabManager
      if (window.tabManager) {
        // Actualizar el tab en TabManager si existe
        const updatedTab = await this.request(`/api/tabs/${tabId}`);
        const tabUrl = updatedTab.tab.url || updatedTab.tab.bookmark_url;
        if (tabUrl && window.tabManager.tabs) {
          const tabManagerTab = window.tabManager.tabs.find(t => {
            const tUrl = t.url || '';
            if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return false;
            return this.normalizeUrl(tUrl) === this.normalizeUrl(tabUrl);
          });
          if (tabManagerTab) {
            tabManagerTab.cookie_container_id = containerId;
          }
        }
        if (window.tabManager.render) {
          window.tabManager.render();
        }
      }
    } catch (err) {
      console.error('Failed to update tab container:', err);
      alert('Failed to update cookie container');
    }
  }

  async deleteSpaceTab(tabId, tabData = null) {
    if (!this.activeSpace) return;

    // Usar tabData si se proporciona (evita problemas de sincronización)
    let tab = tabData;
    
    // Si no se proporciona tabData, buscar en spaceTabs
    if (!tab) {
      tab = this.spaceTabs.find(t => t.id === tabId);
    }
    
    // Si todavía no está, obtenerlo del backend
    if (!tab) {
      try {
        const response = await this.request(`/api/tabs/${tabId}`);
        tab = response.tab;
        if (!tab) {
          // Remover de spaceTabs por si acaso y actualizar UI
          this.spaceTabs = this.spaceTabs.filter(t => t.id !== tabId);
          this.renderTopBar();
          return;
        }
      } catch (err) {
        // Si el tab ya no existe (404), asumir que ya fue eliminado
        if (err.message && (err.message.includes('404') || err.message?.includes('Not Found'))) {
          // Remover de spaceTabs por si acaso
          this.spaceTabs = this.spaceTabs.filter(t => t.id !== tabId);
          this.renderTopBar();
          return;
        }
        return;
      }
    }
    
    // No permitir eliminar Chat tab
    if (tab.url?.startsWith('luna://chat/') || tab.url?.startsWith('doge://chat/')) {
      return;
    }

    try {
      // Eliminar del backend - usar el MISMO endpoint que tabs personales
      await this.request(`/api/tabs/${tabId}`, { method: 'DELETE' });
      
      // OPTIMISTIC UI: Remover inmediatamente del array local
      this.spaceTabs = this.spaceTabs.filter(t => t.id !== tabId);
      this.renderTopBar(); // Actualizar UI inmediatamente
      
      // Cerrar en TabManager (si estaba abierto)
      if (window.tabManager) {
        const tabUrl = tab?.url || tab?.bookmark_url;
        if (tabUrl) {
          const normalizedUrl = this.normalizeUrl(tabUrl);
          const tabToClose = window.tabManager.tabs.find(t => {
            const tUrl = t.url || '';
            if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return false;
            return this.normalizeUrl(tUrl) === normalizedUrl;
          });
          
          if (tabToClose) {
            // Eliminar directamente del array de TabManager (no usar close porque ya está eliminado del backend)
            const index = window.tabManager.tabs.indexOf(tabToClose);
            if (index > -1) {
              window.tabManager.tabs.splice(index, 1);
              // Si era el tab activo, activar otro
              if (tabToClose.active && window.tabManager.tabs.length > 0) {
                window.tabManager.tabs[0].active = true;
              }
              window.tabManager.render();
              if (window.tabManager.createIframes) {
                window.tabManager.createIframes();
              }
              if (window.tabManager.showActive) {
                window.tabManager.showActive();
              }
            }
          }
        }
      }
      
      // Recargar space tabs desde el backend para verificar sincronización (en segundo plano)
      try {
        const { tabs } = await this.request(`/api/spaces/${this.activeSpace.id}`);
        const reloadedTabs = (tabs || []).sort((a, b) => (a.position || 0) - (b.position || 0));
        
        // Verificar que el tab eliminado NO esté en la respuesta
        const deletedTabStillExists = reloadedTabs.some(t => t.id === tabId);
        if (deletedTabStillExists) {
          // Eliminar de nuevo como fallback
          await this.request(`/api/tabs/${tabId}`, { method: 'DELETE' });
        }
        
        this.spaceTabs = reloadedTabs;
        this.renderTopBar();
      } catch (reloadErr) {
        // No alertar al usuario - el UI ya está actualizado optimísticamente
      }
      
    } catch (err) {
      alert('Failed to delete tab: ' + (err.message || 'Unknown error'));
    }
  }

  async addSpaceTab() {
    if (!this.activeSpace) return;

    // USAR EL MISMO MODAL QUE EL BOTÓN DE AFUERA - solo cambia el contexto (space_id)
    // Mostrar el modal de edición en modo creación
    this.showEditTabModal({
      id: null,
      title: '',
      url: '',
      bookmark_url: '',
      avatar_emoji: null,
      avatar_color: null,
      avatar_photo: null,
      space_id: this.activeSpace.id
    }, true); // true = isNewTab
  }

  // Clear active space (go back to personal tabs)
  clearActiveSpace() {
    // NO cerrar tabs - los tabs se mantienen abiertos como en un browser normal
    // Solo cambiar la vista: ocultar TopBar y mostrar tabs personales en sidebar
    this.activeSpace = null;
    this.spaceTabs = [];
    this.renderProjects();
    this.renderUsers();
    this.renderTopBar(); // Esto oculta el TopBar
    
    // Actualizar sidebar para mostrar solo tabs personales (el filtrado ya está en tabs.js)
    if (window.tabManager && window.tabManager.render) {
      window.tabManager.render();
    }
  }


  renderProjects() {
    const container = document.getElementById('projects-cont');
    if (!container) return;
    
    // También actualizar vista móvil SIEMPRE (usa el mismo código)
    setTimeout(() => {
      const mobileProjectsView = document.getElementById('mobile-projects-view');
      if (mobileProjectsView) {
        // Re-render mobile view to sync with sidebar
        if (mobileProjectsView.classList.contains('active')) {
          this.renderMobileProjects();
        }
      }
    }, 50);

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
      projectEl.className = `project-item group flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all ${
        isActive ? 'bg-[#4285f4]/10 text-[#4285f4] font-medium shadow-sm' : 'text-[#202124] hover:bg-[#e8eaed]'
      }`;
      projectEl.style.cursor = 'pointer';
      
      // Chevron for expand/collapse (EXACTLY like luna-chat) - más compacto
      const chevronHtml = hasChildren 
        ? `<button class="p-0.5 hover:bg-gray-100 rounded transition-colors z-10 expand-btn" data-project-id="${project.id}">
            ${project.is_expanded !== false 
              ? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>'
              : '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'
            }
          </button>`
        : '<div class="w-4"></div>'; // Spacer if no children - más pequeño
      
      projectEl.innerHTML = `
        ${chevronHtml}
        <div class="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style="border: 1px solid ${project.avatar_color || '#e8eaed'}; color: ${project.avatar_color || '#6b7280'}">
          ${iconHtml}
        </div>
        <span class="flex-1 text-xs truncate">${this.escapeHTML(project.name)}</span>
        <button class="project-archive-btn opacity-0 group-hover:opacity-100 hover:text-[#4285f4] transition-opacity p-0.5 cursor-pointer" data-project-id="${project.id}" title="Archive" style="cursor: pointer;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
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
          // DESACTIVAR TODOS LOS PROYECTOS/USUARIOS PRIMERO - solo uno activo
          document.querySelectorAll('.project-item').forEach(el => {
            el.classList.remove('bg-[#4285f4]/10', 'text-[#4285f4]', 'font-medium', 'shadow-sm');
            el.classList.add('hover:bg-[#f5f7fa]');
          });
          document.querySelectorAll('.user-item').forEach(el => {
            el.classList.remove('bg-[#4285f4]/10', 'text-[#4285f4]', 'font-medium', 'shadow-sm');
            el.classList.add('hover:bg-[#e8eaed]');
          });
          
          // Activar este proyecto
          projectEl.classList.add('bg-[#4285f4]/10', 'text-[#4285f4]', 'font-medium', 'shadow-sm');
          projectEl.classList.remove('hover:bg-[#f5f7fa]');
          
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

    // OPTIMISTIC UI: Update local state immediately for instant feedback
    const newExpanded = !project.is_expanded;
    project.is_expanded = newExpanded;
    
    // Re-render immediately to show updated hierarchy
    this.renderProjects();
    
    // Update backend in background (don't wait for response)
    this.request(`/api/spaces/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify({
        is_expanded: newExpanded
      })
    }).catch(err => {
      // If backend update fails, revert the change
      console.error('Failed to toggle project expanded:', err);
      project.is_expanded = !newExpanded;
      this.renderProjects();
    });
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
    
    // También actualizar vista móvil SIEMPRE (usa el mismo código)
    setTimeout(() => {
      const mobileMessengerView = document.getElementById('mobile-messenger-view');
      if (mobileMessengerView) {
        // Re-render mobile view to sync with sidebar
        if (mobileMessengerView.classList.contains('active')) {
          this.renderMobileMessenger();
        }
      }
    }, 50);

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
      userEl.className = `user-item flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all relative ${
        isActive ? 'bg-[#4285f4]/10 text-[#4285f4] font-medium shadow-sm' : 'text-[#202124] hover:bg-[#e8eaed]'
      }`;
      userEl.setAttribute('data-sortable-id', user.id);
      
      userEl.innerHTML = `
        <div class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-medium flex-shrink-0 overflow-hidden">
          ${user.other_user_photo ? `<img src="${user.other_user_photo}" alt="" class="w-full h-full object-cover" />` : `<span class="text-xs">${initial}</span>`}
        </div>
        <span class="flex-1 text-xs truncate">${this.escapeHTML(displayName)}</span>
      `;
      
      // Set event listener AFTER setting innerHTML
      userEl.addEventListener('click', (e) => {
        if (!e.target.closest('.drop-indicator')) {
          // DESACTIVAR TODOS LOS PROYECTOS/USUARIOS PRIMERO - solo uno activo
          document.querySelectorAll('.project-item').forEach(el => {
            el.classList.remove('bg-[#4285f4]/10', 'text-[#4285f4]', 'font-medium', 'shadow-sm');
            el.classList.add('hover:bg-[#f5f7fa]');
          });
          document.querySelectorAll('.user-item').forEach(el => {
            el.classList.remove('bg-[#4285f4]/10', 'text-[#4285f4]', 'font-medium', 'shadow-sm');
            el.classList.add('hover:bg-[#e8eaed]');
          });
          
          // Activar este usuario
          userEl.classList.add('bg-[#4285f4]/10', 'text-[#4285f4]', 'font-medium', 'shadow-sm');
          userEl.classList.remove('hover:bg-[#e8eaed]');
          
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
        
        // Ajustar finalIndex si removimos un elemento antes de la posición objetivo
        if (oldIndex < finalIndex) {
          finalIndex -= 1;
        }
        
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
      
      // Seleccionar automáticamente el proyecto recién creado
      await this.selectProject(space.id);
      
      // Crear automáticamente un tab de Notion "Dashboard" si el proyecto tiene notion_page_url
      if (space.notion_page_url) {
        try {
          // Crear el tab directamente en el backend
          const { tab } = await this.request('/api/tabs', {
            method: 'POST',
            body: JSON.stringify({
              url: space.notion_page_url,
              title: 'Dashboard',
              type: 'browser',
              space_id: space.id
            })
          });
          
          // Recargar los tabs del espacio para incluir el nuevo tab
          const { tabs } = await this.request(`/api/spaces/${space.id}`);
          this.spaceTabs = (tabs || []).sort((a, b) => (a.position || 0) - (b.position || 0));
          this.renderTopBar();
          
          // Buscar el tab de Dashboard y abrirlo
          const dashboardTab = this.spaceTabs.find(t => t.id === tab.id);
          if (dashboardTab) {
            // Cargar el tab en TabManager si no está
            await this.selectSpaceTab(dashboardTab);
          }
        } catch {
          // No mostrar error al usuario - el proyecto se creó exitosamente
        }
      }
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

    const wrapper = chatContainer.querySelector('.chat-wrapper');
    if (!wrapper) return;

    // Renderizar UI básica inmediatamente (sin esperar API)
    // Esto evita mostrar una pantalla de carga
    if (!wrapper.querySelector('.chat-container')) {
      wrapper.innerHTML = `
        <div class="chat-container" style="display: flex; flex-direction: column; height: 100%;">
          <div class="chat-messages" style="flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; background: #ffffff;" data-chat-id="">
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

      // Attach send handler inmediatamente
      const form = wrapper.querySelector('.chat-form');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const input = wrapper.querySelector('.chat-input');
          const message = input?.value?.trim();
          if (message && this.currentChatId) {
            this.sendChatMessage(this.currentChatId, message);
            input.value = '';
          }
        });
      }
    }

    // Cargar chat y mensajes en background
    try {
      const { chat } = await this.request(`/api/chat/space/${spaceId}`);
      if (!chat) return;

      // Actualizar chat-id en el contenedor de mensajes
      const messagesContainer = wrapper.querySelector('.chat-messages');
      if (messagesContainer) {
        messagesContainer.setAttribute('data-chat-id', chat.id);
        this.currentChatId = chat.id; // Guardar para el handler de submit
      }

      // Cargar mensajes
      this.loadChatMessages(wrapper, chat.id);
    } catch (err) {
      // Solo mostrar error si no se ha renderizado nada todavía
      const messagesContainer = wrapper.querySelector('.chat-messages');
      if (messagesContainer && !messagesContainer.hasAttribute('data-chat-id')) {
        messagesContainer.innerHTML = `
          <div style="padding: 20px; text-align: center; color: #5f6368;">
            Failed to load chat
          </div>
        `;
      }
    }
  }

  renderChat(container, chatId) {
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

    // Determinar si es horizontal (TopBar) o vertical (sidebar)
    const isHorizontal = containerId === 'topbar-tabs-cont';

    let draggedElement = null;
    let draggedId = null;
    let dropIndicator = null;
    let activationDistance = 5; // Same as luna-chat
    let dragStartY = 0;
    let dragStartX = 0;
    let isDragging = false;
    let isReordering = false; // Flag para prevenir múltiples llamadas

    // Track mouse position
    const handleMouseMove = (e) => {
      this.mouseY = e.clientY;
      this.mouseX = e.clientX;
      if (isDragging && draggedElement) {
        const elementAtPoint = document.elementFromPoint(e.clientX, e.clientY);
        const moreBtn = document.getElementById('sidebar-more-btn');
        const moreDropdown = document.getElementById('more-dropdown-content');
        const moreDropdownMenu = document.getElementById('more-dropdown');
        
        // Simple visual feedback - solid color when over More button/dropdown
        if (containerId === 'tabs-cont' && moreBtn) {
          const isOverMore = moreBtn.contains(elementAtPoint) || moreBtn === elementAtPoint;
          const isOverMoreDropdown = moreDropdown && (moreDropdown.contains(elementAtPoint) || moreDropdown === elementAtPoint);
          const isOverMoreMenu = moreDropdownMenu && (moreDropdownMenu.contains(elementAtPoint) || moreDropdownMenu === elementAtPoint);
          
          if (isOverMore || isOverMoreDropdown || isOverMoreMenu) {
            moreBtn.style.backgroundColor = '#e8f0fe';
            // Open dropdown if not already open
            if (moreDropdownMenu && !moreDropdownMenu.classList.contains('active')) {
              this.showMoreDropdown();
            }
          } else {
            moreBtn.style.backgroundColor = '';
          }
        }
        
        this.handleDragMove(e, container, items, allowHierarchy, (indicator) => {
          dropIndicator = indicator;
          this.updateDropIndicators(containerId, indicator, isHorizontal);
        }, isHorizontal);
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    container.addEventListener('mousedown', (e) => {
      // No permitir drag si se hace click en el botón del menú o en el menú dropdown
      if (e.target.closest('.tab-menu-btn') || e.target.closest('.tab-menu-dropdown')) {
        return;
      }
      
      // Try to find element with data-sortable-id first, then fallback to data-tab-id
      let itemElement = e.target.closest('[data-sortable-id]');
      if (!itemElement) {
        itemElement = e.target.closest('[data-tab-id]');
      }
      if (!itemElement) {
        return;
      }

      draggedId = itemElement.dataset.sortableId || itemElement.dataset.tabId;
      draggedElement = itemElement;
      dragStartY = e.clientY;
      dragStartX = e.clientX;
      isDragging = false;
      isReordering = false; // Resetear flag al iniciar nuevo drag

      const handleMouseMoveDrag = (e) => {
        // Para horizontal, usar distancia X; para vertical, usar Y
        const distance = isHorizontal 
          ? Math.abs(e.clientX - dragStartX)
          : Math.abs(e.clientY - dragStartY);
        if (distance >= activationDistance && !isDragging && draggedElement) {
          isDragging = true;
          
          // Congelar el hover: agregar clase para mantener estilo hover + mostrar menú
          draggedElement.classList.add('dragging-item');
          container.classList.add('dragging-active');
          
          // Opacidad reducida para indicar que está siendo arrastrado
          draggedElement.style.opacity = '0.7';
          this.handleDragStart(draggedElement);
        }
      };

      const handleMouseUp = async (e) => {
        
        // CRÍTICO: Detener todos los listeners inmediatamente
        window.removeEventListener('mousemove', handleMouseMoveDrag);
        window.removeEventListener('mouseup', handleMouseUp);
        
        // Limpiar indicadores SIEMPRE al soltar
        this.clearDropIndicators(containerId, isHorizontal);
        const finalDropIndicator = dropIndicator;
        dropIndicator = null;
        
        // Clean up visual feedback
        const moreBtnCleanup = document.getElementById('sidebar-more-btn');
        const tabsContCleanup = document.getElementById('tabs-cont');
        if (moreBtnCleanup) {
          moreBtnCleanup.style.backgroundColor = '';
          moreBtnCleanup.style.border = '';
        }
        if (tabsContCleanup) {
          tabsContCleanup.style.backgroundColor = '';
        }

        // Remover clases de drag
        container.classList.remove('dragging-active');
        
        if (isDragging && draggedElement && !isReordering) {
          if (draggedElement && draggedElement.style) {
            // Restaurar estilos del elemento arrastrado
            draggedElement.style.opacity = '';
            draggedElement.style.cursor = '';
            draggedElement.classList.remove('dragging-item');
          }
          
          // Check if dropping on a different container (for moving between sidebar and More)
          const elementAtPoint = document.elementFromPoint(e.clientX, e.clientY);
          const tabsContDrop = document.getElementById('tabs-cont');
          const moreDropdown = document.getElementById('more-dropdown-content');
          const moreDropdownMenu = document.getElementById('more-dropdown');
          const moreBtnDrop = document.getElementById('sidebar-more-btn');
          let dropTarget = containerId;
          
          // Helper to check if element is within a target (including children)
          const isWithinElement = (element, target) => {
            if (!element || !target) return false;
            if (element === target) return true;
            if (target.contains(element)) return true;
            // Also check if element or its parents match the target
            let current = element;
            while (current && current !== document.body) {
              if (current === target) return true;
              current = current.parentElement;
            }
            return false;
          };
          
          // Check if dropping on More button or dropdown (from sidebar tabs)
          if (containerId === 'tabs-cont') {
            // Check if over More button (highest priority) - check elementAtPoint and its parents
            if (moreBtnDrop && isWithinElement(elementAtPoint, moreBtnDrop)) {
              dropTarget = 'more-dropdown-content';
              // Open dropdown if not already open
              if (moreDropdownMenu && !moreDropdownMenu.classList.contains('active')) {
                this.showMoreDropdown();
                // Wait a bit for dropdown to render
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            } 
            // Check if over dropdown menu
            else if (moreDropdownMenu && isWithinElement(elementAtPoint, moreDropdownMenu)) {
              dropTarget = 'more-dropdown-content';
            }
            // Check if over dropdown content
            else if (moreDropdown && isWithinElement(elementAtPoint, moreDropdown)) {
              dropTarget = 'more-dropdown-content';
            }
          } else if (containerId === 'more-dropdown-content') {
            // Check if dropping back to sidebar - detect sidebar element or tabs-cont
            const sidebar = document.getElementById('sidebar');
            if (tabsContDrop && isWithinElement(elementAtPoint, tabsContDrop)) {
              dropTarget = 'tabs-cont';
            } else if (sidebar && isWithinElement(elementAtPoint, sidebar) && !isWithinElement(elementAtPoint, moreBtnDrop) && !isWithinElement(elementAtPoint, moreDropdownMenu)) {
              // Dropped on sidebar but not on More button/dropdown - move to tabs-cont
              dropTarget = 'tabs-cont';
            } else if (moreBtnDrop && isWithinElement(elementAtPoint, moreBtnDrop)) {
              // Dropping on More button stays in More (already there)
              dropTarget = 'more-dropdown-content';
            }
          }
          
          
          // Handle dropping on different container (move between sidebar and More)
          if (dropTarget !== containerId) {
            if (!onReorder) {
              console.error('[Drag] ERROR: onReorder callback is not defined!');
            } else {
              isReordering = true;
              try {
                await onReorder({ 
                  draggedId, 
                  targetId: null, 
                  position: 'after',
                  dropTarget: dropTarget
                });
              } catch (err) {
                console.error('[Drag] Move between containers failed:', err);
                console.error('[Drag] Error stack:', err.stack);
              } finally {
                setTimeout(() => {
                  isReordering = false;
                }, 100);
              }
            }
          } else {
            // Try data-sortable-id first, then fallback to data-tab-id
            let overElement = elementAtPoint?.closest('[data-sortable-id]');
            if (!overElement) {
              overElement = elementAtPoint?.closest('[data-tab-id]');
            }
            if (overElement && overElement !== draggedElement && onReorder) {
              const targetId = overElement.dataset.sortableId || overElement.dataset.tabId;
              
              // Prevenir múltiples llamadas
              isReordering = true;
              
              // OPTIMISTIC UI: Actualizar inmediatamente antes de la llamada al backend
              try {
                await onReorder({ 
                  draggedId, 
                  targetId, 
                  position: finalDropIndicator?.position || 'after',
                  dropTarget: dropTarget
                });
              } catch (err) {
                console.error('Reorder failed:', err);
              } finally {
                // Resetear flag después de un delay para permitir re-drag
                setTimeout(() => {
                  isReordering = false;
                }, 100);
              }
            }
          }
        }
        
        // Resetear estado completamente
        draggedElement = null;
        draggedId = null;
        isDragging = false;
        dragStartX = null;
        dragStartY = null;
      };
      
      // NO usar mouseleave del contenedor - permite arrastrar fuera del contenedor
      
      // Limpiar también si se pierde el foco de la ventana
      // Limpiar solo si la ventana pierde el foco (no cuando sale del contenedor)
      const handleBlur = () => {
        if (isDragging) {
          window.removeEventListener('mousemove', handleMouseMoveDrag);
          window.removeEventListener('mouseup', handleMouseUp);
          
          container.classList.remove('dragging-active');
          
          if (draggedElement) {
            draggedElement.style.opacity = '';
            draggedElement.style.cursor = '';
            draggedElement.classList.remove('dragging-item');
          }
          this.clearDropIndicators(containerId, isHorizontal);
          dropIndicator = null;
          isDragging = false;
          draggedElement = null;
          draggedId = null;
        }
      };
      
      window.addEventListener('blur', handleBlur);

      window.addEventListener('mousemove', handleMouseMoveDrag);
      window.addEventListener('mouseup', handleMouseUp);
    });
  }

  handleDragStart(element) {
    element.style.cursor = 'grabbing';
  }

  handleDragMove(e, container, items, allowHierarchy, setDropIndicator, isHorizontal = false) {
    // Try data-sortable-id first, then fallback to data-tab-id
    let overElement = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sortable-id]');
    if (!overElement) {
      overElement = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-tab-id]');
    }
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
    
    // Si es horizontal (TopBar), usar coordenadas X, si no (sidebar), usar Y
    // Usar e.clientY directamente para evitar problemas con this.mouseY no actualizado
    const relativePos = isHorizontal ? (e.clientX - overRect.left) : (e.clientY - overRect.top);
    const size = isHorizontal ? overRect.width : overRect.height;
    const percentage = (relativePos / size) * 100;

    let position;

    if (allowHierarchy) {
      if (targetItem?.parent_id) {
        // Para elementos con parent, usar 50% como punto de corte
        if (percentage <= 50) {
          position = 'before';
        } else {
          position = 'after';
        }
      } else {
        // Para elementos sin parent, usar zonas más amplias para evitar 'inside'
        if (percentage < 40) {
          position = 'before';
        } else {
          position = 'after';
        }
      }
    } else {
      // Para drag simple (tabs), siempre usar 'before' o 'after', nunca 'inside'
      // Usar un umbral claro con un pequeño margen para evitar parpadeo en el punto medio exacto
      // <= 50% = 'before', > 50% = 'after'
      // Esto asegura que siempre haya una posición definida
      if (percentage < 50.5) {
        position = 'before';
      } else {
        position = 'after';
      }
    }

    // SIEMPRE establecer un indicador - nunca null para evitar que desaparezca la línea
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

  updateDropIndicators(containerId, indicator, isHorizontal = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Remove all existing indicators FIRST - asegurar que solo hay uno
    container.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    container.querySelectorAll('[data-sortable-id]').forEach(el => {
      el.classList.remove('drop-inside');
      el.style.backgroundColor = '';
      el.style.position = ''; // Reset position
    });

    if (!indicator) return;

    const targetElement = container.querySelector(`[data-sortable-id="${indicator.targetId}"]`);
    if (!targetElement) return;
    
    // Asegurar que solo mostramos UN indicador
    // Si es 'before', mostrar antes del elemento
    // Si es 'after', mostrar después del elemento
    // NO mostrar ambos

    const indicatorLine = document.createElement('div');
    indicatorLine.className = 'drop-indicator';
    
    // Asegurar que el contenedor tenga position: relative para que el indicador se posicione correctamente
    const containerStyle = window.getComputedStyle(container);
    if (containerStyle.position === 'static') {
      container.style.position = 'relative';
    }
    
    // Calcular posición - SIEMPRE mostrar la línea en el borde entre elementos
    // Para 'before': línea a la izquierda/arriba del elemento target
    // Para 'after': línea a la derecha/abajo del elemento target
    // Pero si 'after' y el siguiente elemento tiene la misma posición, NO duplicar
    const targetRect = targetElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    container.appendChild(indicatorLine);
    
    // Usar la misma posición para 'before' y 'after' cuando son contiguos
    // 'before' del elemento B = 'after' del elemento A (si A está antes de B)
    // Mostrar siempre en el borde izquierda/arriba del elemento target
    if (indicator.position === 'before') {
      if (isHorizontal) {
        indicatorLine.style.cssText = `
          position: absolute;
          top: 0;
          bottom: 0;
          left: ${targetRect.left - containerRect.left}px;
          width: 2px;
          background-color: #4285f4;
          z-index: 1000;
          pointer-events: none;
        `;
      } else {
        indicatorLine.style.cssText = `
          position: absolute;
          left: 0;
          right: 0;
          top: ${targetRect.top - containerRect.top}px;
          height: 2px;
          background-color: #4285f4;
          z-index: 1000;
          pointer-events: none;
        `;
      }
    } else if (indicator.position === 'after') {
      // Para 'after', mostrar después del elemento (pero usar el siguiente elemento si existe)
      // Si no hay siguiente, mostrar al final
      const nextSibling = targetElement.nextElementSibling;
      if (nextSibling && nextSibling.hasAttribute('data-sortable-id')) {
        // Hay un siguiente elemento: mostrar antes de él (misma posición que 'before' del siguiente)
        const nextRect = nextSibling.getBoundingClientRect();
        if (isHorizontal) {
          indicatorLine.style.cssText = `
            position: absolute;
            top: 0;
            bottom: 0;
            left: ${nextRect.left - containerRect.left}px;
            width: 2px;
            background-color: #4285f4;
            z-index: 1000;
            pointer-events: none;
          `;
        } else {
          indicatorLine.style.cssText = `
            position: absolute;
            left: 0;
            right: 0;
            top: ${nextRect.top - containerRect.top}px;
            height: 2px;
            background-color: #4285f4;
            z-index: 1000;
            pointer-events: none;
          `;
        }
      } else {
        // No hay siguiente elemento: mostrar al final
        if (isHorizontal) {
          indicatorLine.style.cssText = `
            position: absolute;
            top: 0;
            bottom: 0;
            left: ${targetRect.right - containerRect.left}px;
            width: 2px;
            background-color: #4285f4;
            z-index: 1000;
            pointer-events: none;
          `;
        } else {
          indicatorLine.style.cssText = `
            position: absolute;
            left: 0;
            right: 0;
            top: ${targetRect.bottom - containerRect.top}px;
            height: 2px;
            background-color: #4285f4;
            z-index: 1000;
            pointer-events: none;
          `;
        }
      }
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
      await this.request(`/api/chat/${chatId}/messages`, {
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
        console.error('Error creating LunaIntegration:', err);
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

