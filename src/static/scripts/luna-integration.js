// Luna Integration - Integrate backend tabs with TabManager
const API_URL = '';

class LunaIntegration {
  constructor() {
    this.token = localStorage.getItem('dogeub_token');
    this.user = JSON.parse(localStorage.getItem('dogeub_user') || 'null');
    
    this.activeSpace = null;
    this.projects = [];
    this.allProjects = []; // Store all projects including archived ones
    this.users = [];
    this.personalTabs = []; // Tabs sin space_id (personales)
    this.spaceTabs = []; // Tabs del space activo
    this.savedPersonalTabs = null; // Tabs personales guardados cuando se abre un espacio
    this.showingModal = false; // Flag to prevent TabManager.add from running
    this.menuCloseListener = null; // Track menu close listener
    this.currentChatId = null; // Current active chat ID for message sending
    this.chatNotificationChannel = null; // Supabase Realtime channel for chat notifications
    this.projectUpdatesChannel = null; // Supabase Realtime channel for project updates
    this.supabaseClient = null; // Supabase client for realtime
    this.chatSubscriptions = new Map(); // Map of chatId -> subscription channel
    this.lastNotificationTime = new Map(); // Track last notification time per space to prevent duplicates
    this.showArchivedForParent = new Map(); // Map of parentId -> boolean (track expanded state per parent, null/undefined = root level)
    
    this.init().catch(err => {
      console.error('❌ Error initializing LunaIntegration:', err);
    });
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
        headers,
        credentials: 'include'  // Crítico para Wavebox - envía cookies en cada request
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

  async updateUnreadBadge() {
    try {
      // Use the users-only endpoint to count only DM messages, not project messages
      const response = await this.request('/api/chat/unread-count/users-only');
      const unreadCount = response.unreadCount || 0;
      
      // Update mobile badge (for "Users" tab in bottom bar)
      const badge = document.getElementById('mobile-messenger-badge');
      if (badge) {
        if (unreadCount > 0) {
          badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch (error) {
      console.error('Failed to update total unread badge:', error);
    }
  }

  async updateSpaceBadge(spaceId) {
    try {
      const response = await this.request(`/api/chat/space/${spaceId}/unread-count`);
      const unreadCount = response.unreadCount || 0;
      
      // Find ALL badges using data-space-id (both desktop and mobile)
      const badges = document.querySelectorAll(`.space-unread-badge[data-space-id="${spaceId}"]`);
      
      badges.forEach((badge) => {
        if (unreadCount > 0) {
          badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
          // Force display and visibility - use important styles to prevent hiding
          badge.style.setProperty('display', 'flex', 'important');
          badge.style.setProperty('visibility', 'visible', 'important');
          badge.style.setProperty('opacity', '1', 'important');
          badge.style.setProperty('top', '50%', 'important');
          badge.style.setProperty('transform', 'translateY(-50%)', 'important');
          badge.style.setProperty('right', '8px', 'important');
          
          // Adjust menu button position when badge is visible
          const projectItem = badge.closest('.project-item');
          if (projectItem) {
            const menuBtn = projectItem.querySelector('.project-menu-btn');
            if (menuBtn) {
              menuBtn.style.position = 'absolute';
              menuBtn.style.right = '30px';
              menuBtn.style.top = '50%';
              menuBtn.style.transform = 'translateY(-50%)';
            }
          }
        } else {
          badge.textContent = '';
          badge.style.setProperty('display', 'none', 'important');
          badge.style.setProperty('visibility', 'hidden', 'important');
          
          // Reset menu button position when badge is hidden
          const projectItem = badge.closest('.project-item');
          if (projectItem) {
            const menuBtn = projectItem.querySelector('.project-menu-btn');
            if (menuBtn) {
              menuBtn.style.position = 'absolute';
              menuBtn.style.right = '8px';
              menuBtn.style.top = '50%';
              menuBtn.style.transform = 'translateY(-50%)';
            }
          }
        }
      });
    } catch (error) {
      console.error(`[BADGE] Error updating badge for space ${spaceId}:`, error);
      // On error, hide ALL badges
      const badges = document.querySelectorAll(`.space-unread-badge[data-space-id="${spaceId}"]`);
      badges.forEach(badge => {
        badge.textContent = '';
        badge.style.setProperty('display', 'none', 'important');
        badge.style.setProperty('visibility', 'hidden', 'important');
      });
    }
  }

  async updateSpaceUnreadBadges() {
    // Prevent multiple simultaneous calls
    if (this._updatingBadges) {
      return; // Already updating, skip
    }
    this._updatingBadges = true;
    
    try {
      // First, hide all badges to ensure clean state (before making request)
      const allBadges = document.querySelectorAll('.space-unread-badge');
      allBadges.forEach(badge => {
        badge.style.display = 'none';
        badge.textContent = '';
        
        // Reset menu button position
        const projectItem = badge.closest('.project-item');
        if (projectItem) {
          const menuBtn = projectItem.querySelector('.project-menu-btn');
          if (menuBtn) {
            menuBtn.style.right = '8px';
          }
        }
      });
      
      // Use single endpoint instead of multiple parallel requests
      const { unreadCounts } = await this.request('/api/chat/unread-counts/all');
      
      console.log(`[BADGES] Received unread counts for ${Object.keys(unreadCounts || {}).length} spaces:`, unreadCounts);
      
      // Update all badges at once (only spaces with count > 0 will be in unreadCounts)
      Object.entries(unreadCounts || {}).forEach(([spaceId, count]) => {
        const badges = document.querySelectorAll(`.space-unread-badge[data-space-id="${spaceId}"]`);
        badges.forEach(badge => {
          if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = 'flex';
            badge.style.alignItems = 'center';
            badge.style.justifyContent = 'center';
            badge.style.top = '50%';
            badge.style.transform = 'translateY(-50%)';
            badge.style.right = '8px';
            
            // Adjust menu button position when badge is visible
            const projectItem = badge.closest('.project-item');
            if (projectItem) {
              const menuBtn = projectItem.querySelector('.project-menu-btn');
              if (menuBtn) {
                menuBtn.style.right = '30px'; // Move left when badge is visible
              }
            }
          } else {
            badge.style.display = 'none';
            
            // Reset menu button position when badge is hidden
            const projectItem = badge.closest('.project-item');
            if (projectItem) {
              const menuBtn = projectItem.querySelector('.project-menu-btn');
              if (menuBtn) {
                menuBtn.style.right = '8px'; // Back to original position
              }
            }
          }
        });
      });
      
      // Also update spaces that don't have unread counts (hide their badges)
      const allSpaceIds = [
        ...(this.projects || []).map(p => p.id),
        ...(this.users || []).map(u => u.id)
      ];
      
      allSpaceIds.forEach(spaceId => {
        if (!unreadCounts || !unreadCounts[spaceId]) {
          const badges = document.querySelectorAll(`.space-unread-badge[data-space-id="${spaceId}"]`);
          badges.forEach(badge => {
            badge.textContent = '';
            badge.style.display = 'none';
            
            // Reset menu button position when badge is hidden
            const projectItem = badge.closest('.project-item');
            if (projectItem) {
              const menuBtn = projectItem.querySelector('.project-menu-btn');
              if (menuBtn) {
                menuBtn.style.right = '8px'; // Back to original position
              }
            }
          });
        }
      });
    } catch (error) {
      console.error('Failed to update space unread badges:', error);
    } finally {
      this._updatingBadges = false;
    }
  }

  async initNotifications() {
    // Initialize PWA notifications service worker
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      console.log('Notifications not supported in this browser');
      return;
    }

    try {
      // Register notification service worker
      const registration = await navigator.serviceWorker.register('/notifications-sw.js', {
        scope: '/'
      });
      
      console.log('Notification service worker registered');
      
      // Listen for messages from service worker (e.g., when notification is clicked)
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'OPEN_CHAT') {
          const spaceId = event.data.spaceId;
          if (spaceId) {
            // Open the chat in the app
            this.openChatFromNotification(spaceId);
          }
        }
      });
      
      // Request notification permission if not already granted/denied
      if (Notification.permission === 'default') {
        // Ask for permission
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          console.log('Notification permission granted');
          // Subscribe to push notifications
          await this.subscribeToPushNotifications(registration);
          // Setup chat notifications after permission is granted
          await this.setupChatNotifications();
        } else {
          console.log('Notification permission denied');
        }
      } else if (Notification.permission === 'granted') {
        // Already granted, subscribe to push and setup notifications
        await this.subscribeToPushNotifications(registration);
        await this.setupChatNotifications();
      }
    } catch (error) {
      console.error('Failed to register notification service worker:', error);
    }
  }

  async subscribeToPushNotifications(registration) {
    try {
      // Check if already subscribed
      let subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        console.log('Already subscribed to push notifications');
        return subscription;
      }

      // Get VAPID public key from backend
      const { publicKey } = await this.request('/api/notifications/vapid-public-key');
      
      // Convert VAPID public key to Uint8Array
      const convertedVapidKey = this.urlBase64ToUint8Array(publicKey);
      
      // Subscribe to push notifications
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, // Required for Chrome
        applicationServerKey: convertedVapidKey
      });
      
      console.log('Subscribed to push notifications');
      
      // Send subscription to backend
      await this.request('/api/notifications/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription)
      });
      
      console.log('Push subscription saved to server');
      return subscription;
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
    }
  }

  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async openChatFromNotification(spaceId) {
    // Find the user/space
    const space = this.users.find(u => u.id === spaceId);
    if (!space) {
      console.error('Space not found:', spaceId);
      return;
    }

    // Open the space (this will load the chat)
    await this.openSpace(space);
    
    // Create/activate chat tab
    const chatUrl = `luna://chat/${spaceId}`;
    
    // Check if tab already exists
    let existingTab = null;
    if (window.tabManager && window.tabManager.tabs) {
      existingTab = window.tabManager.tabs.find(t => t.url === chatUrl);
    }
    
    if (existingTab) {
      // Activate existing tab
      window.tabManager.activate(existingTab.id);
    } else {
      // Create new chat tab
      const displayName = space.display_name || space.name || 'Chat';
      window.tabManager.add({
        url: chatUrl,
        title: displayName,
        closable: true
      });
    }
  }

  async showMessageNotification(message, spaceId) {
    // Check if notifications are supported and permitted
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    // Prevent duplicate notifications - check if we recently showed one for this message
    const notificationKey = `${spaceId}-${message.id || Date.now()}`;
    const now = Date.now();
    const lastTime = this.lastNotificationTime.get(notificationKey);
    
    if (lastTime && (now - lastTime) < 2000) {
      // Less than 2 seconds since last notification for this message, skip
      return;
    }
    
    // Store this notification time
    this.lastNotificationTime.set(notificationKey, now);
    
    // Clean up old entries (keep only last 50)
    if (this.lastNotificationTime.size > 50) {
      const keys = Array.from(this.lastNotificationTime.keys());
      const oldKeys = keys.slice(0, keys.length - 50);
      oldKeys.forEach(key => this.lastNotificationTime.delete(key));
    }

    // Check if user is currently viewing this chat
    const activeTab = window.tabManager?.active();
    const chatUrl = `luna://chat/${spaceId}`;
    const isViewingChat = activeTab && activeTab.url === chatUrl;

    // Check if app is in foreground
    const isAppInForeground = document.visibilityState === 'visible';

    // Only show notification if user is NOT viewing this chat OR app is in background
    if (isViewingChat && isAppInForeground) {
      return; // User is actively viewing this chat, don't show notification
    }

    // Get sender information - the space is the DM with the sender
    let senderName = 'Someone';
    if (message.user_id) {
      // Try to get sender from the space (which represents the DM user)
      const space = this.users.find(u => u.id === spaceId);
      if (space) {
        senderName = space.display_name || space.name || 'Someone';
        // Remove email from name if it's just an email
        if (senderName.includes('@')) {
          // Try to get just the name part before @
          const namePart = senderName.split('@')[0];
          if (namePart) {
            senderName = namePart;
          }
        }
      } else {
        // Fallback: fetch user info from backend
        try {
          const userResponse = await this.request(`/api/users/${message.user_id}`);
          senderName = userResponse.name || userResponse.email?.split('@')[0] || 'Someone';
        } catch {
          senderName = 'Someone';
        }
      }
    } else {
      // System message
      senderName = 'System';
    }

    const messageText = message.message || 'New message';
    const notificationTitle = senderName;
    const notificationBody = messageText.length > 100 
      ? messageText.substring(0, 100) + '...' 
      : messageText;

    try {
      // Try to use service worker notification
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(notificationTitle, {
          body: notificationBody,
          icon: '/icon.svg',
          badge: '/icon.svg',
          tag: `chat-${spaceId}-${message.id || Date.now()}`,
          renotify: false, // Don't renotify if same tag
          data: {
            url: `${window.location.origin}/indev`,
            spaceId: spaceId,
            chatId: message.chat_id,
            type: 'chat_message'
          },
          requireInteraction: false,
          vibrate: [200, 100, 200] // Vibration pattern for mobile
        });
      }
    } catch {
      // Fallback to regular Notification API
      try {
        new Notification(notificationTitle, {
          body: notificationBody,
          icon: '/icon.svg',
          tag: `chat-${spaceId}-${message.id || Date.now()}`
        });
      } catch (fallbackError) {
        console.error('Failed to show notification:', fallbackError);
      }
    }
  }

  async setupChatNotifications() {
    if (!this.user || !this.user.id) {
      return;
    }

    try {
      // Get Supabase config
      const config = await this.request('/api/users/supabase-config');
      
      if (!config.url || !config.anonKey) {
        return;
      }

      // Dynamically import Supabase client from CDN
      // @ts-ignore - dynamic import from CDN
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      
      // Create Supabase client with public credentials
      const supabase = createClient(config.url, config.anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          cookieOptions: {
            sameSite: 'none',
            secure: true
          }
        }
      });
      
      // Store client for later use
      this.supabaseClient = supabase;

      // Get current user's chats from backend API
      const chatsResponse = await this.request('/api/chat/my-chats');

      if (!chatsResponse.chatIds || chatsResponse.chatIds.length === 0) {
        return;
      }

      const chatIds = chatsResponse.chatIds;

      // Subscribe to new messages in user's chats
      const channelName = `chat-notifications-${this.user.id}`;
      
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            // Include system messages (user_id is null) and messages from other users
            // We'll filter by chat_id in the handler
          },
          async (payload) => {
            const message = payload.new;
            
            // Check if message is in one of user's chats
            if (!chatIds.includes(message.chat_id)) {
              return;
            }

            // Skip if this is a message from the current user (not system message)
            if (message.user_id && message.user_id === this.user.id) {
              return;
            }

            // Get the space_id for this chat_id from backend
            try {
              const spaceResponse = await this.request(`/api/chat/${message.chat_id}/space`);
              const spaceId = spaceResponse.spaceId;
              
              if (spaceId) {
                // Update the total unread badge
                this.updateUnreadBadge();
                
                // Update only the badge for this specific space
                this.updateSpaceBadge(spaceId);
                
                // ❌ DESACTIVADO: Notificaciones locales del frontend (solo funcionan si app está abierta)
                // Las notificaciones ahora se envían desde el BACKEND (funcionan incluso si app está cerrada)
                // await this.showMessageNotification(message, spaceId);
              } else {
                // Fallback: update all badges
                this.updateUnreadBadge();
                this.users.forEach(user => {
                  this.updateSpaceBadge(user.id);
                });
              }
            } catch {
              // Fallback: update all badges
              this.updateUnreadBadge();
              this.users.forEach(user => {
                this.updateSpaceBadge(user.id);
              });
            }
          }
        )
        .subscribe();

      // Store channel for cleanup
      this.chatNotificationChannel = channel;
      
      // Initial badge update (only once on setup)
      await this.updateUnreadBadge();
      await this.updateSpaceUnreadBadges();
      
      // Setup project updates listener (after Supabase client is initialized)
      this.setupProjectUpdatesListener();
    } catch (error) {
      console.error('Failed to setup chat notifications:', error);
    }
  }

  async setupProjectUpdatesListener() {
    if (!this.user || !this.user.id || !this.supabaseClient) {
      return;
    }

    try {
      // Subscribe to UPDATE events on spaces table (filter by user_id, then check category in handler)
      const channelName = `project-updates-${this.user.id}`;
      
      const channel = this.supabaseClient
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'spaces',
            filter: `user_id=eq.${this.user.id}`
          },
          async (payload) => {
            // Only process if it's a project (category = 'project')
            if (payload.new?.category === 'project') {
              // When a project is updated, reload projects
              await this.loadProjects();
              this.renderProjects();
            }
          }
        )
        .subscribe();

      // Store channel for cleanup
      this.projectUpdatesChannel = channel;
    } catch (error) {
      console.error('Failed to setup project updates listener:', error);
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
    const projectBtn = document.getElementById('project-btn');
    if (projectBtn) {
      projectBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.createProject();
      });
    } else {
      console.error('project-btn not found');
    }
    
    const dmBtn = document.getElementById('dm-btn');
    if (dmBtn) {
      dmBtn.addEventListener('click', () => this.showUserPicker());
    }
    
    
    // tab-btn handler will be set up in setupTabManagerMonitoring after TabManager initializes
    
    document.getElementById('close-space-btn')?.addEventListener('click', () => this.clearActiveSpace());
    
    // Project settings button and sidebar
    document.getElementById('topbar-settings-btn')?.addEventListener('click', () => this.openProjectSettings());
    document.getElementById('project-settings-close')?.addEventListener('click', () => this.closeProjectSettings());

    // More dropdown removed - no longer needed

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

    // Setup global chat notifications (listens to ALL user chats)
    // This also sets up project updates listener
    await this.setupChatNotifications();
    
    // Badges are updated in initNotifications() - no need to update again here
    // This prevents duplicate calls and flashing badges

    // Load preferences from backend first (this will cache them)
    await this.loadPreferences();

    // More dropdown removed - no longer needed

    // Monitor TabManager for changes
    this.setupTabManagerMonitoring();
    
    // Intercept clicks on personal tabs to close active space
    this.setupPersonalTabsClickHandler();
    
    // Initialize PWA notifications
    this.initNotifications();
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

    // Intercept activate to update TopBar and check if tab is personal
    const originalActivate = window.tabManager.activate?.bind(window.tabManager);
    if (originalActivate) {
      window.tabManager.activate = (...args) => {
        const result = originalActivate.apply(window.tabManager, args);
        
        // Check if the activated tab is a personal tab (doesn't belong to active space)
        setTimeout(() => {
          const activeTab = window.tabManager.active();
          if (activeTab && this.activeSpace) {
            // Check if this tab belongs to the active space
            const activeTabUrl = activeTab.originalUrl || activeTab.url || '';
            // Check by backendId first (more reliable), then by URL
            let isSpaceTab = false;
            if (activeTab.backendId) {
              isSpaceTab = this.spaceTabs.some(spaceTab => spaceTab.id === activeTab.backendId);
            }
            if (!isSpaceTab) {
              isSpaceTab = this.spaceTabs.some(spaceTab => {
                const spaceTabUrl = spaceTab.url || spaceTab.bookmark_url;
                if (!spaceTabUrl || !activeTabUrl) return false;
                
                // Normalize URLs for comparison (handles Notion URLs with/without Worker)
                return this.normalizeUrl(spaceTabUrl) === this.normalizeUrl(activeTabUrl);
              });
            }
            
            // If tab doesn't belong to active space, clear active space (hide top bar)
            if (!isSpaceTab && !this.isChatUrl(activeTab.url)) {
              this.clearActiveSpace();
            } else {
              // Tab belongs to space, update top bar
              this.renderTopBar();
            }
          } else if (this.activeSpace) {
            // Active space exists but no active tab, update top bar
            this.renderTopBar();
          }
          
          // Check if activated tab is a chat tab - if so, mark messages as read
          if (activeTab && this.isChatUrl(activeTab.url)) {
            const spaceId = activeTab.url.split('/').pop();
            if (spaceId) {
              // markChatAsReadIfVisible will update badges after marking as read
              this.markChatAsReadIfVisible(spaceId);
            }
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
      
      // Setup drag and drop for tabs after render
      setTimeout(() => {
        this.setupDragAndDrop('tabs-cont', this.personalTabs, false, async ({ draggedId, targetId, position }) => {
          try {
            // Desktop More dropdown removed - no longer needed
            
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
        
        // More dropdown removed - no longer needed
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
        // IMPORTANTE: Asignar bookmark_url para que funcione el botón Home
        tab.bookmark_url = backendTab.bookmark_url || null;
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
          bookmark_url: backendTab.bookmark_url || null, // IMPORTANTE: Asignar bookmark_url
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
    
    // Renderizar (single consolidated render)
    if (window.tabManager.render) window.tabManager.render();
    if (window.tabManager.createIframes) window.tabManager.createIframes();
    if (window.tabManager.showActive) window.tabManager.showActive();
    
    // Desktop More dropdown removed - no longer needed
    
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

  // Save project expansion state to localStorage
  saveProjectExpansionState() {
    try {
      const expansionState = {};
      this.projects.forEach(project => {
        if (project.id) {
          expansionState[project.id] = project.is_expanded === true;
        }
      });
      localStorage.setItem('project_expansion_state', JSON.stringify(expansionState));
    } catch (err) {
      console.error('Failed to save project expansion state:', err);
    }
  }

  // Load project expansion state from localStorage
  loadProjectExpansionState() {
    try {
      const saved = localStorage.getItem('project_expansion_state');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (err) {
      console.error('Failed to load project expansion state:', err);
    }
    return {};
  }

  async loadProjects() {
    if (!this.token) return;
    
    try {
      // Load ALL projects (active + archived) in a single request
      const { spaces } = await this.request('/api/spaces?category=project');
      
      console.log('[FRONTEND] Received projects from backend:', spaces?.length || 0);
      if (spaces && spaces.length > 0) {
        spaces.forEach(s => {
          console.log(`[FRONTEND] Project: ${s.name} (id: ${s.id}, parent_id: ${s.parent_id || 'none'}, isGhost: ${s.isGhost || false})`);
        });
      }
      
      // Store all projects
      this.allProjects = spaces || [];
      
      // Show ALL projects (active + archived)
      this.projects = spaces || [];
      
      console.log('[FRONTEND] Before parsing: projects count =', this.projects.length);
      
      // Parse tags and parent_id from JSONB if needed
      this.projects.forEach((project, index) => {
        try {
          // Parse tags
          if (project.tags) {
            // If tags is a string, parse it
            if (typeof project.tags === 'string') {
              try {
                project.tags = JSON.parse(project.tags);
              } catch (e) {
                console.warn(`[FRONTEND] Failed to parse tags for project "${project.name}":`, project.tags, e);
                project.tags = [];
              }
            }
            // Ensure it's an array
            if (!Array.isArray(project.tags)) {
              console.warn(`[FRONTEND] Tags is not an array for project "${project.name}":`, project.tags);
              project.tags = [];
            }
          } else {
            project.tags = [];
          }
          
          // Parse parent_id (now an array JSONB)
          if (project.parent_id) {
            // If parent_id is a string, try to parse it
            if (typeof project.parent_id === 'string') {
              try {
                project.parent_id = JSON.parse(project.parent_id);
              } catch (e) {
                // If parsing fails, it might be a single UUID string (old format)
                // Convert single UUID string to array
                console.log(`[FRONTEND] parent_id is string (old format) for "${project.name}":`, project.parent_id);
                project.parent_id = [project.parent_id];
              }
            }
            // Ensure it's an array (if it's a single value, convert to array)
            if (!Array.isArray(project.parent_id) && project.parent_id !== null) {
              project.parent_id = [project.parent_id];
            }
          } else {
            project.parent_id = [];
          }
        } catch (error) {
          console.error(`[FRONTEND] Error parsing project at index ${index} (${project.name}):`, error);
          // Ensure project has valid defaults
          project.tags = project.tags || [];
          project.parent_id = project.parent_id || [];
        }
      });
      
      console.log('[FRONTEND] After parsing: projects count =', this.projects.length);
      
      // Also parse tags and parent_id for allProjects
      this.allProjects.forEach(project => {
        // Parse tags
        if (project.tags) {
          if (typeof project.tags === 'string') {
            try {
              project.tags = JSON.parse(project.tags);
            } catch (e) {
              project.tags = [];
            }
          }
          if (!Array.isArray(project.tags)) {
            project.tags = [];
          }
        } else {
          project.tags = [];
        }
        
        // Parse parent_id (now an array JSONB)
        if (project.parent_id) {
          if (typeof project.parent_id === 'string') {
            try {
              project.parent_id = JSON.parse(project.parent_id);
            } catch (e) {
              // Old format - single UUID string, convert to array
            }
          }
          if (!Array.isArray(project.parent_id) && project.parent_id !== null) {
            project.parent_id = [project.parent_id];
          }
        } else {
          project.parent_id = [];
        }
      });
      
      // Load saved expansion state from localStorage
      const savedExpansionState = this.loadProjectExpansionState();
      
      // Apply saved expansion state (override backend values with user preferences)
      this.projects.forEach(project => {
        if (project.id && project.id in savedExpansionState) {
          project.is_expanded = savedExpansionState[project.id];
        }
      });
      
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
        } catch {
          // Continuar con el siguiente proyecto si hay error
          continue;
        }
      }
      
      // Marcar como ejecutado
      localStorage.setItem('dashboard_tabs_created', 'true');
    } catch {
      // Ignore errors
    }
  }

  // Mobile UI functions
  initMobileViews() {
    try {
      if (!window.mobileUI || typeof window.mobileUI.isMobile !== 'function' || !window.mobileUI.isMobile()) return;
      
      // Render mobile bottom bar tabs
      this.renderMobileBottomBar();
    } catch {
      // Silently fail if mobile UI is not available
    }
  }

  // Centralized function to setup fixed button listeners (Projects, Users, More - mobile only)
  // This should be called whenever these buttons might have lost their listeners
  // setupFixedButtonListeners() ELIMINADO - ahora se maneja en renderMobileBottomBar()

  renderMobileBottomBar(isEditingParam = null) {
    try {
      if (!window.tabManager || !window.mobileUI || typeof window.mobileUI.isMobile !== 'function' || !window.mobileUI.isMobile()) return;

    const container = document.getElementById('mobile-tabs-container');
      const bottomBar = document.getElementById('mobile-bottom-bar');
      if (!container || !bottomBar) return;

      const isEditing = isEditingParam !== null ? isEditingParam : (bottomBar.classList.contains('editing') || false);
      
      // Obtener orden guardado ANTES de limpiar
      const savedOrder = this.getMobileBottomBarOrderSync() || [];
      
      // Obtener tabs disponibles ANTES de limpiar
    const tabs = window.tabManager.tabs || [];
    const personalTabs = tabs.filter(t => {
      const url = t.url || '';
      return url && url !== '/new' && url !== 'tabs://new' && !t.spaceId && !this.isChatUrl(url);
    });

      // Obtener tabs que están en More
      const moreTabIds = this.getMobileMoreTabIdsSync();
      const bottomBarTabs = personalTabs.filter(t => {
        const tId = String(t.backendId || t.id);
        return !moreTabIds.has(tId);
      });

      // Crear mapa de tabs por ID para búsqueda rápida
      const tabsMap = new Map();
      bottomBarTabs.forEach(tab => {
        const tabId = String(tab.backendId || tab.id);
        tabsMap.set(tabId, tab);
      });

      // Obtener fixed buttons del HTML (ya existen)
      const projectsBtn = document.getElementById('mobile-nav-projects');
      const usersBtn = document.getElementById('mobile-nav-messenger');
      const moreBtn = document.getElementById('mobile-nav-more');

      // Siempre re-renderizar completamente para asegurar que los tres puntos se muestren/oculten correctamente
      // Limpiar contenedor de tabs completamente
    container.innerHTML = '';

      // Remover tres puntos de tabs existentes antes de re-renderizar
      const existingTabsWithDots = bottomBar.querySelectorAll('.mobile-tab-menu-btn');
      existingTabsWithDots.forEach(btn => btn.remove());

      // Si no hay orden guardado, crear orden por defecto
      let orderToRender = savedOrder.length > 0 ? savedOrder : [];
      if (orderToRender.length === 0) {
        // Orden por defecto: tabs visibles (máx 3) + Projects + Users + More
        const visibleTabs = bottomBarTabs.slice(0, 3);
    visibleTabs.forEach(tab => {
          const tabId = String(tab.backendId || tab.id);
          orderToRender.push({ type: 'tab', id: tabId });
        });
        orderToRender.push({ type: 'fixed', id: 'projects' });
        orderToRender.push({ type: 'fixed', id: 'users' });
        orderToRender.push({ type: 'fixed', id: 'more' });
      }

      // Limpiar listeners previos de fixed buttons (sin clonar)
      // Los listeners se agregarán de nuevo más abajo si es necesario
      if (projectsBtn) {
        projectsBtn.dataset.listenerAdded = 'false';
      }
      if (usersBtn) {
        usersBtn.dataset.listenerAdded = 'false';
      }
      if (moreBtn) {
        moreBtn.dataset.listenerAdded = 'false';
      }

      // Limpiar listeners previos de todos los elementos antes de renderizar
      // Esto previene duplicaciones cuando se llama renderMobileBottomBar múltiples veces
      const allExistingItems = bottomBar.querySelectorAll('.bottom-nav-item');
      allExistingItems.forEach(item => {
        item.dataset.listenerAdded = 'false';
        item.dataset.dragListener = 'false';
      });

      // Renderizar elementos en el orden especificado
      orderToRender.forEach((orderItem, index) => {
        if (orderItem.type === 'tab') {
          const tab = tabsMap.get(String(orderItem.id));
          if (!tab) return; // Tab no encontrado, saltar

          // Crear elemento de tab desde cero (sin clonar)
      const tabItem = document.createElement('div');
      tabItem.className = 'bottom-nav-item';
          tabItem.style.position = 'relative';
          tabItem.dataset.tabId = tab.id;
          tabItem.dataset.index = index;
      if (tab.active) tabItem.classList.add('active');
      
          // Limpiar cualquier listener previo o flag de drag
          tabItem.dataset.dragListener = 'false';
          tabItem.onclick = null;
          // Remover todos los event listeners previos clonando el elemento (sin listeners)
          // Pero mejor: simplemente no agregar listeners de drag si no está editando
      
          // Usar template del sidebar
          const tabHtml = window.tabManager.tabTemplate(tab, !isEditing, false);
      const tabWrapper = document.createElement('div');
      tabWrapper.innerHTML = tabHtml;
      const originalTabEl = tabWrapper.firstElementChild;
      
      if (originalTabEl) {
            // Extraer el círculo del icono
            const iconCircle = originalTabEl.querySelector('.rounded-full');
        
        // Crear estructura bottom bar
        const iconDiv = document.createElement('div');
        iconDiv.className = 'icon';
            if (iconCircle) {
              // Crear nuevo elemento en lugar de clonar
              const iconDivInner = document.createElement('div');
              iconDivInner.style.cssText = iconCircle.style.cssText;
              iconDivInner.className = iconCircle.className;
              iconDivInner.style.width = '36px';
              iconDivInner.style.height = '36px';
              // Copiar contenido sin clonar
              iconDivInner.innerHTML = iconCircle.innerHTML;
              iconDiv.appendChild(iconDivInner);
        } else {
              // Fallback
              iconDiv.innerHTML = `<div style="width: 36px; height: 36px; border-radius: 50%; border: 1px solid #e8eaed; display: flex; align-items: center; justify-content: center;">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                </svg>
              </div>`;
            }
            
            const labelDiv = document.createElement('span');
            labelDiv.className = 'label';
            labelDiv.textContent = tab.title || 'Tab';
        
        tabItem.appendChild(iconDiv);
            tabItem.appendChild(labelDiv);
            
            // Three dots button si está editando
            if (isEditing) {
              const threeDotsBtn = document.createElement('button');
              threeDotsBtn.className = 'mobile-tab-menu-btn';
              threeDotsBtn.style.cssText = 'position: absolute; top: 4px; right: 4px; padding: 2px; opacity: 0.7; z-index: 1000; background: rgba(255, 255, 255, 0.9); border-radius: 50%; border: 1px solid rgba(0,0,0,0.1); cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 2px rgba(0,0,0,0.1); pointer-events: auto; width: 20px; height: 20px;';
              threeDotsBtn.dataset.tabId = tab.id;
              if (tab.backendId) threeDotsBtn.dataset.backendId = tab.backendId;
              threeDotsBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #5f6368;">
                  <circle cx="12" cy="12" r="1"></circle>
                  <circle cx="12" cy="5" r="1"></circle>
                  <circle cx="12" cy="19" r="1"></circle>
                </svg>
              `;
              
              threeDotsBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                
                const tabData = {
                  id: tab.backendId || tab.id,
                  title: tab.title,
                  url: tab.url || tab.bookmark_url,
                  bookmark_url: tab.bookmark_url,
                  avatar_emoji: tab.avatar_emoji,
                  avatar_color: tab.avatar_color,
                  avatar_photo: tab.avatar_photo,
                  cookie_container_id: tab.cookie_container_id,
                  space_id: tab.space_id
                };
                
                if (tab.backendId) {
                  try {
                    const response = await this.request(`/api/tabs/${tab.backendId}`);
                    if (response?.tab) {
                      this.showTabMenu(e, response.tab);
                      return;
                    }
                  } catch {
                    // Error handled silently
                  }
                }
                
                this.showTabMenu(e, tabData);
              }, true);
              
              tabItem.appendChild(threeDotsBtn);
              
              // Prevenir clicks cuando está editando
              tabItem.addEventListener('click', (e) => {
                if (!e.target.closest('.mobile-tab-menu-btn')) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }, true);
              
              // IMPORTANTE: Agregar el tabItem al container cuando está editando
              container.appendChild(tabItem);
            } else {
              // Click handler cuando NO está editando - USAR EXACTAMENTE EL MISMO ENFOQUE QUE FIXED BUTTONS
              // IMPORTANTE: Buscar el elemento existente en el DOM (puede haber sido movido durante drag & drop)
              // y clonarlo para remover TODOS los listeners previos
              let existingTabItem = container.querySelector(`[data-tab-id="${tab.id}"]`);
              if (!existingTabItem) {
                // Si no existe en el container, buscar en todo el bottom bar
                existingTabItem = bottomBar.querySelector(`[data-tab-id="${tab.id}"]`);
              }
              
              // Si existe en el DOM, clonarlo y reemplazarlo; si no, usar el nuevo tabItem
              if (existingTabItem) {
                // Clonar el elemento existente para remover todos los listeners
                const cleanTabItem = existingTabItem.cloneNode(true);
                
                // Asegurar que NO hay tres puntos cuando NO está editando
                const existingThreeDots = cleanTabItem.querySelector('.mobile-tab-menu-btn');
                if (existingThreeDots) {
                  existingThreeDots.remove();
                }
                
                // Asegurar que NO tiene listeners de drag
                cleanTabItem.dataset.dragListener = 'false';
                cleanTabItem.style.touchAction = '';
                cleanTabItem.style.userSelect = '';
                cleanTabItem.style.webkitUserSelect = '';
                
                // Agregar listener de click limpio (igual que fixed buttons)
                cleanTabItem.addEventListener('click', () => {
                  if (window.tabManager) {
                    window.tabManager.activate(tab.id);
                    if (window.mobileUI && window.mobileUI.hideAll) {
                      window.mobileUI.hideAll();
                    }
                  }
                });
                
                // IMPORTANTE: Determinar dónde debe ir el tab según el orden guardado
                // Buscar el elemento anterior en el orden para insertar después de él
                let insertAfter = null;
                if (index > 0) {
                  const prevOrderItem = orderToRender[index - 1];
                  if (prevOrderItem.type === 'tab') {
                    // Buscar el tab anterior en el DOM
                    const prevTab = tabsMap.get(String(prevOrderItem.id));
                    if (prevTab) {
                      const prevTabItem = bottomBar.querySelector(`[data-tab-id="${prevTab.id}"]`);
                      if (prevTabItem) {
                        insertAfter = prevTabItem;
                      }
                    }
                  } else if (prevOrderItem.type === 'fixed') {
                    // Buscar el fixed button anterior
                    let prevFixedBtn = null;
                    if (prevOrderItem.id === 'projects') {
                      prevFixedBtn = document.getElementById('mobile-nav-projects');
                    } else if (prevOrderItem.id === 'users') {
                      prevFixedBtn = document.getElementById('mobile-nav-messenger');
                    } else if (prevOrderItem.id === 'more') {
                      prevFixedBtn = document.getElementById('mobile-nav-more');
                    }
                    if (prevFixedBtn) {
                      insertAfter = prevFixedBtn;
                    }
                  }
                }
                
                // Reemplazar el elemento existente con el clonado limpio
                if (existingTabItem.parentNode) {
                  const oldParent = existingTabItem.parentNode;
                  oldParent.replaceChild(cleanTabItem, existingTabItem);
                  
                  // Mover al lugar correcto según el orden guardado
                  // Determinar el contenedor correcto basado en insertAfter
                  let targetContainer = container;
                  if (insertAfter) {
                    // Si el elemento anterior está en el bottomBar, el tab también debería estar ahí
                    if (insertAfter.parentNode === bottomBar) {
                      targetContainer = bottomBar;
                    }
                  }
                  
                  // Verificar si necesita moverse
                  const needsMove = cleanTabItem.parentNode !== targetContainer || 
                                   (insertAfter && cleanTabItem.previousSibling !== insertAfter);
                  
                  if (needsMove) {
                    // Remover del lugar actual
                    cleanTabItem.remove();
                    
                    // Insertar en el lugar correcto
                    if (insertAfter) {
                      const insertParent = insertAfter.parentNode;
                      insertParent.insertBefore(cleanTabItem, insertAfter.nextSibling);
                    } else {
                      // Si no hay elemento anterior, insertar al principio del targetContainer
                      targetContainer.insertBefore(cleanTabItem, targetContainer.firstChild);
                    }
                  }
                } else {
                  // Si no tiene parent, agregarlo en el lugar correcto
                  if (insertAfter) {
                    const insertParent = insertAfter.parentNode;
                    insertParent.insertBefore(cleanTabItem, insertAfter.nextSibling);
                  } else {
                    container.appendChild(cleanTabItem);
                  }
                }
              } else {
                // Si no existe en el DOM, usar el nuevo tabItem (primera vez que se renderiza)
                // Asegurar que NO hay tres puntos cuando NO está editando
                const existingThreeDots = tabItem.querySelector('.mobile-tab-menu-btn');
                if (existingThreeDots) {
                  existingThreeDots.remove();
                }
                
                // Asegurar que NO tiene listeners de drag
                tabItem.dataset.dragListener = 'false';
                tabItem.style.touchAction = '';
                tabItem.style.userSelect = '';
                tabItem.style.webkitUserSelect = '';
                
                // Agregar listener de click limpio
                tabItem.addEventListener('click', () => {
                  if (window.tabManager) {
                    window.tabManager.activate(tab.id);
                    if (window.mobileUI && window.mobileUI.hideAll) {
                      window.mobileUI.hideAll();
                    }
                  }
                });
                
                // IMPORTANTE: Determinar dónde debe ir el tab según el orden guardado
                // Buscar el elemento anterior en el orden para insertar después de él
                let insertAfter = null;
                if (index > 0) {
                  const prevOrderItem = orderToRender[index - 1];
                  if (prevOrderItem.type === 'tab') {
                    // Buscar el tab anterior en el DOM
                    const prevTab = tabsMap.get(String(prevOrderItem.id));
                    if (prevTab) {
                      const prevTabItem = bottomBar.querySelector(`[data-tab-id="${prevTab.id}"]`);
                      if (prevTabItem) {
                        insertAfter = prevTabItem;
                      }
                    }
                  } else if (prevOrderItem.type === 'fixed') {
                    // Buscar el fixed button anterior
                    let prevFixedBtn = null;
                    if (prevOrderItem.id === 'projects') {
                      prevFixedBtn = document.getElementById('mobile-nav-projects');
                    } else if (prevOrderItem.id === 'users') {
                      prevFixedBtn = document.getElementById('mobile-nav-messenger');
                    } else if (prevOrderItem.id === 'more') {
                      prevFixedBtn = document.getElementById('mobile-nav-more');
                    }
                    if (prevFixedBtn) {
                      insertAfter = prevFixedBtn;
                    }
                  }
                }
                
                // Insertar en el lugar correcto
                if (insertAfter) {
                  if (insertAfter.parentNode === bottomBar) {
                    bottomBar.insertBefore(tabItem, insertAfter.nextSibling);
                  } else {
                    container.insertBefore(tabItem, insertAfter.nextSibling);
                  }
                } else {
                  container.appendChild(tabItem);
                }
              }
            }
          } else {
            // Si no hay originalTabEl, aún así agregar el tabItem básico
            container.appendChild(tabItem);
          }
        } else if (orderItem.type === 'fixed') {
          // Fixed buttons ya están en el HTML, solo agregar listeners y asegurar posición
          let fixedBtn = null;
          if (orderItem.id === 'projects') {
            fixedBtn = document.getElementById('mobile-nav-projects');
          } else if (orderItem.id === 'users') {
            fixedBtn = document.getElementById('mobile-nav-messenger');
          } else if (orderItem.id === 'more') {
            fixedBtn = document.getElementById('mobile-nav-more');
          }

          if (fixedBtn) {
            // Asegurar que el fixed button esté en el bottom bar, no en otro lugar
            if (fixedBtn.parentNode !== bottomBar) {
              bottomBar.appendChild(fixedBtn);
            }
            
            fixedBtn.dataset.index = index;
            
            if (isEditing) {
              // Cuando está editando, solo asegurar que tiene el listener
              // Remover listener previo si existe (limpiar onclick)
              fixedBtn.onclick = null;
              
              // Agregar listener directamente (sin clonar)
              fixedBtn.dataset.listenerAdded = 'true';
              fixedBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                
                // Check if in editing mode - if so, don't open
                if (bottomBar && bottomBar.classList.contains('editing')) {
                  return;
                }
                
                // Use showMobileView function
                if (window.mobileUI && typeof window.mobileUI.showView === 'function') {
                  let viewName = orderItem.id;
                  if (viewName === 'users') viewName = 'messenger';
                  
                  window.mobileUI.showView(viewName);
                  setTimeout(() => {
                    if (viewName === 'projects' && this.renderMobileProjects) {
                    this.renderMobileProjects();
                    } else if (viewName === 'messenger' && this.renderMobileMessenger) {
                      this.renderMobileMessenger();
                      // Update badges after render
                      setTimeout(() => {
                        this.users.forEach(user => {
                          this.updateSpaceBadge(user.id);
                        });
                      }, 150);
                    } else if (viewName === 'more' && this.renderMore) {
                      this.renderMore(false, 'mobile');
                    }
                  }, 50);
                }
              });
            } else {
              // Cuando NO está editando, CLONAR el elemento para remover TODOS los listeners previos
              // (igual que hacemos con los tabs y como se hace en More)
              const cleanFixedBtn = fixedBtn.cloneNode(true);
              
              // Asegurar que NO tiene listeners de drag
              cleanFixedBtn.dataset.dragListener = 'false';
              cleanFixedBtn.style.touchAction = '';
              cleanFixedBtn.style.userSelect = '';
              cleanFixedBtn.style.webkitUserSelect = '';
              
              // Agregar listener de click limpio
              cleanFixedBtn.addEventListener('click', () => {
                // Use showMobileView function
                if (window.mobileUI && typeof window.mobileUI.showView === 'function') {
                  let viewName = orderItem.id;
                  if (viewName === 'users') viewName = 'messenger';
                  
                  window.mobileUI.showView(viewName);
                  setTimeout(() => {
                    if (viewName === 'projects' && this.renderMobileProjects) {
                    this.renderMobileProjects();
                    } else if (viewName === 'messenger' && this.renderMobileMessenger) {
                      this.renderMobileMessenger();
                      // Update badges after render
                      setTimeout(() => {
                        this.users.forEach(user => {
                          this.updateSpaceBadge(user.id);
                        });
                      }, 150);
                    } else if (viewName === 'more' && this.renderMore) {
                      this.renderMore(false, 'mobile');
                    }
                  }, 50);
                }
              });
              
              // Reemplazar el elemento original con el clonado limpio
              if (fixedBtn.parentNode) {
                fixedBtn.parentNode.replaceChild(cleanFixedBtn, fixedBtn);
              } else {
                bottomBar.appendChild(cleanFixedBtn);
              }
            }
          }
        }
      });

      // Store more tabs for More view
      this.mobileMoreTabs = personalTabs.filter(t => {
        const tId = String(t.backendId || t.id);
        return moreTabIds.has(tId);
      });

      // Asegurar que los tres puntos se muestren/oculten correctamente
      // Si NO está editando, remover todos los tres puntos inmediatamente
      if (!isEditing) {
        const allThreeDots = bottomBar.querySelectorAll('.mobile-tab-menu-btn');
        allThreeDots.forEach(btn => btn.remove());
      }

      // Setup drag & drop SOLO si está editando
      if (isEditing) {
        this.setupMobileBottomBarDragAndDropLikeMore();
      } else {
        // Si NO está editando, ASEGURAR que NO hay listeners de drag activos
        // Esto es CRÍTICO - remover cualquier listener de drag que pueda estar activo
        // Remover de TODOS los items del bottom bar (tabs Y fixed buttons)
        const allItems = bottomBar.querySelectorAll('.bottom-nav-item');
        allItems.forEach(item => {
          // Remover listeners de drag si existen
          if (item._dragHandlers) {
            item.removeEventListener('touchstart', item._dragHandlers.touchstart);
            item.removeEventListener('touchmove', item._dragHandlers.touchmove);
            item.removeEventListener('touchend', item._dragHandlers.touchend);
            delete item._dragHandlers;
          }
          item.dataset.dragListener = 'false';
          item.style.touchAction = '';
          item.style.userSelect = '';
          item.style.webkitUserSelect = '';
        });
      }
    } catch (err) {
      console.error('Error rendering mobile bottom bar:', err);
    }
  }

  // Setup drag & drop for mobile bottom bar (sin clonar elementos)
  setupMobileBottomBarDragAndDropLikeMore() {
    const bottomBar = document.getElementById('mobile-bottom-bar');
    if (!bottomBar) return;
    
    // CRÍTICO: Solo configurar drag & drop si estamos en modo de edición
    // Si NO está editando, SALIR INMEDIATAMENTE sin hacer nada
    if (!bottomBar.classList.contains('editing')) {
      return;
    }

    // Limpiar banderas de drag listeners previos para permitir re-agregar
    const allItems = bottomBar.querySelectorAll('.bottom-nav-item');
    allItems.forEach(item => {
      // Remover listeners previos si existen
      if (item._dragHandlers) {
        item.removeEventListener('touchstart', item._dragHandlers.touchstart);
        item.removeEventListener('touchmove', item._dragHandlers.touchmove);
        item.removeEventListener('touchend', item._dragHandlers.touchend);
        delete item._dragHandlers;
      }
      
      item.dataset.dragListener = 'false';
      // Aplicar estilos de drag solo cuando estamos en modo de edición
      item.style.touchAction = 'none';
      item.style.userSelect = 'none';
      item.style.webkitUserSelect = 'none';
    });

    let draggedElement = null;

    allItems.forEach((item) => {
      // IMPORTANTE: Verificar que todavía estamos en modo de edición ANTES de agregar listeners
      if (!bottomBar.classList.contains('editing')) {
        // Ya no estamos editando, NO agregar listeners de drag
        item.dataset.dragListener = 'false';
        item.style.touchAction = '';
        item.style.userSelect = '';
        item.style.webkitUserSelect = '';
        return;
      }
      
      // Verificar bandera para evitar agregar listeners múltiples veces
      if (item.dataset.dragListener === 'true') {
        // Ya tiene listeners, saltar
        return;
      }
      item.dataset.dragListener = 'true';
      
      // Get tab data (only for tabs, not for fixed buttons)
      const tabId = item.dataset.tabId;
      const tabs = window.tabManager?.tabs || [];
      const tab = tabId ? tabs.find(t => String(t.id) === String(tabId)) : null;
      
      // Set index for all items (tabs and fixed buttons)
      const allItemsArray = Array.from(bottomBar.querySelectorAll('.bottom-nav-item'));
      const itemIndex = allItemsArray.indexOf(item);
      item.dataset.index = itemIndex;
      
      // Ensure item is draggable ONLY when in editing mode
      // We'll set these styles dynamically based on editing mode
      // Don't set them here to allow normal clicks when not editing
      
      // Crear handlers y guardarlos para poder removerlos después
      const touchStartHandler = (e) => {
        // Don't start drag if clicking on three dots button - same as More
        if (e.target.closest('.mobile-tab-menu-btn')) return;
        
        e.preventDefault();
        e.stopPropagation();
        draggedElement = item;
        item.classList.add('dragging');
        item.style.opacity = '0.5';
        item.style.zIndex = '1000';
      };
      
      const touchMoveHandler = (e) => {
        if (!draggedElement) return;
        e.preventDefault();
        e.stopPropagation();
        
        const touch = e.touches[0];
        const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        
        // Check if dropping on More container - same as More
        const moreContainer = elementBelow?.closest('#mobile-more-content');
        if (moreContainer) {
          moreContainer.style.opacity = '0.7';
          return;
        }
        
        // Check if dropping on another item - same logic as More
        let targetItem = elementBelow?.closest('.bottom-nav-item');
        
        if (!targetItem && elementBelow?.closest('.mobile-tab-menu-btn')) {
          targetItem = elementBelow.closest('.mobile-tab-menu-btn')?.closest('.bottom-nav-item');
        }
        
        if (targetItem && targetItem !== draggedElement) {
          // Calculate indices based on position in bottom bar (all items)
          const allItemsArray = Array.from(bottomBar.querySelectorAll('.bottom-nav-item'));
          const currentDraggedIndex = allItemsArray.indexOf(draggedElement);
          const targetIndex = allItemsArray.indexOf(targetItem);
          
          if (currentDraggedIndex !== -1 && targetIndex !== -1 && currentDraggedIndex !== targetIndex) {
            // Get target's parent (could be mobile-tabs-container or mobile-bottom-bar)
            const targetParent = targetItem.parentNode;
            
            // Move element to new position
            if (currentDraggedIndex < targetIndex) {
              // Moving forward - insert after target
              if (targetItem.nextSibling) {
                targetParent.insertBefore(draggedElement, targetItem.nextSibling);
              } else {
                targetParent.appendChild(draggedElement);
              }
            } else {
              // Moving backward - insert before target
              targetParent.insertBefore(draggedElement, targetItem);
            }
            
            // Update indices for all items
            Array.from(bottomBar.querySelectorAll('.bottom-nav-item')).forEach((item, idx) => {
              item.dataset.index = idx;
            });
            
            draggedElement.dataset.index = targetIndex;
          }
        }
      };
      
      const touchEndHandler = (e) => {
        // Solo procesar si estamos en modo de edición
        if (!bottomBar.classList.contains('editing')) {
          draggedElement = null;
          // NO prevenir comportamiento si no estamos editando - permitir clicks normales
          return;
        }
        
        if (!draggedElement) return;
        e.preventDefault();
        e.stopPropagation();
        
        const touch = e.changedTouches[0];
        const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        const moreContainer = elementBelow?.closest('#mobile-more-content');
        
        // Reset More container opacity
        if (moreContainer) {
          moreContainer.style.opacity = '';
        }
        
        // Reset styles
        draggedElement.classList.remove('dragging');
        draggedElement.style.opacity = '';
        draggedElement.style.zIndex = '';
        
        // Check if dropped on More - same as More (only for tabs, not fixed buttons)
        if (moreContainer && tab && !item.dataset.fixedButton) {
          // Move tab from bottom bar to More
          this.moveTabToMobileMore(tab).then(() => {
            this.renderMobileBottomBar(true);
            this.renderMore(false, 'mobile');
          });
        } else {
          // Asegurar que los fixed buttons estén en el bottomBar, no en el container
          const container = document.getElementById('mobile-tabs-container');
          if (bottomBar && container) {
            const fixedButtons = bottomBar.querySelectorAll('.bottom-nav-item[data-fixed-button]');
            fixedButtons.forEach(btn => {
              // Si el fixed button está en el container, moverlo al bottomBar
              if (btn.parentNode === container) {
                bottomBar.appendChild(btn);
              }
            });
          }
          
          // Save new order - same as More (for all items including fixed buttons)
          this.saveMobileBottomBarOrder();
        }
        
        draggedElement = null;
      };
      
      // Agregar listeners y guardarlos para poder removerlos después
      item.addEventListener('touchstart', touchStartHandler, { passive: false, capture: false });
      item.addEventListener('touchmove', touchMoveHandler, { passive: false, capture: false });
      item.addEventListener('touchend', touchEndHandler, { passive: false, capture: false });
      
      // Guardar referencias para poder removerlos después
      item._dragHandlers = {
        touchstart: touchStartHandler,
        touchmove: touchMoveHandler,
        touchend: touchEndHandler
      };
    });
  }

  // OLD CODE REMOVED - using new unified approach above

  setupMobileBottomBarDragAndDrop() {
    // Esta función está obsoleta - usar setupMobileBottomBarDragAndDropLikeMore() en su lugar
    // Redirigir a la nueva función
    return this.setupMobileBottomBarDragAndDropLikeMore();
  }

  // FUNCIÓN OBSOLETA - mantener por compatibilidad pero redirige a setupMobileBottomBarDragAndDropLikeMore
  setupMobileBottomBarDragAndDrop_OLD() {
    // Use simple bottom bar drag & drop if available
    if (this.simpleMobileBottomBar) {
      this.simpleMobileBottomBar.setupDragAndDrop();
      return;
    }
    
    // Fallback to old code if simple version not available
    const bottomBar = document.getElementById('mobile-bottom-bar');
    if (!bottomBar || !bottomBar.classList.contains('editing')) {
      if (bottomBar) {
        bottomBar.dataset.dragSetup = 'false';
        bottomBar.querySelectorAll('.bottom-nav-item').forEach(item => {
          item.dataset.dragListener = 'false';
        });
      }
      return;
    }

    // Check if already set up to prevent duplicate listeners
    if (bottomBar.dataset.dragSetup === 'true') {
      return;
    }
    bottomBar.dataset.dragSetup = 'true';

    // Get ALL items in bottom bar (tabs + fixed buttons)
    const allItems = Array.from(bottomBar.querySelectorAll('.bottom-nav-item'));
    let draggedElement = null;
    let draggedIndex = null;
    let draggedData = null; // Can be tab or fixed button

    allItems.forEach((item, index) => {
      // Only clone if item doesn't already have drag listener
      if (item.dataset.dragListener === 'true') {
        return; // Skip, already has listener
      }
      
      // OBSOLETO - NO CLONAR - usar setupMobileBottomBarDragAndDropLikeMore() en su lugar
      const newItem = item.cloneNode(true);
      item.parentNode.replaceChild(newItem, item);
      newItem.dataset.dragListener = 'true';
      
      // Store index and identify type
      newItem.dataset.index = index;
      const isFixedButton = newItem.dataset.fixedButton;
      const tabId = newItem.querySelector('.mobile-tab-menu-btn')?.dataset.tabId || 
                    newItem.dataset.tabId;
      
      // Store data
      if (isFixedButton) {
        newItem.dataset.itemType = 'fixed';
        newItem.dataset.itemId = isFixedButton;
        
        // Re-attach click listeners for fixed buttons using centralized function
        // This ensures consistency across all code paths
        if (isFixedButton) {
          // Use the centralized handler
          const handler = (viewName, renderFn) => (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            const bottomBar = document.getElementById('mobile-bottom-bar');
            if (bottomBar && bottomBar.classList.contains('editing')) {
              return;
            }
            
            if (window.mobileUI && typeof window.mobileUI.showView === 'function') {
              window.mobileUI.showView(viewName);
                setTimeout(() => {
                if (this[renderFn]) {
                  this[renderFn]();
                }
                }, 50);
              }
          };
          
          if (isFixedButton === 'projects') {
            newItem.onclick = handler('projects', 'renderMobileProjects');
          } else if (isFixedButton === 'users') {
            newItem.onclick = handler('messenger', 'renderMobileMessenger');
          } else if (isFixedButton === 'more') {
            newItem.onclick = (e) => {
              e.stopPropagation();
              e.preventDefault();
              
              const bottomBar = document.getElementById('mobile-bottom-bar');
              if (bottomBar && bottomBar.classList.contains('editing')) {
                return;
              }
              
              if (window.mobileUI && typeof window.mobileUI.showView === 'function') {
                window.mobileUI.showView('more');
                setTimeout(() => {
                  this.renderMore(false, 'mobile');
                }, 50);
              }
            };
          }
        }
      } else if (tabId) {
        newItem.dataset.itemType = 'tab';
        newItem.dataset.tabId = tabId;
      } else {
        return; // Skip if can't identify
      }
      
      newItem.addEventListener('touchstart', (e) => {
        // Check if still in editing mode before allowing drag
        const bottomBarCheck = document.getElementById('mobile-bottom-bar');
        if (!bottomBarCheck || !bottomBarCheck.classList.contains('editing')) {
          return; // Not in editing mode, don't allow drag
        }
        
        // Don't start drag if clicking on three dots button
        if (e.target.closest('.mobile-tab-menu-btn')) return;
        
        e.preventDefault();
        draggedElement = newItem;
        draggedIndex = index;
        
        if (isFixedButton) {
          draggedData = { type: 'fixed', id: isFixedButton };
        } else if (tabId) {
          const tabs = window.tabManager?.tabs || [];
          const tab = tabs.find(t => String(t.id) === String(tabId));
          draggedData = { type: 'tab', tab: tab };
        }
        
        newItem.classList.add('dragging');
        newItem.style.opacity = '0.5';
      }, { passive: false });

      newItem.addEventListener('touchmove', (e) => {
        // Check if still in editing mode
        const bottomBarCheck = document.getElementById('mobile-bottom-bar');
        if (!bottomBarCheck || !bottomBarCheck.classList.contains('editing')) {
          if (draggedElement) {
            draggedElement.classList.remove('dragging');
            draggedElement.style.opacity = '';
            draggedElement = null;
            draggedIndex = null;
            draggedData = null;
          }
          return; // Not in editing mode, cancel drag
        }
        
        if (!draggedElement) return;
        e.preventDefault();
        
        const touch = e.touches[0];
        const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        
        // Check if dropping on More button (only for tabs, not fixed buttons)
        const moreBtn = elementBelow?.closest('#mobile-nav-more');
        if (moreBtn && draggedData?.type === 'tab') {
          moreBtn.style.opacity = '0.7';
          return;
        }
        
        // Check if dropping on another item in bottom bar
        const targetItem = elementBelow?.closest('.bottom-nav-item');
        
        if (targetItem && targetItem !== draggedElement) {
          // Get all items in current order
          const allItems = Array.from(bottomBar.querySelectorAll('.bottom-nav-item'));
          const targetIndex = allItems.indexOf(targetItem);
          
          if (targetIndex !== -1 && targetIndex !== draggedIndex) {
            // Get both parent containers
            const draggedParent = draggedElement.parentElement;
            const targetParent = targetItem.parentElement;
            
            // If same parent, just reorder
            if (draggedParent === targetParent) {
              if (draggedIndex < targetIndex) {
                draggedParent.insertBefore(draggedElement, targetItem.nextSibling);
              } else {
                draggedParent.insertBefore(draggedElement, targetItem);
              }
            } else {
              // Different parents - move between containers
              if (draggedIndex < targetIndex) {
                targetParent.insertBefore(draggedElement, targetItem.nextSibling);
              } else {
                targetParent.insertBefore(draggedElement, targetItem);
              }
            }
            
            // Update indices for all items
            const updatedItems = Array.from(bottomBar.querySelectorAll('.bottom-nav-item'));
            updatedItems.forEach((item, idx) => {
              item.dataset.index = idx;
            });
            
            draggedIndex = targetIndex;
            
            // Force reflow to ensure flexbox recalculates
            bottomBar.offsetHeight;
          }
        }
      }, { passive: false });

      newItem.addEventListener('touchend', (e) => {
        if (!draggedElement) return;
        e.preventDefault();
        
        const touch = e.changedTouches[0];
        const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        const moreBtn = elementBelow?.closest('#mobile-nav-more');
        
        // Reset More button opacity
        if (moreBtn) {
          moreBtn.style.opacity = '';
        }
        
        // Check if dropped on More button (only for tabs)
        if (moreBtn && draggedData?.type === 'tab' && draggedData?.tab) {
          // Move tab to More - need to re-render
          this.moveTabToMobileMore(draggedData.tab).then(() => {
            // Only re-render if we actually moved the tab
            this.renderMobileBottomBar();
            this.renderMore(false, 'mobile');
          });
        } else {
          // Just reordering within bottom bar - don't re-render, just save order
          // Re-rendering causes duplication
          this.saveMobileBottomBarOrder();
        }
        
        // Ensure all items are visible after drag
        bottomBar.querySelectorAll('.bottom-nav-item').forEach(item => {
          item.style.display = 'flex';
          item.style.visibility = 'visible';
          item.style.opacity = '';
        });
        
        draggedElement.classList.remove('dragging');
        draggedElement.style.opacity = '';
        
        // Don't re-render immediately - just save order
        // Re-render will happen naturally when needed
        draggedElement = null;
        draggedData = null;
      }, { passive: false });
    });
  }

  async saveMobileBottomBarOrder() {
    const bottomBar = document.getElementById('mobile-bottom-bar');
    const container = document.getElementById('mobile-tabs-container');
    if (!bottomBar) return;
    
    // Get current order from DOM (tabs from container + fixed buttons from bottomBar)
    // IMPORTANTE: Los tabs pueden estar en el container O en el bottomBar (si se movieron después de fixed buttons)
    const order = [];
    
    // Obtener TODOS los items del bottomBar en orden (tabs Y fixed buttons)
    // Esto captura el orden real en el DOM, sin importar dónde estén
    const allBottomBarItems = Array.from(bottomBar.querySelectorAll('.bottom-nav-item'));
    
    // Ordenar por posición en el DOM (usando compareDocumentPosition o índice)
    allBottomBarItems.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1; // a viene antes de b
      } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1; // a viene después de b
      }
      return 0;
    });
    
    // Procesar cada item en orden
    allBottomBarItems.forEach(item => {
      // Verificar si es un tab
      const tabId = item.dataset.tabId;
      if (tabId) {
        // Use backendId if available, otherwise use id
        const tab = window.tabManager?.tabs?.find(t => String(t.id) === String(tabId));
        if (tab) {
          const tabIdToSave = String(tab.backendId || tab.id);
          order.push({ type: 'tab', id: tabIdToSave });
        }
      } else {
        // Verificar si es un fixed button
        const fixedButton = item.dataset.fixedButton;
        if (fixedButton) {
          order.push({ type: 'fixed', id: fixedButton });
        }
      }
    });
    
    // También obtener tabs del container que puedan no estar en el bottomBar aún
    // (por si acaso hay algún tab que no se haya movido al bottomBar)
    if (container) {
      const containerTabItems = Array.from(container.querySelectorAll('.bottom-nav-item[data-tab-id]'));
      containerTabItems.forEach(item => {
        const tabId = item.dataset.tabId;
        if (tabId) {
          // Verificar si ya está en el orden
          const tab = window.tabManager?.tabs?.find(t => String(t.id) === String(tabId));
          if (tab) {
            const tabIdToSave = String(tab.backendId || tab.id);
            const alreadyInOrder = order.some(o => o.type === 'tab' && o.id === tabIdToSave);
            if (!alreadyInOrder) {
              // Si no está en el orden, agregarlo (probablemente al final)
              order.push({ type: 'tab', id: tabIdToSave });
            }
          }
        }
      });
    }
    
    // Save order to preferences (with error handling)
    try {
      await this.savePreferences({ mobile_bottom_bar_order: order });
    } catch (err) {
      console.error('Failed to save mobile bottom bar order:', err);
      // Don't throw - just log the error, order is still preserved in DOM
    }
    
    // Also save tabs order if there are tabs
    const tabs = window.tabManager?.tabs || [];
    const personalTabs = tabs.filter(t => {
      const url = t.url || '';
      return url && url !== '/new' && url !== 'tabs://new' && !t.spaceId && !this.isChatUrl(url);
    });
    
    // Get tabs in bottom bar (not in More)
    const moreTabIds = this.getMobileMoreTabIdsSync();
    const bottomBarTabs = personalTabs.filter(t => {
      const tId = String(t.backendId || t.id);
      return !moreTabIds.has(tId);
    });
    
    // Reorder bottomBarTabs based on DOM order
    const reorderedBottomBarTabs = [];
    for (const item of order) {
      if (item.type === 'tab') {
        // Try to find by backendId first, then by id
        const tab = bottomBarTabs.find(t => 
          String(t.backendId || t.id) === String(item.id) || 
          String(t.id) === String(item.id)
        );
        if (tab) {
          reorderedBottomBarTabs.push(tab);
        }
      }
    }
    
    // Add remaining tabs
    for (const tab of bottomBarTabs) {
      if (!reorderedBottomBarTabs.find(t => String(t.id) === String(tab.id))) {
        reorderedBottomBarTabs.push(tab);
      }
    }
    
    // Update TabManager order
    const moreTabs = personalTabs.filter(t => {
      const tId = String(t.backendId || t.id);
      return moreTabIds.has(tId);
    });
    
    const allPersonalTabs = [...reorderedBottomBarTabs, ...moreTabs];
    const allTabs = window.tabManager?.tabs || [];
    const reorderedTabs = [];
    for (const personalTab of allPersonalTabs) {
      const tabManagerTab = allTabs.find(t => String(t.id) === String(personalTab.id));
      if (tabManagerTab) {
        reorderedTabs.push(tabManagerTab);
      }
    }
    
    // Add non-personal tabs
    const nonPersonalTabs = allTabs.filter(t => {
      const url = t.url || '';
      return url === '/new' || url === 'tabs://new' || t.spaceId || this.isChatUrl(url);
    });
    
    window.tabManager.tabs = [...reorderedTabs, ...nonPersonalTabs];
    
    // Save tabs order to backend
    const updates = allPersonalTabs.map((tab, index) => {
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
    } catch (err) {
        console.error('Failed to save tabs order:', err);
      }
    }
  }

  async moveTabToMobileMore(tab) {
    const tabId = String(tab.backendId || tab.id);
    const moreTabIds = await this.getMobileMoreTabIds();
    moreTabIds.add(tabId);
    await this.setMobileMoreTabIds(moreTabIds);
    
    // Update mobile more tabs
    const tabs = window.tabManager?.tabs || [];
    const personalTabs = tabs.filter(t => {
      const url = t.url || '';
      return url && url !== '/new' && url !== 'tabs://new' && !t.spaceId && !this.isChatUrl(url);
    });
    
    const moreTabs = personalTabs.filter(t => {
      const tId = String(t.backendId || t.id);
      return moreTabIds.has(tId);
    });
    
    this.mobileMoreTabs = moreTabs;
    
    // Re-render
    this.renderMobileBottomBar();
  }

  async moveTabFromMobileMore(tab) {
    const tabId = String(tab.backendId || tab.id);
    const moreTabIds = await this.getMobileMoreTabIds();
    moreTabIds.delete(tabId);
    await this.setMobileMoreTabIds(moreTabIds);
    
    // Update mobile more tabs
    const tabs = window.tabManager?.tabs || [];
    const personalTabs = tabs.filter(t => {
      const url = t.url || '';
      return url && url !== '/new' && url !== 'tabs://new' && !t.spaceId && !this.isChatUrl(url);
    });
    
    const moreTabs = personalTabs.filter(t => {
      const tId = String(t.backendId || t.id);
      return moreTabIds.has(tId);
    });
    
    this.mobileMoreTabs = moreTabs;
    
    // Re-render
    this.renderMobileBottomBar();
  }

  renderMobileProjects() {
    // CÓDIGO BASE ÚNICO: Clonar TODA la sección del sidebar (incluyendo header con botón "+")
    const projectsCont = document.getElementById('projects-cont');
    const mobileContainer = document.getElementById('mobile-projects-content');
    if (!projectsCont || !mobileContainer) return;
    
    // Find parent section - projects-cont is directly inside the section div (which includes header)
    const fullSection = projectsCont.parentElement;
    if (!fullSection) return;
    
    // Clonar TODA la sección (header + contenido) - CÓDIGO BASE ÚNICO
    const cloned = fullSection.cloneNode(true);
    mobileContainer.innerHTML = '';
    mobileContainer.appendChild(cloned);
    
    // Re-attach event listeners for mobile - usar el mismo botón del sidebar clonado
    const projectBtn = cloned.querySelector('#project-btn');
    if (projectBtn) {
      projectBtn.addEventListener('click', () => {
        this.createProject();
      });
    }
    
    // 2. Event listeners para proyectos
    cloned.querySelectorAll('.project-item').forEach(item => {
      const projectId = item.closest('[data-project-id]')?.getAttribute('data-project-id');
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
        
        // Handle menu button
        const menuBtn = e.target.closest('.project-menu-btn');
        if (menuBtn) {
          e.stopPropagation();
          const project = this.allProjects.find(p => p.id === projectId) || this.projects.find(p => p.id === projectId);
          if (project) {
            this.showProjectMenu(e, project);
          }
          return;
        }
        
        // Select project
        if (!e.target.closest('.drop-indicator') && !e.target.closest('.project-menu-btn')) {
          this.selectProject(projectId);
          if (window.mobileUI && window.mobileUI.hideAll) {
            window.mobileUI.hideAll();
          }
        }
      });
    });
  }

  renderMobileMessenger() {
    // CÓDIGO BASE ÚNICO: Clonar TODA la sección del sidebar (incluyendo header con botón "+")
    const usersCont = document.getElementById('users-cont');
    const mobileContainer = document.getElementById('mobile-messenger-content');
    if (!usersCont || !mobileContainer) return;
    
    // Find parent section - users-cont is directly inside the section div (which includes header)
    const fullSection = usersCont.parentElement;
    if (!fullSection) return;
    
    // Clonar TODA la sección (header + contenido) - CÓDIGO BASE ÚNICO
    const cloned = fullSection.cloneNode(true);
    mobileContainer.innerHTML = '';
    mobileContainer.appendChild(cloned);
    
    // Re-attach event listeners for mobile - usar el mismo botón del sidebar clonado
    const dmBtn = cloned.querySelector('#dm-btn');
    if (dmBtn) {
      dmBtn.addEventListener('click', () => {
        this.showUserPicker();
      });
    }
    
    // 2. Event listeners para usuarios
    cloned.querySelectorAll('.user-item').forEach(item => {
      const userId = item.getAttribute('data-user-id');
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
    
    // After cloning and setting up event listeners, update badges
    // This ensures the cloned badges show the correct unread counts
    setTimeout(() => {
      this.users.forEach(user => {
        this.updateSpaceBadge(user.id);
      });
    }, 100);
  }

  // Unified renderMore function - works for mobile only (desktop More dropdown removed)
  renderMore(isEditing = false, platform = 'mobile') {
    const isMobile = platform === 'mobile';
    const containerId = isMobile ? 'mobile-more-content' : null;
    if (!isMobile) return; // Desktop More dropdown removed
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    // Use mobile tabs array only (desktop More dropdown removed)
    const moreTabs = isMobile ? (this.mobileMoreTabs || []) : [];
    if (moreTabs.length === 0) {
      container.innerHTML = '<div class="text-center text-gray-500 py-8 px-4">No additional tabs</div>';
      return;
    }

    if (isMobile) {
      // Mobile: render as grid (4 columnas)
      moreTabs.forEach((tab, index) => {
        const tabItem = document.createElement('div');
        tabItem.className = 'mobile-more-item';
        tabItem.style.position = 'relative';
        tabItem.dataset.tabId = tab.id;
        tabItem.dataset.index = index;
        
        // USAR EL MISMO TEMPLATE DEL SIDEBAR - CÓDIGO BASE ÚNICO
        const tabHtml = window.tabManager.tabTemplate(tab, !isEditing, false);
        const tabWrapper = document.createElement('div');
        tabWrapper.innerHTML = tabHtml;
        const originalTabEl = tabWrapper.firstElementChild;
        
        if (originalTabEl) {
          // Extraer el círculo del icono (el div con rounded-full)
          const iconCircle = originalTabEl.querySelector('.rounded-full');
          
          // Crear estructura mobile more adaptada
          const iconDiv = document.createElement('div');
          iconDiv.className = 'mobile-more-item-icon';
          if (iconCircle) {
            const iconClone = iconCircle.cloneNode(true);
            // Mantener el círculo pero ajustar tamaño para mobile more (más grande: 36px)
            iconClone.style.width = '36px';
            iconClone.style.height = '36px';
            iconDiv.appendChild(iconClone);
          } else {
            // Fallback
            iconDiv.innerHTML = `<div style="width: 36px; height: 36px; border-radius: 50%; border: 1px solid #e8eaed; display: flex; align-items: center; justify-content: center;">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              </svg>
            </div>`;
          }
          
          const labelDiv = document.createElement('div');
          labelDiv.className = 'mobile-more-item-label';
          labelDiv.textContent = tab.title || 'Tab';
          labelDiv.title = tab.title || 'Tab'; // Tooltip con texto completo
          
          tabItem.appendChild(iconDiv);
          tabItem.appendChild(labelDiv);
          
          if (isEditing) {
            // Create three dots button - CÓDIGO ÚNICO (igual que bottom bar y desktop)
            const threeDotsBtn = document.createElement('button');
            threeDotsBtn.className = 'mobile-tab-menu-btn';
            threeDotsBtn.style.cssText = 'position: absolute; top: 4px; right: 4px; padding: 2px; opacity: 0.7; z-index: 1000; background: rgba(255, 255, 255, 0.9); border-radius: 50%; border: 1px solid rgba(0,0,0,0.1); cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 2px rgba(0,0,0,0.1); pointer-events: auto; width: 20px; height: 20px;';
            threeDotsBtn.dataset.tabId = tab.id;
            if (tab.backendId) threeDotsBtn.dataset.backendId = tab.backendId;
            threeDotsBtn.title = 'Menu';
            
            threeDotsBtn.innerHTML = `
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #5f6368;">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
              </svg>
            `;
            
            // CÓDIGO ÚNICO - mismo handler que desktop y bottom bar
            threeDotsBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              e.stopImmediatePropagation();
              e.preventDefault();
              
              // Construir tab object directamente (código único - mismo que desktop y bottom bar)
              const tabData = {
                id: tab.backendId || tab.id,
                title: tab.title,
                url: tab.url || tab.bookmark_url,
                bookmark_url: tab.bookmark_url,
                avatar_emoji: tab.avatar_emoji,
                avatar_color: tab.avatar_color,
                avatar_photo: tab.avatar_photo,
                cookie_container_id: tab.cookie_container_id,
                space_id: tab.space_id
              };
              
              // Intentar obtener datos completos del backend solo si hay backendId
              if (tab.backendId) {
                try {
                  const response = await this.request(`/api/tabs/${tab.backendId}`);
                  if (response && response.tab) {
                    this.showTabMenu(e, response.tab);
                    return;
                  }
                } catch {
                  // Silently fall back to tab data
                }
              }
              
              // Usar datos del tab actual (fallback o si no hay backendId)
              this.showTabMenu(e, tabData);
            }, true); // Capture phase
            
            tabItem.appendChild(threeDotsBtn);
            
            // Prevenir clicks en el tab item cuando está editando
            tabItem.addEventListener('click', (e) => {
              if (!e.target.closest('.mobile-tab-menu-btn')) {
                e.preventDefault();
                e.stopPropagation();
              }
            }, true); // Capture phase
        } else {
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
        }
      });
    }

    if (isEditing && isMobile) {
      this.setupMobileMoreDragAndDrop(true);
    }
  }

  // Alias for backward compatibility
  renderMobileMore(isEditing = false) {
    this.renderMore(isEditing, 'mobile');
  }

  // More dropdown removed - no longer needed

  setupMobileMoreDragAndDrop(isEditing) {
    if (!isEditing) return;

    const container = document.getElementById('mobile-more-content');
    if (!container) return;

    const items = container.querySelectorAll('.mobile-more-item');
    let draggedElement = null;

    items.forEach((item) => {
      // Remove existing listeners by cloning
      const newItem = item.cloneNode(true);
      item.parentNode.replaceChild(newItem, item);
      
      // Get tab data
      const tabId = newItem.dataset.tabId;
      const tabs = window.tabManager?.tabs || [];
      const tab = tabs.find(t => String(t.id) === String(tabId));
      
      newItem.addEventListener('touchstart', (e) => {
        // Don't start drag if clicking on three dots button
        if (e.target.closest('.mobile-tab-menu-btn')) return;
        
        e.preventDefault();
        draggedElement = newItem;
        newItem.classList.add('dragging');
        newItem.style.opacity = '0.5';
      }, { passive: false });

      newItem.addEventListener('touchmove', (e) => {
        if (!draggedElement) return;
        e.preventDefault();
        
        const touch = e.touches[0];
        const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        
        // Check if dropping on bottom bar (tabs container, bottom bar itself, or any bottom nav item)
        const bottomBarContainer = elementBelow?.closest('#mobile-tabs-container');
        const bottomBar = elementBelow?.closest('#mobile-bottom-bar');
        const bottomNavItem = elementBelow?.closest('.bottom-nav-item');
        
        if (bottomBarContainer || bottomBar || bottomNavItem) {
          // Visual feedback - highlight the bottom bar
          const targetBar = bottomBar || document.getElementById('mobile-bottom-bar');
          if (targetBar) {
            targetBar.style.opacity = '0.7';
            targetBar.style.backgroundColor = 'rgba(66, 133, 244, 0.1)';
          }
          return;
        }
        
        // Reset bottom bar opacity if not over it
        const bottomBarEl = document.getElementById('mobile-bottom-bar');
        if (bottomBarEl) {
          bottomBarEl.style.opacity = '';
          bottomBarEl.style.backgroundColor = '';
        }
        
        // Check if dropping on another item in More (but not the three dots button)
        let targetItem = elementBelow?.closest('.mobile-more-item');
        
        // If clicked on three dots button, find the parent item
        if (!targetItem && elementBelow?.closest('.mobile-tab-menu-btn')) {
          targetItem = elementBelow.closest('.mobile-tab-menu-btn')?.closest('.mobile-more-item');
        }
        
        if (targetItem && targetItem !== draggedElement) {
          const targetIndex = parseInt(targetItem.dataset.index);
          const currentDraggedIndex = parseInt(draggedElement.dataset.index);
          
          if (!isNaN(targetIndex) && !isNaN(currentDraggedIndex) && targetIndex !== currentDraggedIndex) {
            // Swap elements
            if (currentDraggedIndex < targetIndex) {
              container.insertBefore(draggedElement, targetItem.nextSibling);
            } else {
              container.insertBefore(draggedElement, targetItem);
            }
            
            // Update indices for all items
            Array.from(container.children).forEach((item, idx) => {
              if (item.classList.contains('mobile-more-item')) {
              item.dataset.index = idx;
              }
            });
            
            draggedElement.dataset.index = targetIndex;
            
            // Reorder tabs array - use the current draggedIndex before update
            const moreTabs = this.mobileMoreTabs || [];
            if (moreTabs.length > 0 && currentDraggedIndex >= 0 && currentDraggedIndex < moreTabs.length) {
              const [draggedTab] = moreTabs.splice(currentDraggedIndex, 1);
              if (targetIndex >= 0 && targetIndex <= moreTabs.length) {
            moreTabs.splice(targetIndex, 0, draggedTab);
            this.mobileMoreTabs = moreTabs;
              }
            }
          }
        }
      }, { passive: false });

      newItem.addEventListener('touchend', (e) => {
        if (!draggedElement) return;
        e.preventDefault();
        
        const touch = e.changedTouches[0];
        const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        
        // Check if dropping on bottom bar (tabs container, bottom bar itself, or any bottom nav item)
        const bottomBarContainer = elementBelow?.closest('#mobile-tabs-container');
        const bottomBar = elementBelow?.closest('#mobile-bottom-bar');
        const bottomNavItem = elementBelow?.closest('.bottom-nav-item');
        
        // Reset bottom bar opacity and background
        const bottomBarEl = document.getElementById('mobile-bottom-bar');
        if (bottomBarEl) {
          bottomBarEl.style.opacity = '';
          bottomBarEl.style.backgroundColor = '';
        }
        
        // Check if dropped on bottom bar (any of the valid targets)
        // Also check if dropped anywhere on the bottom bar area (even if not directly on an element)
        const isOverBottomBar = bottomBarContainer || bottomBar || bottomNavItem;
        
        // Additional check: if touch point is within bottom bar bounds
        let isWithinBottomBarBounds = false;
        if (!isOverBottomBar && bottomBarEl) {
          const rect = bottomBarEl.getBoundingClientRect();
          const touchX = touch.clientX;
          const touchY = touch.clientY;
          isWithinBottomBarBounds = (
            touchX >= rect.left &&
            touchX <= rect.right &&
            touchY >= rect.top &&
            touchY <= rect.bottom
          );
        }
        
        if ((isOverBottomBar || isWithinBottomBarBounds) && tab) {
          // Move tab from More to bottom bar
          // moveTabFromMobileMore already calls renderMobileBottomBar(), so we just need to re-render More
          this.moveTabFromMobileMore(tab).then(() => {
            // Re-render More to reflect the change (tab removed from More)
            this.renderMore(false, 'mobile');
          }).catch(err => {
            console.error('Error moving tab from More to bottom bar:', err);
            // Save new order within More as fallback
            this.saveMobileTabsOrder();
          });
        } else {
          // Save new order within More
        this.saveMobileTabsOrder();
        }
        
        draggedElement.classList.remove('dragging');
        draggedElement.style.opacity = '';
        
        draggedElement = null;
      }, { passive: false });
    });
  }

  // Desktop More dropdown removed - no longer needed

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
      return { mobile_more_tab_ids: [] };
    }

    try {
      const data = await this.request('/api/users/preferences');
      this._preferencesCache = data.preferences || { mobile_more_tab_ids: [] };
      this._preferencesCacheTime = Date.now();
      return this._preferencesCache;
    } catch (err) {
      console.error('Failed to load preferences:', err);
      // Return empty defaults on error
      return { mobile_more_tab_ids: [] };
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

  // Desktop More dropdown removed - no longer needed

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

  getMobileBottomBarOrderSync() {
    if (this._preferencesCache) {
      return this._preferencesCache.mobile_bottom_bar_order || null;
    }
    return null;
  }

  async setMobileMoreTabIds(tabIds) {
    const tabIdsArray = Array.from(tabIds);
    await this.savePreferences({ mobile_more_tab_ids: tabIdsArray });
  }


  // Desktop More dropdown removed - no longer needed

  async saveMobileTabsOrder() {
    // Get current order from DOM (bottom bar tabs)
    const container = document.getElementById('mobile-tabs-container');
    const bottomBarTabIds = [];
    if (container) {
      Array.from(container.children).forEach(item => {
        const tabId = item.dataset.tabId;
        if (tabId) bottomBarTabIds.push(tabId);
      });
    }
    
    // Get all personal tabs
    const tabs = window.tabManager.tabs || [];
    const personalTabs = tabs.filter(t => {
      const url = t.url || '';
      return url && url !== '/new' && url !== 'tabs://new' && !t.spaceId && !this.isChatUrl(url);
    });

    // Get tabs in More
    const moreTabs = this.mobileMoreTabs || [];
    const moreTabIds = new Set((moreTabs || []).map(t => String(t.backendId || t.id)).filter(Boolean));

    // Save which tabs are in "More" to backend
    await this.setMobileMoreTabIds(moreTabIds);

    // Get bottom bar tabs in DOM order
    const bottomBarTabs = [];
    for (const tabId of bottomBarTabIds) {
      const tab = personalTabs.find(t => String(t.id) === String(tabId));
      if (tab) bottomBarTabs.push(tab);
    }
    
    // Add remaining bottom bar tabs that weren't in DOM
    const allBottomBarTabs = personalTabs.filter(t => {
      const tId = String(t.backendId || t.id);
      return !moreTabIds.has(tId);
    });
    for (const tab of allBottomBarTabs) {
      if (!bottomBarTabs.find(t => String(t.id) === String(tab.id))) {
        bottomBarTabs.push(tab);
      }
    }

    // Combine in correct order: bottom bar tabs first, then more tabs
    const allTabs = [...bottomBarTabs, ...moreTabs];
    
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
    
    // Only update active state, don't re-render entire sidebar
    this.activeSpace = space;
    
    // Update visual state of active project/user without full re-render
    this.updateActiveSpaceVisualState();
    
    // DON'T update all badges when switching projects - only update when needed
    // Badges are updated when messages are marked as read, not on every project switch

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
            // Para tabs de Notion, usar originalUrl si está disponible (es la URL guardada en el backend)
            const tUrl = (t.originalUrl || t.url || '').trim();
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
        // IMPORTANTE: Para tabs de Notion, usar originalUrl si está disponible para la comparación
        const activeSpaceTab = window.tabManager.tabs.find(t => {
          if (!t.active) return false;
          // Para tabs de Notion, usar originalUrl si está disponible (es la URL guardada en el backend)
          const tUrl = (t.originalUrl || t.url || '').trim();
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
    const topbarSettingsBtn = document.getElementById('topbar-settings-btn');
    
    if (!topbarSpace || !topbarSpaceName || !topbarTabsCont) return;

    if (!this.activeSpace) {
      // Hide TopBar when no space is active
      topbarSpace.classList.add('hidden');
      topbarSpace.style.display = 'none';
      // Hide settings button
      if (topbarSettingsBtn) {
        topbarSettingsBtn.style.display = 'none';
      }
      return;
    }

    // Show TopBar
    topbarSpace.classList.remove('hidden');
    topbarSpace.style.display = 'flex'; // Ensure it's displayed
    topbarSpaceName.textContent = this.activeSpace.display_name || this.activeSpace.name;
    
    // Show settings button when space is active
    if (topbarSettingsBtn) {
      topbarSettingsBtn.style.display = 'block';
    }

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
    // Usar backendId primero (más confiable), luego spaceId, y finalmente comparar URLs
    let spaceTabsInTabManager = (window.tabManager?.tabs || []).filter(t => {
      // Si tiene backendId, verificar si está en spaceTabs
      if (t.backendId) {
        return this.spaceTabs.some(st => st.id === t.backendId);
      }
      // Si tiene spaceId, verificar si coincide con el espacio activo
      if (t.spaceId && this.activeSpace && t.spaceId === this.activeSpace.id) {
        return true;
      }
      // Fallback: comparar URLs (para tabs sin backendId)
      const tUrl = (t.originalUrl || t.url || '').trim();
      if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return false;
      return spaceTabUrls.has(this.normalizeUrl(tUrl));
    });
    
    // IMPORTANTE: Deduplicar tabs por backendId - solo mantener el tab más reciente o activo
    // Esto previene que se muestren tabs duplicados cuando hay múltiples tabs con el mismo backendId
    const tabsByBackendId = new Map();
    spaceTabsInTabManager.forEach(t => {
      if (t.backendId) {
        const existing = tabsByBackendId.get(t.backendId);
        // Preferir tab activo, o el más reciente si ninguno está activo
        if (!existing || (t.active && !existing.active) || (!existing.active && !t.active && t.id > existing.id)) {
          tabsByBackendId.set(t.backendId, t);
        }
      } else {
        // Tabs sin backendId se mantienen (se deduplican por URL más abajo)
        tabsByBackendId.set(`no-backend-${t.id}`, t);
      }
    });
    spaceTabsInTabManager = Array.from(tabsByBackendId.values());
    
    // Ordenar según el orden del backend (position) - mapear cada tab de TabManager con su backend tab
    // IMPORTANTE: Para tabs de Notion, usar originalUrl si está disponible para la comparación
    spaceTabsInTabManager = spaceTabsInTabManager.sort((a, b) => {
      const aUrl = (a.originalUrl || a.url || '').trim();
      const bUrl = (b.originalUrl || b.url || '').trim();
      
      const backendTabA = this.spaceTabs.find(t => {
          const url = t.url || t.bookmark_url;
        return url && this.normalizeUrl(url) === this.normalizeUrl(aUrl);
      });
      const backendTabB = this.spaceTabs.find(t => {
        const url = t.url || t.bookmark_url;
        return url && this.normalizeUrl(url) === this.normalizeUrl(bUrl);
      });
      
      const positionA = backendTabA?.position || 0;
      const positionB = backendTabB?.position || 0;
      return positionA - positionB;
    });
    
    // USAR EXACTAMENTE EL MISMO tabTemplate - CÓDIGO ÚNICO
    // Estos son los MISMOS objetos de TabManager, solo cambia isTopBar=true
    // IMPORTANTE: Sincronizar el estado active antes de renderizar para evitar desincronización visual
    const actuallyActiveTab = window.tabManager?.active();
    const actuallyActiveTabId = actuallyActiveTab?.id;
    spaceTabsInTabManager.forEach(tabManagerTab => {
      // Sincronizar el estado active con el tab realmente activo
      const isActuallyActive = tabManagerTab.id === actuallyActiveTabId;
      if (isActuallyActive !== tabManagerTab.active) {
        tabManagerTab.active = isActuallyActive;
      }
      // USAR EL OBJETO REAL DE TabManager - NO CREAR COPIA
      const tabHtml = window.tabManager.tabTemplate(tabManagerTab, true, true); // showMenu=true, isTopBar=true
      
      const tabWrapper = document.createElement('div');
      tabWrapper.innerHTML = tabHtml;
      const tabEl = tabWrapper.firstElementChild;
      
      // Buscar el tab del backend correspondiente para los handlers
      // IMPORTANTE: Para tabs de Notion, usar originalUrl si está disponible para la comparación
      const tabUrlForComparison = (tabManagerTab.originalUrl || tabManagerTab.url || '').trim();
      const backendTab = this.spaceTabs.find(t => {
        const url = t.url || t.bookmark_url;
        if (!url) return false;
        return this.normalizeUrl(url) === this.normalizeUrl(tabUrlForComparison);
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
          }).catch(() => {
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
    // IMPORTANTE: Usar la misma lógica que renderTopBar para consistencia
    // 1. Buscar primero por backendId (más confiable, no depende de URLs)
    // 2. Si no tiene backendId, buscar por URL normalizada
    let existingTab = null;
    
    // Si el tab del backend tiene un ID, buscar por backendId primero
    if (tab.id) {
      existingTab = tabManagerTabs.find(t => t.backendId === tab.id);
    }
    
    // Si no se encontró por backendId, buscar por URL (fallback)
    if (!existingTab) {
      existingTab = tabManagerTabs.find(t => {
        // Excluir tabs con /new o tabs://new (estos son tabs "nuevos" no inicializados)
        const tUrl = (t.originalUrl || t.url || '').trim();
        if (!tUrl || tUrl === '/new' || tUrl === 'tabs://new') return false;
        // Comparar URLs normalizadas
        return this.normalizeUrl(tUrl) === normalizedUrl;
      });
    }

    if (existingTab) {
      // Tab ya existe - solo activarlo (es el MISMO tab)
      // IMPORTANTE: Actualizar backendId y spaceId si no los tiene (para evitar duplicados futuros)
      if (!existingTab.backendId && tab.id) {
        existingTab.backendId = tab.id;
      }
      if (!existingTab.spaceId && tab.space_id) {
        existingTab.spaceId = tab.space_id;
      }
      
      // Usar activate() que maneja correctamente la activación sin ocultar otros tabs innecesariamente
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
      
      // Llamar a renderTopBar para actualizar la selección visual
      // Usar un pequeño delay para asegurar que activate() termine de actualizar el estado
      // y evitar condiciones de carrera con el interceptor
      setTimeout(() => {
        this.renderTopBar();
      }, 100);
      return;
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
      
      // Usar activate() en lugar de establecer active directamente
      // Esto asegura que el interceptor se ejecute y maneje renderTopBar()
      window.tabManager.tabs.forEach(t => t.active = false);
      window.tabManager.tabs.push(newTab);
      window.tabManager.activate(newTab.id);
      
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
      
      // Llamar a renderTopBar para actualizar la selección visual
      // Usar un pequeño delay para asegurar que activate() termine de actualizar el estado
      // y evitar condiciones de carrera con el interceptor
      setTimeout(() => {
        this.renderTopBar();
      }, 100);
    }
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
    menu.className = 'tab-menu-dropdown absolute bg-white border border-[#e8eaed] rounded-lg shadow-lg py-1 min-w-[160px]';
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.zIndex = '10001'; // High z-index to appear on top

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
        <div class="tab-container-submenu hidden absolute left-full top-0 ml-1 bg-white border border-[#e8eaed] rounded-lg shadow-lg py-1 min-w-[140px]" style="z-index: 10002;">
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

  // Show 3-dots menu for projects
  showProjectMenu(e, project) {
    // Close any existing menu
    const existingMenu = document.querySelector('.project-menu-dropdown');
    if (existingMenu) {
      existingMenu.remove();
      // Remove existing listener
      if (this.projectMenuCloseListener) {
        document.removeEventListener('click', this.projectMenuCloseListener);
        document.removeEventListener('mousedown', this.projectMenuCloseListener);
        window.removeEventListener('blur', this.projectMenuCloseListener);
      }
    }

    const button = e.target.closest('.project-menu-btn');
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'project-menu-dropdown absolute bg-white border border-[#e8eaed] rounded-lg shadow-lg py-1';
    menu.style.left = `${rect.right - 180}px`; // Align to the right of button
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.zIndex = '10001'; // High z-index to appear on top
    menu.style.minWidth = '180px';

    const isArchived = project.archived === true;
    const currentTags = project.tags || [];

    // Create toggle switch with inline styles
    const toggleId = `project-toggle-${project.id}`;
    menu.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; font-size: 14px; color: #202124; cursor: pointer;" onmouseover="this.style.backgroundColor='#f5f7fa'" onmouseout="this.style.backgroundColor='transparent'">
        <div style="display: flex; align-items: center; gap: 8px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 3l18 18"></path>
            <path d="M19 5l-2 2"></path>
            <path d="M5 19l-2-2"></path>
            <path d="M3 12a9 9 0 0 1 9-9"></path>
            <path d="M21 12a9 9 0 0 1-9 9"></path></svg>
          <span>Archivado</span>
        </div>
        <label style="position: relative; display: inline-flex; align-items: center; cursor: pointer;" for="${toggleId}">
          <input type="checkbox" id="${toggleId}" style="position: absolute; opacity: 0; width: 0; height: 0;" ${isArchived ? 'checked' : ''} data-project-id="${project.id}">
          <div style="width: 44px; height: 24px; background-color: ${isArchived ? '#4285f4' : '#d1d5db'}; border-radius: 12px; position: relative; transition: background-color 0.2s;">
            <div style="position: absolute; top: 2px; left: ${isArchived ? '22px' : '2px'}; width: 20px; height: 20px; background-color: white; border-radius: 50%; transition: left 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>
          </div>
        </label>
      </div>
      <div class="tags-menu-item" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 14px; color: #202124; cursor: pointer; border-top: 1px solid #e8eaed;" onmouseover="this.style.backgroundColor='#f5f7fa'" onmouseout="this.style.backgroundColor='transparent'" data-project-id="${project.id}">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
          <line x1="7" y1="7" x2="7.01" y2="7"></line>
        </svg>
        <span>Tags</span>
      </div>
    `;

    document.body.appendChild(menu);

    // Event handler for toggle
    const toggle = menu.querySelector('input[type="checkbox"]');
    const toggleSwitch = menu.querySelector('label > div');
    const toggleCircle = toggleSwitch ? toggleSwitch.querySelector('div') : null;
    
    if (toggle && toggleSwitch && toggleCircle) {
      toggle.onchange = async (e) => {
        e.stopPropagation();
        const projectId = toggle.getAttribute('data-project-id');
        const wasArchived = toggle.checked;
        
        // Update toggle visual state immediately
        toggleSwitch.style.backgroundColor = wasArchived ? '#4285f4' : '#d1d5db';
        toggleCircle.style.left = wasArchived ? '22px' : '2px';
        
        await this.archiveProject(projectId);
        // Close menu after toggle
        menu.remove();
        if (this.projectMenuCloseListener) {
          document.removeEventListener('click', this.projectMenuCloseListener, true);
          document.removeEventListener('mousedown', this.projectMenuCloseListener, true);
          window.removeEventListener('blur', this.projectMenuCloseListener);
          this.projectMenuCloseListener = null;
        }
      };
    }
    
    // Prevent menu from closing when clicking on toggle area
    const toggleContainer = menu.querySelector('div[style*="display: flex"]');
    if (toggleContainer) {
      toggleContainer.onclick = (e) => {
        e.stopPropagation();
        // Let the label handle the click naturally
      };
    }
    
    // Handle Tags menu item click - open submenu without closing main menu
    const tagsMenuItem = menu.querySelector('.tags-menu-item');
    if (tagsMenuItem) {
      // Add arrow indicator
      const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      arrowSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      arrowSvg.setAttribute('width', '12');
      arrowSvg.setAttribute('height', '12');
      arrowSvg.setAttribute('viewBox', '0 0 24 24');
      arrowSvg.setAttribute('fill', 'none');
      arrowSvg.setAttribute('stroke', 'currentColor');
      arrowSvg.setAttribute('stroke-width', '2');
      arrowSvg.setAttribute('stroke-linecap', 'round');
      arrowSvg.setAttribute('stroke-linejoin', 'round');
      arrowSvg.style.color = '#6b7280';
      arrowSvg.innerHTML = '<polyline points="9 18 15 12 9 6"></polyline>';
      tagsMenuItem.appendChild(arrowSvg);
      
      tagsMenuItem.onclick = (e) => {
        e.stopPropagation();
        // Don't close the main menu, just open the submenu
        this.showEditTagsDialog(project, menu);
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
        menu.remove();
        document.removeEventListener('click', closeMenu, true);
        document.removeEventListener('mousedown', closeMenu, true);
        window.removeEventListener('blur', closeMenu);
        if (this.projectMenuCloseListener) {
          this.projectMenuCloseListener = null;
        }
      }
    };
    
    // Guardar referencia para poder removerla después
    this.projectMenuCloseListener = closeMenu;
    
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

  // Show Edit Tags Dialog - Menu style with checkboxes (submenu)
  showEditTagsDialog(project, parentMenu = null) {
    // Remove existing submenu if any
    const existingMenu = document.querySelector('.tags-menu-dropdown');
    if (existingMenu) {
      existingMenu.remove();
    }

    // Get all available tags from all projects
    const allTagsSet = new Set();
    this.allProjects.forEach(p => {
      if (p.tags && Array.isArray(p.tags)) {
        p.tags.forEach(tag => allTagsSet.add(tag));
      }
    });
    const allTags = Array.from(allTagsSet).sort();

    const currentTags = project.tags || [];
    const currentTagsSet = new Set(currentTags);

    // Create submenu similar to Gmail labels menu
    const submenu = document.createElement('div');
    submenu.className = 'tags-menu-dropdown absolute bg-white border border-[#e8eaed] rounded-lg shadow-lg py-1';
    submenu.style.zIndex = '10002'; // Higher than parent menu
    submenu.style.minWidth = '200px';
    submenu.style.maxHeight = '400px';
    submenu.style.overflowY = 'auto';

    // Build menu items
    let menuHTML = '';
    
    // Existing tags with checkboxes
    allTags.forEach(tag => {
      const isChecked = currentTagsSet.has(tag);
      menuHTML += `
        <div class="tag-menu-item flex items-center gap-2 px-4 py-2 hover:bg-[#f5f7fa] cursor-pointer" data-tag="${this.escapeHTML(tag)}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-500">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
            <line x1="7" y1="7" x2="7.01" y2="7"></line>
          </svg>
          <span class="flex-1 text-sm text-[#202124]">${this.escapeHTML(tag)}</span>
          ${isChecked ? `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4285f4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          ` : ''}
        </div>
      `;
    });

    // Add "New Tag" option
    menuHTML += `
      <div class="border-t border-[#e8eaed] mt-1"></div>
      <div class="tag-menu-item flex items-center gap-2 px-4 py-2 hover:bg-[#f5f7fa] cursor-pointer" id="new-tag-item">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-500">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span class="flex-1 text-sm text-[#202124]">+ New Tag</span>
      </div>
    `;

    submenu.innerHTML = menuHTML;

    // Position submenu to the right of the parent menu
    if (parentMenu) {
      const rect = parentMenu.getBoundingClientRect();
      submenu.style.position = 'fixed';
      submenu.style.left = `${rect.right + 4}px`;
      // Align top with the Tags menu item (approximately)
      submenu.style.top = `${rect.top + 40}px`; // Adjust based on menu item height
    } else {
      // Fallback: try to find project menu
      const projectMenu = document.querySelector('.project-menu-dropdown');
      if (projectMenu) {
        const rect = projectMenu.getBoundingClientRect();
        submenu.style.position = 'fixed';
        submenu.style.left = `${rect.right + 4}px`;
        submenu.style.top = `${rect.top + 40}px`;
      } else {
        // Last resort: center it
        submenu.style.position = 'fixed';
        submenu.style.left = '50%';
        submenu.style.top = '50%';
        submenu.style.transform = 'translate(-50%, -50%)';
      }
    }

    document.body.appendChild(submenu);

    // Handle tag item clicks
    submenu.querySelectorAll('.tag-menu-item[data-tag]').forEach(item => {
      item.onclick = async (e) => {
        e.stopPropagation();
        const tag = item.getAttribute('data-tag');
        const isCurrentlyChecked = currentTagsSet.has(tag);
        
        let newTags;
        if (isCurrentlyChecked) {
          // Remove tag
          newTags = currentTags.filter(t => t !== tag);
        } else {
          // Add tag
          newTags = [...currentTags, tag];
        }

        // Update immediately
        await this.updateProjectTags(project.id, newTags);
        
        // Close submenu but keep parent menu open
        submenu.remove();
      };
    });

    // Handle "New Tag" click
    const newTagItem = submenu.querySelector('#new-tag-item');
    if (newTagItem) {
      newTagItem.onclick = async (e) => {
        e.stopPropagation();
        const tagName = prompt('Enter new tag name:');
        if (tagName && tagName.trim()) {
          const trimmedTag = tagName.trim();
          const newTags = [...currentTags, trimmedTag];
          await this.updateProjectTags(project.id, newTags);
        }
        submenu.remove();
      };
    }

    // Close submenu when clicking outside (but not on parent menu)
    const closeSubmenu = (event) => {
      const clickedOnParentMenu = parentMenu && parentMenu.contains(event.target);
      const clickedOnSubmenu = submenu.contains(event.target);
      const clickedOnTagsMenuItem = event.target.closest('.tags-menu-item');
      
      if (!clickedOnSubmenu && !clickedOnParentMenu && !clickedOnTagsMenuItem) {
        submenu.remove();
        document.removeEventListener('click', closeSubmenu, true);
        document.removeEventListener('mousedown', closeSubmenu, true);
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeSubmenu, true);
      document.addEventListener('mousedown', closeSubmenu, true);
    }, 0);
  }

  // Get the parent_id for a project in a specific tag context
  // parent_id is now an array, so we need to find which parent has the matching tag
  getParentIdForTag(project, tagName) {
    const parentIds = project.parent_id || [];
    const parentIdsArray = Array.isArray(parentIds) ? parentIds : (parentIds ? [parentIds] : []);
    
    // Find the parent that has this tag
    for (const parentId of parentIdsArray) {
      const parent = this.projects.find(p => p.id === parentId);
      if (parent) {
        const parentTags = parent.tags || [];
        let parentTagsArray = parentTags;
        if (typeof parentTags === 'string') {
          try {
            parentTagsArray = JSON.parse(parentTags);
          } catch (e) {
            parentTagsArray = [];
          }
        }
        if (!Array.isArray(parentTagsArray)) parentTagsArray = [];
        
        // If parent has this tag, return this parent
        if (parentTagsArray.includes(tagName)) {
          return parentId;
        }
      }
    }
    
    return null;
  }

  // Get the current tag context from the DOM (which tag group we're in)
  getCurrentTagContext(element) {
    // Find the closest tag group header
    let current = element;
    while (current && current !== document.body) {
      const tagHeader = current.querySelector ? current.querySelector('.tag-group-header') : null;
      if (tagHeader) {
        return tagHeader.getAttribute('data-tag-name');
      }
      if (current.classList && current.classList.contains('tag-group-header')) {
        return current.getAttribute('data-tag-name');
      }
      current = current.parentElement;
    }
    return null;
  }

  // Render "No Tag" group
  renderNoTagGroup(projectsWithoutTags, container, buildTreeFn) {
    // Get collapse state from localStorage
    const noTagCollapseKey = 'tag_collapsed_No Tag';
    const isNoTagCollapsed = localStorage.getItem(noTagCollapseKey) === 'true';
    
    // Create "No Tag" group header (draggable)
    const noTagHeader = document.createElement('div');
    noTagHeader.className = 'flex items-center gap-1 pl-0 pr-2 py-1 text-xs text-gray-500 font-medium cursor-pointer hover:text-gray-700 transition-colors group tag-group-header';
    noTagHeader.style.marginTop = '4px';
    noTagHeader.draggable = true;
    noTagHeader.setAttribute('data-tag-name', 'No Tag');
    
    // Chevron for expand/collapse
    const chevron = document.createElement('span');
    chevron.className = 'transition-transform';
    chevron.style.transform = isNoTagCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    chevron.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    
    const tagLabel = document.createElement('span');
    tagLabel.className = 'flex-1';
    tagLabel.textContent = 'No Tag';
    
    noTagHeader.appendChild(chevron);
    noTagHeader.appendChild(tagLabel);
    
    // Toggle collapse on click (but not when dragging)
    noTagHeader.addEventListener('click', (e) => {
      if (e.target.closest('.tag-group-header') && !noTagHeader.dragging) {
        e.stopPropagation();
        const newState = !isNoTagCollapsed;
        localStorage.setItem(noTagCollapseKey, newState.toString());
        this.renderProjects(); // Re-render to update
      }
    });
    
    // Drag and drop handlers for "No Tag" group
    noTagHeader.addEventListener('dragstart', (e) => {
      noTagHeader.dragging = true;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'No Tag');
      noTagHeader.style.opacity = '0.5';
    });
    
    noTagHeader.addEventListener('dragend', (e) => {
      noTagHeader.dragging = false;
      noTagHeader.style.opacity = '1';
      document.querySelectorAll('.tag-drop-indicator').forEach(el => el.remove());
    });
    
    noTagHeader.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      document.querySelectorAll('.tag-drop-indicator').forEach(el => el.remove());
      
      const targetHeader = e.target.closest('.tag-group-header');
      if (targetHeader && targetHeader !== noTagHeader) {
        const rect = targetHeader.getBoundingClientRect();
        const indicator = document.createElement('div');
        indicator.className = 'tag-drop-indicator';
        indicator.style.position = 'fixed';
        indicator.style.left = `${rect.left}px`;
        indicator.style.top = `${rect.top - 2}px`;
        indicator.style.width = `${rect.width}px`;
        indicator.style.height = '2px';
        indicator.style.backgroundColor = '#4285f4';
        indicator.style.zIndex = '10000';
        indicator.style.pointerEvents = 'none';
        document.body.appendChild(indicator);
      }
    });
    
    noTagHeader.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedTagName = e.dataTransfer.getData('text/plain');
      
      if (draggedTagName && draggedTagName !== 'No Tag') {
        const currentOrder = JSON.parse(localStorage.getItem('tag_order') || '[]');
        const filteredOrder = currentOrder.filter(t => t !== draggedTagName);
        const targetIndex = filteredOrder.indexOf('No Tag');
        
        if (targetIndex !== -1) {
          filteredOrder.splice(targetIndex, 0, draggedTagName);
        } else {
          filteredOrder.push('No Tag');
          filteredOrder.push(draggedTagName);
        }
        
        localStorage.setItem('tag_order', JSON.stringify(filteredOrder));
        this.renderProjects();
      }
      
      document.querySelectorAll('.tag-drop-indicator').forEach(el => el.remove());
    });
    
    noTagHeader.addEventListener('dragleave', (e) => {
      if (!e.target.closest('.tag-group-header')) {
        document.querySelectorAll('.tag-drop-indicator').forEach(el => el.remove());
      }
    });
    
    container.appendChild(noTagHeader);
    
    // Render projects without tags (only if not collapsed)
    if (!isNoTagCollapsed && buildTreeFn) {
      // For "No Tag" group, use first parent from array (or null if empty)
      const modifiedNoTagProjects = projectsWithoutTags.map(project => {
        const projectCopy = { ...project };
        const parentIds = project.parent_id || [];
        const parentIdsArray = Array.isArray(parentIds) ? parentIds : (parentIds ? [parentIds] : []);
        // Use first parent for "No Tag" group (or null if no parents)
        projectCopy.parent_id = parentIdsArray.length > 0 ? parentIdsArray[0] : null;
        return projectCopy;
      });
      
      const noTagsHierarchicalProjects = buildTreeFn(modifiedNoTagProjects);
      
      noTagsHierarchicalProjects.forEach(item => {
        if (item.isSeparator) {
          this.renderSeparator(item, container);
          return;
        }
        
        this.renderProjectItem(item, container, modifiedNoTagProjects);
      });
    }
  }

  // Show tag menu (for deleting tag)
  showTagMenu(e, tagName) {
    // Close any existing menu
    const existingMenu = document.querySelector('.tag-group-menu-dropdown');
    if (existingMenu) {
      existingMenu.remove();
    }

    const button = e.target.closest('.tag-menu-btn');
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'tag-group-menu-dropdown absolute bg-white border border-[#e8eaed] rounded-lg shadow-lg py-1';
    menu.style.position = 'fixed';
    menu.style.left = `${rect.right - 150}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.zIndex = '10001';
    menu.style.minWidth = '150px';

    menu.innerHTML = `
      <div class="tag-delete-item flex items-center gap-2 px-4 py-2 hover:bg-red-50 cursor-pointer text-red-600" data-tag-name="${this.escapeHTML(tagName)}">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span class="text-sm">Delete Tag</span>
      </div>
    `;

    document.body.appendChild(menu);

    // Handle delete click
    const deleteItem = menu.querySelector('.tag-delete-item');
    if (deleteItem) {
      deleteItem.onclick = async (e) => {
        e.stopPropagation();
        const tagToDelete = deleteItem.getAttribute('data-tag-name');
        
        if (confirm(`Are you sure you want to delete the tag "${tagToDelete}"? This will remove it from all projects.`)) {
          await this.deleteTagFromAllProjects(tagToDelete);
          menu.remove();
          // Re-render to update the sidebar
          this.renderProjects();
        }
      };
    }

    // Close menu when clicking outside
    const closeMenu = (event) => {
      if (!menu.contains(event.target) && !event.target.closest('.tag-menu-btn')) {
        menu.remove();
        document.removeEventListener('click', closeMenu, true);
        document.removeEventListener('mousedown', closeMenu, true);
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeMenu, true);
      document.addEventListener('mousedown', closeMenu, true);
    }, 0);
  }

  // Delete tag from all projects
  async deleteTagFromAllProjects(tagName) {
    try {
      // Get all projects that have this tag
      const projectsWithTag = this.allProjects.filter(p => {
        const tags = p.tags || [];
        return Array.isArray(tags) && tags.includes(tagName);
      });

      console.log(`🗑️  Deleting tag "${tagName}" from ${projectsWithTag.length} project(s)`);

      // Update each project to remove the tag
      for (const project of projectsWithTag) {
        const currentTags = project.tags || [];
        const newTags = currentTags.filter(t => t !== tagName);

        try {
          const response = await fetch(`/api/spaces/${project.id}/tags`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tags: newTags })
          });

          if (!response.ok) {
            throw new Error('Failed to update tags');
          }

          // Update local data
          const projectIndex = this.projects.findIndex(p => p.id === project.id);
          if (projectIndex !== -1) {
            this.projects[projectIndex].tags = newTags;
          }

          const allProjectIndex = this.allProjects.findIndex(p => p.id === project.id);
          if (allProjectIndex !== -1) {
            this.allProjects[allProjectIndex].tags = newTags;
          }
        } catch (error) {
          console.error(`Error removing tag from project ${project.name}:`, error);
        }
      }

      console.log(`✅ Tag "${tagName}" deleted from all projects`);
    } catch (error) {
      console.error('Error deleting tag:', error);
      alert('Failed to delete tag. Please try again.');
    }
  }

  // Helper function to update project tags
  async updateProjectTags(projectId, tags) {
    try {
      const response = await fetch(`/api/spaces/${projectId}/tags`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tags })
      });

      if (!response.ok) {
        throw new Error('Failed to update tags');
      }

      const { space } = await response.json();
      
      // Update project in local data
      const projectIndex = this.projects.findIndex(p => p.id === projectId);
      if (projectIndex !== -1) {
        this.projects[projectIndex].tags = tags;
      }
      
      const allProjectIndex = this.allProjects.findIndex(p => p.id === projectId);
      if (allProjectIndex !== -1) {
        this.allProjects[allProjectIndex].tags = tags;
      }

      // Re-render projects to show updated tags
      this.renderProjects();
    } catch (error) {
      console.error('Error updating tags:', error);
      alert('Failed to update tags. Please try again.');
    }
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
              } catch {
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
      } catch {
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
    // Close project settings if open
    this.closeProjectSettings();
    this.renderUsers();
    this.renderTopBar(); // Esto oculta el TopBar
    
    // Actualizar sidebar para mostrar solo tabs personales (el filtrado ya está en tabs.js)
    if (window.tabManager && window.tabManager.render) {
      window.tabManager.render();
    }
  }

  async openProjectSettings() {
    if (!this.activeSpace) return;
    
    const sidebar = document.getElementById('project-settings-sidebar');
    if (!sidebar) return;
    
    // Show sidebar
    sidebar.classList.remove('hidden');
    
    // Load members for this space
    await this.loadProjectMembers();
    
    // Initialize lucide icons if needed
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  closeProjectSettings() {
    const sidebar = document.getElementById('project-settings-sidebar');
    if (sidebar) {
      sidebar.classList.add('hidden');
    }
  }

  async loadProjectMembers() {
    if (!this.activeSpace || !this.activeSpace.id) return;
    
    try {
      const { members } = await this.request(`/api/chat/space/${this.activeSpace.id}/members`);
      const membersList = document.getElementById('members-list');
      const membersCount = document.getElementById('members-count');
      
      if (membersCount) {
        membersCount.textContent = members?.length || 0;
      }
      
      if (membersList) {
        membersList.innerHTML = '';
        
        if (members && members.length > 0) {
          members.forEach(member => {
            const memberEl = document.createElement('div');
            memberEl.className = 'member-item';
            memberEl.dataset.userId = member.user_id;
            
            const avatar = member.avatar_photo || member.avatar_url || '';
            const name = member.display_name || member.name || member.email || 'Unknown';
            
            memberEl.innerHTML = `
              <div class="member-avatar">
                ${avatar ? `<img src="${avatar}" alt="${name}" />` : `<div class="member-avatar-placeholder">${name.charAt(0).toUpperCase()}</div>`}
              </div>
              <span class="member-name">${name}</span>
              <input type="checkbox" class="member-checkbox" />
            `;
            
            membersList.appendChild(memberEl);
          });
        }
      }
      
      // Setup search functionality
      const searchInput = document.getElementById('members-search-input');
      if (searchInput) {
        searchInput.oninput = (e) => {
          const query = e.target.value.toLowerCase();
          const items = membersList.querySelectorAll('.member-item');
          items.forEach(item => {
            const name = item.querySelector('.member-name')?.textContent.toLowerCase() || '';
            item.style.display = name.includes(query) ? '' : 'none';
          });
        };
      }
      
      // Setup add/remove member buttons
      const addMemberBtn = document.getElementById('add-member-btn');
      const removeMemberBtn = document.getElementById('remove-member-btn');
      
      if (addMemberBtn) {
        addMemberBtn.onclick = () => this.showAddMembersModal();
      }
      
      if (removeMemberBtn) {
        removeMemberBtn.onclick = () => this.removeSelectedMembers();
        
        // Show/hide remove button based on checked members
        const checkboxes = membersList.querySelectorAll('.member-checkbox');
        checkboxes.forEach(checkbox => {
          checkbox.onchange = () => {
            const checked = membersList.querySelectorAll('.member-checkbox:checked').length;
            if (removeMemberBtn) {
              removeMemberBtn.style.display = checked > 0 ? 'flex' : 'none';
            }
          };
        });
      }
      
      // Setup delete project button (only show/enable if user is owner)
      const deleteBtn = document.getElementById('delete-project-btn');
      if (deleteBtn) {
        // Check if current user is the owner
        const isOwner = this.activeSpace && this.activeSpace.user_id === this.user?.id;
        
        if (isOwner) {
          deleteBtn.style.display = 'block';
          deleteBtn.disabled = false;
          deleteBtn.onclick = () => {
            if (confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
              this.deleteProject();
            }
          };
        } else {
          // User is not owner - hide or disable the button
          deleteBtn.style.display = 'none';
          deleteBtn.disabled = true;
        }
      }
    } catch (err) {
      console.error('Failed to load project members:', err);
    }
  }

  async showAddMembersModal() {
    const modal = document.getElementById('add-members-modal');
    if (!modal) return;
    
    modal.classList.remove('hidden');
    
    // Load all users (excluding current project members)
    try {
      const { users } = await this.request('/api/users');
      const { members } = await this.request(`/api/chat/space/${this.activeSpace.id}/members`);
      const memberUserIds = new Set(members?.map(m => m.user_id) || []);
      
      const availableUsers = users?.filter(u => 
        u.id !== this.user?.id && !memberUserIds.has(u.id)
      ) || [];
      
      const list = document.getElementById('add-members-list');
      if (list) {
        list.innerHTML = '';
        availableUsers.forEach(user => {
          const item = document.createElement('div');
          item.className = 'add-member-item';
          item.dataset.userId = user.id;
          
          const avatar = user.avatar_photo || user.avatar_url || '';
          const name = user.display_name || user.name || user.email || 'Unknown';
          
          item.innerHTML = `
            <div class="add-member-avatar">
              ${avatar ? `<img src="${avatar}" alt="${name}" />` : `<div class="add-member-avatar-placeholder">${name.charAt(0).toUpperCase()}</div>`}
            </div>
            <span class="add-member-name">${name}</span>
            <input type="checkbox" class="add-member-checkbox" />
          `;
          
          list.appendChild(item);
        });
      }
      
      // Setup search
      const searchInput = document.getElementById('add-members-search-input');
      if (searchInput) {
        searchInput.oninput = (e) => {
          const query = e.target.value.toLowerCase();
          const items = list.querySelectorAll('.add-member-item');
          items.forEach(item => {
            const name = item.querySelector('.add-member-name')?.textContent.toLowerCase() || '';
            item.style.display = name.includes(query) ? '' : 'none';
          });
        };
      }
      
      // Setup close button
      const closeBtn = document.getElementById('add-members-close');
      const cancelBtn = document.getElementById('add-members-cancel');
      
      if (closeBtn) {
        closeBtn.onclick = () => {
          modal.classList.add('hidden');
        };
      }
      
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          modal.classList.add('hidden');
        };
      }
      
      // Setup add button
      const addBtn = document.getElementById('add-members-submit');
      if (addBtn) {
        addBtn.onclick = async () => {
          const checked = list.querySelectorAll('.add-member-checkbox:checked');
          const userIds = Array.from(checked).map(cb => cb.closest('.add-member-item').dataset.userId);
          
          if (userIds.length > 0) {
            await this.addMembersToProject(userIds);
            modal.classList.add('hidden');
            await this.loadProjectMembers();
          }
        };
      }
    } catch (err) {
      console.error('Failed to load users for add members:', err);
    }
  }

  async addMembersToProject(userIds) {
    if (!this.activeSpace || !this.activeSpace.id) return;
    
    try {
      await this.request(`/api/chat/space/${this.activeSpace.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userIds: userIds })
      });
    } catch (err) {
      console.error('Failed to add members:', err);
      alert('Failed to add members');
    }
  }

  async removeSelectedMembers() {
    if (!this.activeSpace || !this.activeSpace.id) return;
    
    const membersList = document.getElementById('members-list');
    if (!membersList) return;
    
    const checked = membersList.querySelectorAll('.member-checkbox:checked');
    const userIds = Array.from(checked).map(cb => cb.closest('.member-item').dataset.userId);
    
    if (userIds.length === 0) return;
    
    if (!confirm(`Are you sure you want to remove ${userIds.length} member(s)?`)) return;
    
    try {
      await this.request(`/api/chat/space/${this.activeSpace.id}/members`, {
        method: 'DELETE',
        body: JSON.stringify({ userIds: userIds })
      });
      
      await this.loadProjectMembers();
    } catch (err) {
      console.error('Failed to remove members:', err);
      alert('Failed to remove members');
    }
  }

  async deleteProject() {
    if (!this.activeSpace || !this.activeSpace.id) return;
    
    // Verify user is the owner
    if (this.activeSpace.user_id !== this.user?.id) {
      alert('Only the project owner can delete the project');
      return;
    }
    
    try {
      await this.request(`/api/spaces/${this.activeSpace.id}`, {
        method: 'DELETE'
      });
      
      this.closeProjectSettings();
      this.clearActiveSpace();
      await this.loadProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
      const errorMessage = err.message || 'Failed to delete project';
      if (errorMessage.includes('owner')) {
        alert('Only the project owner can delete the project');
      } else {
        alert('Failed to delete project: ' + errorMessage);
      }
    }
  }

  // Helper function to render a single project item
  renderProjectItem(project, container, allProjectsForChildren) {
    const isActive = this.activeSpace?.id === project.id;
    const hasChildren = allProjectsForChildren.some(p => p.parent_id === project.id);
    const isGhost = project.isGhost === true || project.isReadOnly === true;
    
    const hasIcon = project.avatar_photo || project.avatar_emoji;
    let iconHtml = '';
    if (project.avatar_photo) {
      iconHtml = `<img src="${project.avatar_photo}" alt="" class="w-full h-full object-cover" />`;
    } else if (project.avatar_emoji) {
      iconHtml = `<span class="text-sm">${project.avatar_emoji}</span>`;
    } else {
      iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
    }
    
    const wrapperEl = document.createElement('div');
    wrapperEl.style.marginLeft = `${project.depth * 16}px`;
    wrapperEl.className = 'relative';
    wrapperEl.setAttribute('data-project-id', project.id);
    
    const isArchived = project.archived === true;
    const projectEl = document.createElement('div');
    const ghostStyles = isGhost 
      ? 'opacity-50 bg-gray-100 text-gray-500' 
      : '';
    const hoverStyles = isGhost 
      ? '' 
      : (isActive ? 'bg-[#4285f4]/10 text-[#4285f4] font-medium shadow-sm' : 'text-[#202124] hover:bg-[#e8eaed]');
    
    projectEl.className = `project-item group flex items-center gap-2 pl-0 pr-2 py-1.5 rounded-lg transition-all ${
      hoverStyles
    } ${isArchived ? 'opacity-60' : ''} ${ghostStyles}`;
    projectEl.style.cursor = isGhost ? 'default' : 'pointer';
    
    const chevronHtml = hasChildren 
      ? `<button class="p-0 hover:bg-gray-100 rounded transition-colors z-10 expand-btn" data-project-id="${project.id}">
          ${project.is_expanded !== false 
            ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>'
            : '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'
          }
        </button>`
      : '<div class="w-2.5"></div>';
    
    // If there's an icon, don't show the circle background
    const iconContainerClass = hasIcon 
      ? 'w-6 h-6 flex items-center justify-center flex-shrink-0'
      : 'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0';
    const iconContainerStyle = hasIcon 
      ? ''
      : `border: 1px solid ${project.avatar_color || '#e8eaed'}; color: ${project.avatar_color || '#6b7280'}`;
    
    projectEl.style.position = 'relative';
    projectEl.innerHTML = `
      ${chevronHtml}
      <div class="${iconContainerClass}" style="${iconContainerStyle}">
        ${iconHtml}
      </div>
      <span class="flex-1 text-xs truncate">${this.escapeHTML(project.name)}</span>
      ${!isGhost ? `<div class="space-unread-badge" data-space-id="${project.id}" style="display: none; position: absolute; top: 50%; transform: translateY(-50%); right: 8px; background-color: #ea4335; color: white; border-radius: 50%; width: 18px; height: 18px; min-width: 18px; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; z-index: 10; line-height: 1;"></div>
      <button class="project-menu-btn shrink-0 p-0.5 opacity-0 group-hover:opacity-100 hover:text-[#4285f4] transition-opacity relative" data-project-id="${project.id}" title="Menu" style="cursor: pointer; position: absolute; right: 8px; top: 50%; transform: translateY(-50%); z-index: 5;">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="1"></circle>
          <circle cx="12" cy="5" r="1"></circle>
          <circle cx="12" cy="19" r="1"></circle>
        </svg>
      </button>` : ''}
    `;
    
    if (!isGhost) {
      projectEl.addEventListener('click', (e) => {
        const expandBtn = e.target.closest('.expand-btn');
        if (expandBtn) {
          e.stopPropagation();
          const projectId = expandBtn.getAttribute('data-project-id');
          this.toggleProjectExpanded(projectId);
          return;
        }
        
        const menuBtn = e.target.closest('.project-menu-btn');
        if (menuBtn) {
          e.stopPropagation();
          const projectId = menuBtn.getAttribute('data-project-id');
          const project = this.allProjects.find(p => p.id === projectId) || this.projects.find(p => p.id === projectId);
          if (project) {
            this.showProjectMenu(e, project);
          }
          return;
        }
        
        if (!e.target.closest('.drop-indicator') && !e.target.closest('.project-menu-btn')) {
          document.querySelectorAll('.project-item').forEach(el => {
            el.classList.remove('bg-[#4285f4]/10', 'text-[#4285f4]', 'font-medium', 'shadow-sm');
            el.classList.add('hover:bg-[#e8eaed]');
          });
          document.querySelectorAll('.user-item').forEach(el => {
            el.classList.remove('bg-[#4285f4]/10', 'text-[#4285f4]', 'font-medium', 'shadow-sm');
            el.classList.add('hover:bg-[#e8eaed]');
          });
          
          projectEl.classList.add('bg-[#4285f4]/10', 'text-[#4285f4]', 'font-medium', 'shadow-sm');
          projectEl.classList.remove('hover:bg-[#f5f7fa]');
          
          this.selectProject(project.id);
        }
      });
    } else {
      projectEl.addEventListener('click', (e) => {
        const projectId = project.id;
        this.toggleProjectExpanded(projectId);
        e.stopPropagation();
      });
    }
    
    wrapperEl.appendChild(projectEl);
    container.appendChild(wrapperEl);
  }

  // Helper function to render separator
  renderSeparator(item, container) {
    const parentId = item.parentId !== undefined ? item.parentId : null;
    const showArchived = this.showArchivedForParent.get(parentId) || false;
    
    const separatorWrapper = document.createElement('div');
    separatorWrapper.className = 'flex items-center justify-center my-1 cursor-pointer group';
    separatorWrapper.style.marginLeft = `${item.depth * 16}px`;
    separatorWrapper.title = showArchived ? 'Click to hide archived projects' : 'Click to show archived projects';
    separatorWrapper.setAttribute('data-parent-id', parentId || 'root');
    
    const iconContainer = document.createElement('div');
    iconContainer.className = 'flex items-center justify-center text-gray-400 group-hover:text-gray-500 transition-all';
    iconContainer.style.flexShrink = '0';
    iconContainer.style.transform = showArchived ? 'rotate(180deg)' : 'rotate(0deg)';
    iconContainer.style.transition = 'transform 0.2s ease';
    iconContainer.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    
    separatorWrapper.appendChild(iconContainer);
    
    separatorWrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentState = this.showArchivedForParent.get(parentId) || false;
      this.showArchivedForParent.set(parentId, !currentState);
      this.renderProjects();
    });
    
    container.appendChild(separatorWrapper);
  }

  renderProjects() {
    try {
      const container = document.getElementById('projects-cont');
      if (!container) {
        console.warn('[FRONTEND] renderProjects: Container not found');
        return;
      }
      
      // Ensure container has position relative for drop indicators
      if (window.getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }
    
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
      console.warn('[FRONTEND] renderProjects: No projects to render. this.projects.length =', this.projects.length);
      container.innerHTML = '<div class="text-xs text-gray-400 px-2 py-1">No projects found</div>';
      return;
    }
    
    console.log('[FRONTEND] renderProjects: Starting render with', this.projects.length, 'projects');

    // Build hierarchy tree - organized: active first, then archived (with separator, collapsed by default)
    const buildTree = (projectsToUse) => {
      // Separate roots: active first, then archived
      // parent_id is now a JSONB array, so check if it's empty or null
      const allRoots = projectsToUse.filter(p => {
        const parentId = p.parent_id;
        if (!parentId) return true;
        // If it's an array, check if it's empty
        if (Array.isArray(parentId)) return parentId.length === 0;
        // Old format: single value means it has a parent
        return false;
      });
      console.log(`[FRONTEND] Building tree: ${this.projects.length} total projects, ${allRoots.length} roots`);
      allRoots.forEach(r => {
        console.log(`[FRONTEND] Root: ${r.name} (id: ${r.id}, isGhost: ${r.isGhost || false})`);
      });
      const activeRoots = allRoots.filter(p => !p.archived);
      const archivedRoots = allRoots.filter(p => p.archived === true);
      
      // Sort each group by position
      activeRoots.sort((a, b) => (a.position || 0) - (b.position || 0));
      archivedRoots.sort((a, b) => (a.position || 0) - (b.position || 0));
      
      const allChildren = projectsToUse.filter(p => {
        const parentId = p.parent_id;
        if (!parentId) return false;
        // parent_id is now a JSONB array, so check if it's non-empty
        if (Array.isArray(parentId)) return parentId.length > 0;
        return true; // old format (single value)
      });
      
      const tree = [];
      
      const addChildren = (parent, depth = 0) => {
        const isArchived = parent.archived === true;
        const parentId = parent.parent_id || null; // null for root level
        
        // Only add archived projects if they are expanded for this specific parent
        const showArchived = this.showArchivedForParent.get(parentId) || false;
        if (isArchived && !showArchived) {
          return; // Skip archived projects if collapsed for this parent
        }
        
        // Add the project itself
        tree.push({ ...parent, depth });
        
        // Use is_expanded exactly like luna-chat (defaults to true if undefined)
        if (parent.is_expanded !== false) {
          // Get children for this parent
          // parent_id is now a JSONB array, so check if parent.id is included in the array
          const parentChildren = allChildren.filter(c => {
            const cParentId = c.parent_id;
            if (!cParentId) return false;
            // Handle both array format (new) and single value format (old)
            const cParentIdArray = Array.isArray(cParentId) ? cParentId : (cParentId ? [cParentId] : []);
            return cParentIdArray.includes(parent.id) && projectsToUse.includes(c);
          });
          
          // Separate: active first, then archived
          const activeKids = parentChildren.filter(c => !c.archived);
          const archivedKids = parentChildren.filter(c => c.archived === true);
          
          // Sort each group by position
          activeKids.sort((a, b) => (a.position || 0) - (b.position || 0));
          archivedKids.sort((a, b) => (a.position || 0) - (b.position || 0));
          
          // Add active children first
          activeKids.forEach(kid => addChildren(kid, depth + 1));
          
          // Add separator before archived children (show separator if there are archived kids)
          // This is the ONLY place where separators are added for children
          if (archivedKids.length > 0) {
            tree.push({ isSeparator: true, depth: depth + 1, parentId: parent.id });
          }
          
          // Add archived children (only if expanded for this specific parent)
          const showArchivedForThisParent = this.showArchivedForParent.get(parent.id) || false;
          if (showArchivedForThisParent) {
            archivedKids.forEach(kid => addChildren(kid, depth + 1));
          }
        }
      };
      
      // Add active roots first
      activeRoots.forEach(root => addChildren(root));
      
      // Add separator before archived roots (show separator if there are archived roots, even if no active roots)
      if (archivedRoots.length > 0) {
        tree.push({ isSeparator: true, depth: 0, parentId: null }); // null = root level
      }
      
      // Add archived roots (only if expanded for root level)
      const showArchivedRoots = this.showArchivedForParent.get(null) || false;
      if (showArchivedRoots) {
        archivedRoots.forEach(root => addChildren(root));
      }
      
      return tree;
    };

    // Group projects by tags
    const projectsByTag = new Map();
    const projectsWithoutTags = [];
    
    // First, collect all projects with their tags
    this.projects.forEach(project => {
      // Handle tags - can be array, JSON string, or null/undefined
      let tags = project.tags || [];
      
      // If tags is a string, try to parse it
      if (typeof tags === 'string') {
        try {
          tags = JSON.parse(tags);
        } catch (e) {
          console.warn('Failed to parse tags as JSON:', tags);
          tags = [];
        }
      }
      
      // Ensure tags is an array
      if (!Array.isArray(tags)) {
        tags = [];
      }
      
      console.log(`[TAGS] Project "${project.name}": tags =`, tags);
      
      if (tags.length > 0) {
        // Project has tags - add it to each tag group
        tags.forEach(tag => {
          if (!projectsByTag.has(tag)) {
            projectsByTag.set(tag, []);
          }
          projectsByTag.get(tag).push(project);
        });
      } else {
        // Project has no tags
        projectsWithoutTags.push(project);
      }
    });
    
    console.log(`[TAGS] Projects with tags: ${projectsByTag.size} tag groups, Projects without tags: ${projectsWithoutTags.length}`);
    
    // Get saved tag order from localStorage
    const savedTagOrder = JSON.parse(localStorage.getItem('tag_order') || '[]');
    
    // Get all tags
    const allTags = Array.from(projectsByTag.keys());
    
    // Sort tags: first by saved order, then alphabetically for new tags
    const sortedTags = allTags.sort((a, b) => {
      const indexA = savedTagOrder.indexOf(a);
      const indexB = savedTagOrder.indexOf(b);
      
      // If both are in saved order, use that order
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      // If only A is in saved order, A comes first
      if (indexA !== -1) return -1;
      // If only B is in saved order, B comes first
      if (indexB !== -1) return 1;
      // If neither is in saved order, sort alphabetically
      return a.localeCompare(b);
    });
    
    console.log('[FRONTEND] renderProjects: About to render. projectsByTag.size =', projectsByTag.size, ', projectsWithoutTags.length =', projectsWithoutTags.length, ', sortedTags.length =', sortedTags.length);
    
    container.innerHTML = '';
    
    // Determine where "No Tag" should appear based on saved order
    const noTagIndex = savedTagOrder.indexOf('No Tag');
    const shouldShowNoTag = projectsWithoutTags.length > 0;
    
    // Render each tag group
    sortedTags.forEach((tagName, tagIndex) => {
      const tagProjects = projectsByTag.get(tagName);
      
      // Check if we should render "No Tag" before this tag (based on saved order)
      if (shouldShowNoTag && noTagIndex !== -1 && noTagIndex <= tagIndex && !container.querySelector('[data-tag-name="No Tag"]')) {
        this.renderNoTagGroup(projectsWithoutTags, container, buildTree);
      }
      
      // Get collapse state from localStorage
      const collapseKey = `tag_collapsed_${tagName}`;
      const isCollapsed = localStorage.getItem(collapseKey) === 'true';
      
      // Create tag group header (draggable)
      const tagHeader = document.createElement('div');
      tagHeader.className = 'flex items-center gap-1 pl-0 pr-2 py-1 text-xs text-gray-500 font-medium cursor-pointer hover:text-gray-700 transition-colors group tag-group-header';
      tagHeader.style.marginTop = '4px';
      tagHeader.draggable = true;
      tagHeader.setAttribute('data-tag-name', tagName);
      tagHeader.setAttribute('data-tag-index', tagIndex);
      
      // Chevron for expand/collapse
      const chevron = document.createElement('span');
      chevron.className = 'transition-transform';
      chevron.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
      chevron.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      `;
      
      const tagLabel = document.createElement('span');
      tagLabel.className = 'flex-1';
      tagLabel.textContent = tagName;
      
      // Menu button (three dots) - only visible on hover
      const menuBtn = document.createElement('button');
      menuBtn.className = 'tag-menu-btn opacity-0 group-hover:opacity-100 hover:text-[#4285f4] transition-opacity p-0.5';
      menuBtn.style.cursor = 'pointer';
      menuBtn.setAttribute('data-tag-name', tagName);
      menuBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="1"></circle>
          <circle cx="12" cy="5" r="1"></circle>
          <circle cx="12" cy="19" r="1"></circle>
        </svg>
      `;
      
      tagHeader.appendChild(chevron);
      tagHeader.appendChild(tagLabel);
      tagHeader.appendChild(menuBtn);
      
      // Track if we're dragging to prevent click
      let isDraggingTag = false;
      let dragStartY = 0;
      
      // Handle menu button click
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showTagMenu(e, tagName);
      });
      
      // Toggle collapse on chevron click only
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        const newState = !isCollapsed;
        localStorage.setItem(collapseKey, newState.toString());
        this.renderProjects();
      });
      
      // Drag and drop handlers for tag groups
      tagHeader.addEventListener('mousedown', (e) => {
        // Don't start drag on menu button or chevron
        if (e.target.closest('.tag-menu-btn') || e.target.closest('svg')) {
          return;
        }
        dragStartY = e.clientY;
        isDraggingTag = false;
      });
      
      tagHeader.addEventListener('mousemove', (e) => {
        if (dragStartY === 0) return;
        const distance = Math.abs(e.clientY - dragStartY);
        if (distance > 5) {
          isDraggingTag = true;
        }
      });
      
      tagHeader.addEventListener('mouseup', (e) => {
        if (!isDraggingTag && dragStartY !== 0) {
          // It was a click, not a drag - toggle collapse
          if (!e.target.closest('.tag-menu-btn') && !e.target.closest('svg')) {
            const newState = !isCollapsed;
            localStorage.setItem(collapseKey, newState.toString());
            this.renderProjects();
          }
        }
        dragStartY = 0;
        isDraggingTag = false;
      });
      
      tagHeader.addEventListener('dragstart', (e) => {
        // Don't drag if clicking on menu button or chevron
        if (e.target.closest('.tag-menu-btn') || e.target.closest('svg')) {
          e.preventDefault();
          return false;
        }
        
        tagHeader.dragging = true;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tagName);
        tagHeader.style.opacity = '0.5';
      });
      
      tagHeader.addEventListener('dragend', (e) => {
        tagHeader.dragging = false;
        tagHeader.style.opacity = '1';
        // Remove all drop indicators
        document.querySelectorAll('.tag-drop-indicator').forEach(el => el.remove());
      });
      
      tagHeader.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        
        // Remove existing indicators
        document.querySelectorAll('.tag-drop-indicator').forEach(el => el.remove());
        
        // Find the target tag header
        const targetHeader = e.target.closest('.tag-group-header');
        if (targetHeader && targetHeader !== tagHeader) {
          const rect = targetHeader.getBoundingClientRect();
          const indicator = document.createElement('div');
          indicator.className = 'tag-drop-indicator';
          indicator.style.position = 'fixed';
          indicator.style.left = `${rect.left}px`;
          indicator.style.top = `${rect.top - 2}px`;
          indicator.style.width = `${rect.width}px`;
          indicator.style.height = '2px';
          indicator.style.backgroundColor = '#4285f4';
          indicator.style.zIndex = '10000';
          indicator.style.pointerEvents = 'none';
          document.body.appendChild(indicator);
        }
      });
      
      tagHeader.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedTagName = e.dataTransfer.getData('text/plain');
        
        if (draggedTagName && draggedTagName !== tagName) {
          // Get current order
          const currentOrder = JSON.parse(localStorage.getItem('tag_order') || '[]');
          
          // Remove dragged tag from order
          const filteredOrder = currentOrder.filter(t => t !== draggedTagName);
          
          // Find index of target tag
          const targetIndex = filteredOrder.indexOf(tagName);
          
          // Insert dragged tag at target position
          if (targetIndex !== -1) {
            filteredOrder.splice(targetIndex, 0, draggedTagName);
          } else {
            // If target not in order, add both
            filteredOrder.push(tagName);
            filteredOrder.push(draggedTagName);
          }
          
          // Save new order
          localStorage.setItem('tag_order', JSON.stringify(filteredOrder));
          
          // Re-render to apply new order
          this.renderProjects();
        }
        
        // Remove indicators
        document.querySelectorAll('.tag-drop-indicator').forEach(el => el.remove());
      });
      
      tagHeader.addEventListener('dragleave', (e) => {
        // Remove indicators when leaving
        if (!e.target.closest('.tag-group-header')) {
          document.querySelectorAll('.tag-drop-indicator').forEach(el => el.remove());
        }
      });
      
      container.appendChild(tagHeader);
      
      // Render projects in this tag group (only if not collapsed)
      if (!isCollapsed) {
        // Get all projects that have this tag
        const projectsWithThisTag = this.projects.filter(p => {
          const tags = p.tags || [];
          if (typeof tags === 'string') {
            try {
              tags = JSON.parse(tags);
            } catch (e) {
              tags = [];
            }
          }
          if (!Array.isArray(tags)) tags = [];
          return tags.includes(tagName);
        });
        
        // Create a modified version of projects where:
        // - parent_id is now an array, so we find which parent has the matching tag
        // - If no parent has the tag, make it a root in this tag group
        const modifiedProjects = projectsWithThisTag.map(project => {
          const projectCopy = { ...project };
          
          // Find the parent that has this tag
          const tagSpecificParentId = this.getParentIdForTag(project, tagName);
          
          if (tagSpecificParentId !== null) {
            // Use the parent that has this tag
            projectCopy.parent_id = tagSpecificParentId;
          } else {
            // No parent has this tag, make it a root in this group
            projectCopy.parent_id = null;
          }
          
          return projectCopy;
        });
        
        // Build tree with modified projects
        const tagHierarchicalProjects = buildTree(modifiedProjects);
        
        // Render projects in this tag group
        tagHierarchicalProjects.forEach(item => {
          if (item.isSeparator) {
            this.renderSeparator(item, container);
            return;
          }
          
          this.renderProjectItem(item, container, modifiedProjects);
        });
        
      }
    });
    
    // Render "No Tag" group at the end if it wasn't rendered yet (or if it's not in saved order)
    if (shouldShowNoTag && !container.querySelector('[data-tag-name="No Tag"]')) {
      this.renderNoTagGroup(projectsWithoutTags, container, buildTree);
    }
    
      // Setup simple drag and drop for projects (only parent-child relationships)
      this.setupSimpleProjectDragAndDrop();
      
      // Badges are updated in initNotifications() - no need to update again here
      // This prevents duplicate calls and flashing badges
    } catch (error) {
      console.error('[FRONTEND] Error in renderProjects:', error);
      const container = document.getElementById('projects-cont');
      if (container) {
        container.innerHTML = '<div class="text-xs text-red-400 px-2 py-1">Error rendering projects: ' + error.message + '</div>';
      }
    }
  }

  // Update visual state of active space without full re-render
  updateActiveSpaceVisualState() {
    if (!this.activeSpace) return;
    
    // Remove active state from all projects and users
    document.querySelectorAll('.project-item').forEach(el => {
      el.classList.remove('bg-[#4285f4]/10', 'text-[#4285f4]', 'font-medium', 'shadow-sm');
      el.classList.add('hover:bg-[#e8eaed]');
    });
    document.querySelectorAll('.user-item').forEach(el => {
      el.classList.remove('bg-[#4285f4]/10', 'text-[#4285f4]', 'font-medium', 'shadow-sm');
      el.classList.add('hover:bg-[#e8eaed]');
    });
    
    // Add active state to current space
    // data-project-id is on the wrapper, so find the wrapper first
    const projectWrapper = document.querySelector(`[data-project-id="${this.activeSpace.id}"]`);
    const projectItem = projectWrapper?.querySelector('.project-item');
    const userItem = document.querySelector(`.user-item[data-user-id="${this.activeSpace.id}"]`);
    
    const activeElement = projectItem || userItem;
    
    if (activeElement) {
      activeElement.classList.add('bg-[#4285f4]/10', 'text-[#4285f4]', 'font-medium', 'shadow-sm');
      activeElement.classList.remove('hover:bg-[#e8eaed]', 'hover:bg-[#f5f7fa]');
    }
  }

  // Enhanced drag and drop for projects with visual feedback
  setupSimpleProjectDragAndDrop() {
    const container = document.getElementById('projects-cont');
    if (!container) return;

    let draggedElement = null;
    let draggedProjectId = null;
    let draggedProject = null;
    let dropIndicator = null;
    let dragStartY = 0;
    let isDragging = false;
    const activationDistance = 5;

    container.addEventListener('mousedown', (e) => {
      // Only allow drag on project items, not on buttons
      const projectItem = e.target.closest('.project-item');
      if (!projectItem) return;
      
      // Don't start drag if clicking on buttons
      if (e.target.closest('.expand-btn') || e.target.closest('.project-menu-btn')) {
        return;
      }

      const wrapper = projectItem.closest('[data-project-id]');
      if (!wrapper) return;

      draggedProjectId = wrapper.getAttribute('data-project-id');
      draggedProject = this.projects.find(p => p.id === draggedProjectId);
      
      // Don't allow dragging ghost parents
      if (draggedProject && (draggedProject.isGhost === true || draggedProject.isReadOnly === true)) {
        return;
      }
      
      draggedElement = wrapper;
      dragStartY = e.clientY;
      isDragging = false;
      
      // Hide menu buttons during drag
      container.querySelectorAll('.project-menu-btn').forEach(btn => {
        btn.style.display = 'none';
      });
    });

    document.addEventListener('mousemove', (e) => {
      if (!draggedElement || !draggedProjectId) return;
      
      const distance = Math.abs(e.clientY - dragStartY);
      if (distance >= activationDistance && !isDragging) {
        isDragging = true;
        
        // Freeze sidebar - disable hover effects
        container.classList.add('dragging-active');
        draggedElement.classList.add('dragging-item');
        draggedElement.style.opacity = '0.5';
        draggedElement.style.cursor = 'grabbing';
      }
      
      if (!isDragging) return;
      
      e.preventDefault();
      
      // Find the target element under the cursor
      const elementAtPoint = document.elementFromPoint(e.clientX, e.clientY);
      if (!elementAtPoint) {
        this.clearDropIndicator();
        return;
      }
      
      // Find closest project element
      const targetWrapper = elementAtPoint.closest('[data-project-id]');
      const targetProjectId = targetWrapper?.getAttribute('data-project-id');
      
      // Check if we're inside a tag group
      const currentTag = this.getCurrentTagContext(draggedElement);
      
      // Get the effective parent_id for the current tag context
      // parent_id is now an array, so we find which parent has the matching tag
      let effectiveParentId = null;
      if (currentTag && currentTag !== 'No Tag') {
        effectiveParentId = this.getParentIdForTag(draggedProject, currentTag);
      } else {
        // "No Tag" group or outside - use first parent from array (or null)
        const parentIds = draggedProject?.parent_id || [];
        const parentIdsArray = Array.isArray(parentIds) ? parentIds : (parentIds ? [parentIds] : []);
        effectiveParentId = parentIdsArray.length > 0 ? parentIdsArray[0] : null;
      }
      
      // Check if we're over the container itself (for moving to root)
      const isOverContainer = container.contains(elementAtPoint) && !targetWrapper;
      
      if (isOverContainer && effectiveParentId) {
        // Show indicator at top of container for "move to root"
        this.showDropIndicator(container, 'top', 'Move to root level');
        dropIndicator = { type: 'root', targetId: null };
      } else if (targetWrapper && targetProjectId !== draggedProjectId) {
        const targetProject = this.projects.find(p => p.id === targetProjectId);
        if (!targetProject) return;
        
        // Don't allow dropping on ghost parents
        if (targetProject.isGhost === true || targetProject.isReadOnly === true) {
          this.clearDropIndicator();
          dropIndicator = null;
          return;
        }
        
        // Get effective parent_id for target project in current tag context
        let targetEffectiveParentId = null;
        if (currentTag && currentTag !== 'No Tag') {
          targetEffectiveParentId = this.getParentIdForTag(targetProject, currentTag);
        } else {
          // "No Tag" group or outside - use first parent from array (or null)
          const targetParentIds = targetProject?.parent_id || [];
          const targetParentIdsArray = Array.isArray(targetParentIds) ? targetParentIds : (targetParentIds ? [targetParentIds] : []);
          targetEffectiveParentId = targetParentIdsArray.length > 0 ? targetParentIdsArray[0] : null;
        }
        
        // Determine if we can reorder (same parent) or make child (different parent)
        const canReorder = effectiveParentId === targetEffectiveParentId;
        const canMakeChild = targetProjectId !== draggedProjectId;
        
        // Calculate position (before/after)
        const targetRect = targetWrapper.getBoundingClientRect();
        const relativeY = e.clientY - targetRect.top;
        const position = relativeY < targetRect.height / 2 ? 'before' : 'after';
        
        if (canReorder) {
          // Show reorder indicator (blue line)
          this.showDropIndicator(targetWrapper, position, 'Reorder');
          dropIndicator = { type: 'reorder', targetId: targetProjectId, position };
        } else if (canMakeChild) {
          // Show child indicator (different style)
          this.showDropIndicator(targetWrapper, 'inside', 'Make child');
          dropIndicator = { type: 'child', targetId: targetProjectId };
        }
      } else {
        this.clearDropIndicator();
        dropIndicator = null;
      }
    });

    document.addEventListener('mouseup', async () => {
      if (!draggedElement || !draggedProjectId) {
        this.cleanupDrag();
        return;
      }

      // Cleanup visual feedback
      this.cleanupDrag();
      
      if (!isDragging || !dropIndicator) {
        draggedElement = null;
        draggedProjectId = null;
        draggedProject = null;
        dropIndicator = null;
        return;
      }
      
      // Check if we're inside a tag group
      const currentTag = this.getCurrentTagContext(draggedElement);
      
      try {
        // Always use the API to update parent_id (now an array)
        // The backend will handle adding/removing from the array based on tags
        if (dropIndicator.type === 'root') {
          // Moving to root level
          await this.request('/api/spaces/reorder', {
            method: 'POST',
            body: JSON.stringify({
              spaceId: draggedProjectId,
              targetId: null,
              position: 'after',
              targetParentId: null
            })
          });
        } else if (dropIndicator.type === 'reorder') {
          // Reordering within same parent (no parent change)
          await this.request('/api/spaces/reorder', {
            method: 'POST',
            body: JSON.stringify({
              spaceId: draggedProjectId,
              targetId: dropIndicator.targetId,
              position: dropIndicator.position,
              targetParentId: effectiveParentId
            })
          });
        } else if (dropIndicator.type === 'child') {
          // Making child - backend will add to array if multiple tags, or replace if single tag
          await this.request('/api/spaces/reorder', {
            method: 'POST',
            body: JSON.stringify({
              spaceId: draggedProjectId,
              targetId: dropIndicator.targetId,
              position: 'inside',
              targetParentId: dropIndicator.targetId
            })
          });
        }
        
        // Reload projects to reflect the change
        await this.loadProjects();
      } catch (err) {
        console.error('Failed to move project:', err);
        await this.loadProjects();
      }
      
      draggedElement = null;
      draggedProjectId = null;
      draggedProject = null;
      dropIndicator = null;
    });
  }

  cleanupDrag() {
    const container = document.getElementById('projects-cont');
    if (container) {
      container.classList.remove('dragging-active');
      container.querySelectorAll('.dragging-item').forEach(el => {
        el.classList.remove('dragging-item');
        el.style.opacity = '';
        el.style.cursor = '';
      });
      // Show menu buttons again
      container.querySelectorAll('.project-menu-btn').forEach(btn => {
        btn.style.display = '';
      });
    }
    this.clearDropIndicator();
  }

  showDropIndicator(targetElement, position, label = '') {
    this.clearDropIndicator();
    
    const indicator = document.createElement('div');
    indicator.className = 'project-drop-indicator';
    indicator.setAttribute('data-indicator-label', label);
    
    const rect = targetElement.getBoundingClientRect();
    const container = document.getElementById('projects-cont');
    const containerRect = container.getBoundingClientRect();
    
    if (position === 'top' && targetElement === container) {
      // Show at top of container
      indicator.style.cssText = `
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 2px;
        background-color: #4285f4;
        z-index: 1000;
        pointer-events: none;
      `;
      container.appendChild(indicator);
    } else if (position === 'before') {
      indicator.style.cssText = `
        position: absolute;
        left: ${rect.left - containerRect.left}px;
        width: ${rect.width}px;
        top: ${rect.top - containerRect.top}px;
        height: 2px;
        background-color: #4285f4;
        z-index: 1000;
        pointer-events: none;
      `;
      container.appendChild(indicator);
    } else if (position === 'after') {
      indicator.style.cssText = `
        position: absolute;
        left: ${rect.left - containerRect.left}px;
        width: ${rect.width}px;
        top: ${rect.bottom - containerRect.top}px;
        height: 2px;
        background-color: #4285f4;
        z-index: 1000;
        pointer-events: none;
      `;
      container.appendChild(indicator);
    } else if (position === 'inside') {
      // Highlight the target element
      targetElement.style.backgroundColor = '#e8f0fe';
      targetElement.style.borderLeft = '3px solid #4285f4';
    }
  }

  clearDropIndicator() {
    const container = document.getElementById('projects-cont');
    if (!container) return;
    
    // Remove indicator line
    container.querySelectorAll('.project-drop-indicator').forEach(el => el.remove());
    
    // Reset all project styles
    container.querySelectorAll('[data-project-id]').forEach(el => {
      el.style.backgroundColor = '';
      el.style.borderLeft = '';
    });
  }

  async toggleProjectExpanded(projectId) {
    const project = this.projects.find(p => p.id === projectId);
    if (!project) return;

    // Check if this is a ghost parent - if so, only update locally, don't call backend
    const isGhost = project.isGhost === true || project.isReadOnly === true;
    
    // OPTIMISTIC UI: Update local state immediately for instant feedback
    const newExpanded = !project.is_expanded;
    project.is_expanded = newExpanded;
    
    // Save to localStorage immediately
    this.saveProjectExpansionState();
    
    // Re-render immediately to show updated hierarchy
    this.renderProjects();
    
    // Only update backend if NOT a ghost parent
    if (!isGhost) {
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
        this.saveProjectExpansionState();
        this.renderProjects();
      });
    } else {
      console.log(`[FRONTEND] Toggled ghost parent ${project.name} expanded state locally (no backend update)`);
    }
  }


  async archiveProject(projectId) {
    // Find project in allProjects (includes archived ones) or in projects
    const project = this.allProjects.find(p => p.id === projectId) || this.projects.find(p => p.id === projectId);
    if (!project) return;
    
    // Toggle archived state
    const newArchivedState = !project.archived;
    
    // Optimistic UI: Update archived state
    project.archived = newArchivedState;
    
    // Update in allProjects array
    const allProjectsIndex = this.allProjects.findIndex(p => p.id === projectId);
    if (allProjectsIndex !== -1) {
      this.allProjects[allProjectsIndex].archived = newArchivedState;
    } else {
      this.allProjects.push({ ...project, archived: newArchivedState });
    }
    
    // Update in projects array (active projects list)
    const projectIndex = this.projects.findIndex(p => p.id === projectId);
    if (newArchivedState) {
      // Archive: remove from active projects list
      if (projectIndex !== -1) {
        this.projects.splice(projectIndex, 1);
      }
      
      // Close active space if it was the archived project
      if (this.activeSpace?.id === projectId) {
        this.clearActiveSpace();
      }
    } else {
      // Unarchive: add back to active projects list if not already there
      if (projectIndex === -1) {
        this.projects.push(project);
      }
    }
    
    // Re-render to show updated state
    this.renderProjects();
    
    try {
      // Update in backend (this may take a moment due to Notion sync)
      await this.request(`/api/spaces/${projectId}/archive`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: newArchivedState })
      });
      
      // Reload projects to ensure sync is correct (in background)
      this.loadProjects().catch(err => {
        console.error('Failed to reload projects after archive toggle:', err);
      });
    } catch (err) {
      console.error('Failed to toggle archive project:', err);
      // Restore project state if update failed
      project.archived = !newArchivedState;
      if (allProjectsIndex !== -1) {
        this.allProjects[allProjectsIndex].archived = !newArchivedState;
      }
      
      // Restore in projects array
      if (newArchivedState) {
        // Was trying to archive, restore to active
        if (projectIndex === -1) {
          this.projects.push(project);
        }
      } else {
        // Was trying to unarchive, remove from active
        if (projectIndex !== -1) {
          this.projects.splice(projectIndex, 1);
        }
      }
      this.renderProjects();
      alert(`Failed to ${newArchivedState ? 'archive' : 'unarchive'} project. Please try again.`);
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
      userEl.setAttribute('data-user-id', user.id);
      
      userEl.innerHTML = `
        <div class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-medium flex-shrink-0 overflow-hidden">
          ${user.other_user_photo ? `<img src="${user.other_user_photo}" alt="" class="w-full h-full object-cover" />` : `<span class="text-xs">${initial}</span>`}
        </div>
        <span class="flex-1 text-xs truncate">${this.escapeHTML(displayName)}</span>
        <div class="space-unread-badge" data-space-id="${user.id}" style="display: none; position: absolute; top: 50%; transform: translateY(-50%); right: 8px; background-color: #ea4335; color: white; border-radius: 50%; width: 18px; height: 18px; min-width: 18px; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; z-index: 10; line-height: 1;"></div>
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
    
    // Update badges after rendering (will update both desktop and mobile if present)
    setTimeout(() => {
      this.users.forEach(user => {
        this.updateSpaceBadge(user.id);
      });
    }, 100);
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
      const modal = document.getElementById('user-picker-modal');
      const listContainer = document.getElementById('user-picker-list');
      const searchInput = document.getElementById('user-picker-search-input');
      const goBtn = document.getElementById('user-picker-go-btn');
      const closeBtn = document.getElementById('user-picker-close');
      
      if (!modal || !listContainer || !searchInput || !goBtn || !closeBtn) {
        console.error('User picker modal elements not found', {
          modal: !!modal,
          listContainer: !!listContainer,
          searchInput: !!searchInput,
          goBtn: !!goBtn,
          closeBtn: !!closeBtn
        });
        return;
      }

      // Load users first
      const { users } = await this.request('/api/users');
      let filteredUsers = users || [];
      let selectedUsers = [];

      // Clear previous state
      searchInput.value = '';
      listContainer.innerHTML = '';

      // Store handlers to remove them later
      const handlers = {
        search: null,
        goToChat: null,
        close: null,
        modalClick: null
      };

      // Render users function
      const renderUsers = () => {
        listContainer.innerHTML = '';
        
        if (filteredUsers.length === 0) {
          listContainer.innerHTML = '<div class="user-picker-empty">No users found</div>';
          return;
        }

        filteredUsers.forEach(user => {
          const userEl = document.createElement('button');
          userEl.className = 'user-picker-item';
          const isSelected = selectedUsers.some(u => u.id === user.id);
          if (isSelected) {
            userEl.classList.add('selected');
          }

          const name = user.name || user.email || 'Unknown';
          const email = user.email || '';
          const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || name[0]?.toUpperCase() || 'U';
          
          // Build avatar HTML - use photo if available, otherwise initials
          let avatarHTML;
          if (user.avatar_photo) {
            avatarHTML = `<img src="${this.escapeHTML(user.avatar_photo)}" alt="${this.escapeHTML(name)}" class="user-picker-avatar-img" />`;
          } else {
            avatarHTML = `<div class="user-picker-avatar-initials">${initials}</div>`;
          }
          
          userEl.innerHTML = `
            <div class="user-picker-checkbox">
              <input type="checkbox" ${isSelected ? 'checked' : ''} />
            </div>
            <div class="user-picker-avatar">${avatarHTML}</div>
            <div class="user-picker-info">
              <div class="user-picker-name">${this.escapeHTML(name)}</div>
              <div class="user-picker-email">${this.escapeHTML(email)}</div>
            </div>
          `;

          userEl.addEventListener('click', () => {
            const checkbox = userEl.querySelector('input[type="checkbox"]');
            const index = selectedUsers.findIndex(u => u.id === user.id);
              if (index >= 0) {
              selectedUsers.splice(index, 1);
                userEl.classList.remove('selected');
                if (checkbox) checkbox.checked = false;
            } else {
              selectedUsers.push(user);
              userEl.classList.add('selected');
              if (checkbox) checkbox.checked = true;
            }
            updateGoButton();
          });

          listContainer.appendChild(userEl);
        });
      };

      // Update Go button state
      const updateGoButton = () => {
        goBtn.disabled = selectedUsers.length === 0;
      };

      // Search handler
      handlers.search = () => {
        const query = searchInput.value.toLowerCase().trim();
        if (!query) {
          filteredUsers = users || [];
        } else {
          filteredUsers = (users || []).filter(user => {
            const name = (user.name || '').toLowerCase();
            const email = (user.email || '').toLowerCase();
            return name.includes(query) || email.includes(query);
          });
        }
        selectedUsers = selectedUsers.filter(selected => 
          filteredUsers.some(u => u.id === selected.id)
        );
        renderUsers();
        updateGoButton();
      };

      // Remove previous listener if exists
      searchInput.removeEventListener('input', handlers.search);
      searchInput.addEventListener('input', handlers.search);

      // Go to chat handler
      handlers.goToChat = async () => {
        if (selectedUsers.length === 0) return;

        // If only one user selected, open chat directly
        if (selectedUsers.length === 1) {
          const user = selectedUsers[0];
          try {
            // Check if space already exists
            // Match by exact name or email (case-insensitive)
            const userName = (user.name || '').toLowerCase().trim();
            const userEmail = (user.email || '').toLowerCase().trim();
            
            const existingSpace = this.users.find(s => {
              const spaceName = (s.name || '').toLowerCase().trim();
              const spaceDisplayName = (s.display_name || '').toLowerCase().trim();
              
              // Match if space name equals user name or user email
              return (spaceName === userName || spaceName === userEmail ||
                      spaceDisplayName === userName || spaceDisplayName === userEmail);
            });

            if (existingSpace) {
              console.log('Found existing space:', existingSpace.id, existingSpace.name);
              this.selectUser(existingSpace.id);
            } else {
              console.log('Creating new space for user:', user.name || user.email);
              // Create new space
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
            }

            // Close modal (hide it, don't remove from DOM)
            handlers.close();
            
            // Close mobile menu if open
            if (window.mobileUI && window.mobileUI.hideAll) {
              window.mobileUI.hideAll();
            }
          } catch (err) {
            console.error('Failed to create/open chat:', err);
            alert('Failed to open chat');
          }
        } else {
          // Multiple users selected - for now, just open the first one
          alert('Group chat functionality coming soon. Opening chat with first selected user.');
          const user = selectedUsers[0];
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
          
          // Close modal (hide it, don't remove from DOM)
          handlers.close();
          
          // Close mobile menu if open
          if (window.mobileUI && window.mobileUI.hideAll) {
            window.mobileUI.hideAll();
          }
        }
      };

      // Remove previous listener and add new one
      const newGoBtnHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        handlers.goToChat();
      };
      goBtn.onclick = null; // Clear previous
      goBtn.addEventListener('click', newGoBtnHandler, { once: false });

      // Close handler
      handlers.close = () => {
        modal.classList.remove('active');
        searchInput.value = '';
        selectedUsers = [];
        filteredUsers = users || [];
        renderUsers();
        updateGoButton();
        
        // Note: Event listeners will be cleaned up when modal is closed
        // They're attached with specific handlers that won't interfere
      };

      handlers.modalClick = (e) => {
        if (e.target === modal) {
          handlers.close();
        }
      };

      // Remove previous listener and add new one  
      const newCloseBtnHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        handlers.close();
      };
      closeBtn.onclick = null; // Clear previous
      closeBtn.addEventListener('click', newCloseBtnHandler, { once: false });
      
      const newModalClickHandler = (e) => {
        if (e.target === modal) {
          handlers.close();
        }
      };
      modal.onclick = null; // Clear previous
      modal.addEventListener('click', newModalClickHandler, { once: false });

      // Initial render
      renderUsers();
      updateGoButton();
      
      // Show modal and focus search
      console.log('Showing user picker modal');
      modal.classList.add('active');
      console.log('Modal active class added. Current classes:', modal.className);
      console.log('Modal computed display:', window.getComputedStyle(modal).display);
      setTimeout(() => {
        searchInput.focus();
      }, 100);
    } catch (err) {
      console.error('Failed to show user picker:', err);
      alert('Failed to load users: ' + (err.message || 'Unknown error'));
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
          <div class="chat-messages" style="flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 0; background: #ffffff;" data-chat-id="">
            <!-- Messages will be rendered here -->
          </div>
          <div class="chat-input-container" style="border-top: 1px solid #e8eaed; padding: 12px 16px; background: #ffffff;">
            <form class="chat-form" style="display: flex; gap: 8px; align-items: flex-end;">
              <textarea 
                class="chat-input" 
                placeholder="Type a message..." 
                rows="1"
                style="flex: 1; padding: 10px 14px; border: 1px solid #e8eaed; border-radius: 20px; outline: none; font-size: 14px; font-family: 'Geist', sans-serif; background: #f5f7fa; resize: none; min-height: 20px; max-height: 120px; overflow-y: auto; word-wrap: break-word; user-select: text; -webkit-user-select: text;"
                autocomplete="off"
              ></textarea>
              <button 
                type="submit"
                style="padding: 10px 20px; background: #4285f4; color: white; border: none; border-radius: 20px; cursor: pointer; font-size: 14px; font-weight: 500; font-family: 'Geist', sans-serif; align-self: flex-end;"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      `;

      // Attach send handler inmediatamente
      const form = wrapper.querySelector('.chat-form');
      const textarea = wrapper.querySelector('.chat-input');
      
      if (form && textarea) {
        // Auto-resize textarea
        const autoResize = () => {
          textarea.style.height = 'auto';
          const newHeight = Math.min(textarea.scrollHeight, 120);
          textarea.style.height = newHeight + 'px';
        };
        
        textarea.addEventListener('input', autoResize);
        
        // Handle Enter key (send) vs Shift+Enter (new line)
        textarea.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const message = textarea.value?.trim();
            if (message && this.currentChatId) {
              this.sendChatMessage(this.currentChatId, message);
              textarea.value = '';
              textarea.style.height = 'auto';
            }
          }
        });
        
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const message = textarea.value?.trim();
          if (message && this.currentChatId) {
            this.sendChatMessage(this.currentChatId, message);
            textarea.value = '';
            textarea.style.height = 'auto';
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
      this.loadChatMessages(wrapper, chat.id, spaceId);
    } catch {
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
        <div class="chat-messages" style="flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 0; background: #ffffff;" data-chat-id="${chatId}">
          <!-- Messages will be rendered here -->
        </div>
        <div class="chat-input-container" style="border-top: 1px solid #e8eaed; padding: 12px 16px; background: #ffffff;">
          <form class="chat-form" style="display: flex; gap: 8px; align-items: flex-end;">
            <textarea 
              class="chat-input" 
              placeholder="Type a message..." 
              rows="1"
              style="flex: 1; padding: 10px 14px; border: 1px solid #e8eaed; border-radius: 20px; outline: none; font-size: 14px; font-family: 'Geist', sans-serif; background: #f5f7fa; resize: none; min-height: 20px; max-height: 120px; overflow-y: auto; white-space: pre-wrap; word-wrap: break-word; user-select: text; -webkit-user-select: text;"
              autocomplete="off"
            ></textarea>
            <button 
              type="submit"
              style="padding: 10px 20px; background: #4285f4; color: white; border: none; border-radius: 20px; cursor: pointer; font-size: 14px; font-weight: 500; font-family: 'Geist', sans-serif; align-self: flex-end;"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    `;

    // Attach send handler
    const form = wrapper.querySelector('.chat-form');
    const textarea = wrapper.querySelector('.chat-input');
    
    if (form && textarea) {
      // Auto-resize textarea
      const autoResize = () => {
        textarea.style.height = 'auto';
        const newHeight = Math.min(textarea.scrollHeight, 120);
        textarea.style.height = newHeight + 'px';
      };
      
      textarea.addEventListener('input', autoResize);
      
      // Handle Enter key (send) vs Shift+Enter (new line)
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const message = textarea.value?.trim();
          if (message) {
            this.sendChatMessage(chatId, message);
            textarea.value = '';
            textarea.style.height = 'auto';
          }
        }
      });
      
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = textarea.value?.trim();
        if (message) {
          this.sendChatMessage(chatId, message);
          textarea.value = '';
          textarea.style.height = 'auto';
        }
      });
    }
  }

  async loadChatMessages(container, chatId, _spaceId = null, skipRealtime = false) {
    const messagesContainer = container.querySelector('.chat-messages');
    if (!messagesContainer) return;

    try {
      // Load only last 20 messages initially
      const { messages } = await this.request(`/api/chat/${chatId}/messages?limit=20`);
      
      // Store pagination state
      if (!messagesContainer.dataset.chatId || messagesContainer.dataset.chatId !== chatId) {
        messagesContainer.dataset.chatId = chatId;
        messagesContainer.dataset.hasMore = messages.length === 20 ? 'true' : 'false';
        messagesContainer.dataset.oldestMessageId = messages.length > 0 ? messages[0].id : null;
        messagesContainer.dataset.oldestMessageTime = messages.length > 0 ? messages[0].created_at : null;
      }
      
      this.renderChatMessages(messagesContainer, messages || []);
      
      // Scroll to bottom
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      
      // Setup scroll listener for loading more messages
      if (!messagesContainer.dataset.scrollListenerAdded) {
        messagesContainer.dataset.scrollListenerAdded = 'true';
        messagesContainer.addEventListener('scroll', () => {
          // Load more when scrolled near top (within 200px)
          if (messagesContainer.scrollTop < 200 && messagesContainer.dataset.hasMore === 'true' && messagesContainer.dataset.loading !== 'true') {
            this.loadMoreMessages(messagesContainer, chatId);
          }
        });
      }
      
      // Mark as read if this chat tab is currently active/visible
      if (_spaceId && !skipRealtime) {
        const activeTab = window.tabManager?.active();
        if (activeTab) {
          const chatUrl = `luna://chat/${_spaceId}`;
          if (activeTab.url === chatUrl) {
            // Tab is active and we just loaded messages - mark as read immediately
            this.markChatAsReadIfVisible(_spaceId);
          }
        }
      }
      
      // Setup realtime subscription for this chat (only if not skipping)
      if (!skipRealtime) {
        // Only setup if we don't already have a subscription for this chat
        if (!this.chatSubscriptions.has(chatId)) {
          this.setupChatRealtime(chatId, messagesContainer);
        }
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
      const messagesContainer = container.querySelector('.chat-messages');
      if (messagesContainer) {
        messagesContainer.innerHTML = `
          <div style="padding: 20px; text-align: center; color: #5f6368;">
            Failed to load messages
          </div>
        `;
      }
    }
  }

  // Load more messages when scrolling up (lazy loading)
  async loadMoreMessages(messagesContainer, chatId) {
    if (messagesContainer.dataset.loading === 'true') return; // Prevent duplicate loads
    
    const oldestMessageTime = messagesContainer.dataset.oldestMessageTime;
    if (!oldestMessageTime || messagesContainer.dataset.hasMore !== 'true') return;
    
    messagesContainer.dataset.loading = 'true';
    
    try {
      // Load 20 more messages before this timestamp
      const { messages } = await this.request(
        `/api/chat/${chatId}/messages?limit=20&before=${encodeURIComponent(oldestMessageTime)}`
      );
      
      if (messages && messages.length > 0) {
        // Save scroll position
        const scrollHeight = messagesContainer.scrollHeight;
        const scrollTop = messagesContainer.scrollTop;
        
        // Prepend new messages (they're already in correct order from API)
        this.renderChatMessages(messagesContainer, messages, true); // true = prepend mode
        
        // Restore scroll position
        setTimeout(() => {
          const newScrollHeight = messagesContainer.scrollHeight;
          messagesContainer.scrollTop = scrollTop + (newScrollHeight - scrollHeight);
        }, 0);
        
        // Update pagination state
        messagesContainer.dataset.oldestMessageId = messages[0].id;
        messagesContainer.dataset.oldestMessageTime = messages[0].created_at;
        messagesContainer.dataset.hasMore = messages.length === 20 ? 'true' : 'false';
      } else {
        messagesContainer.dataset.hasMore = 'false';
      }
    } catch (err) {
      console.error('Failed to load more messages:', err);
    } finally {
      messagesContainer.dataset.loading = 'false';
    }
  }
  
  // Mark chat messages as read for a specific space (only if chat tab is currently visible)
  async markChatAsReadIfVisible(spaceId) {
    if (!spaceId) return;
    
    // Check if there's an active tab and if it's a chat tab for this space
    const activeTab = window.tabManager?.active();
    if (!activeTab) return;
    
    const chatUrl = `luna://chat/${spaceId}`;
    if (activeTab.url !== chatUrl) return;
    
    // Prevent multiple simultaneous calls
    const markReadKey = `mark-read-${spaceId}`;
    if (this[markReadKey]) {
      return; // Already marking as read
    }
    this[markReadKey] = true;
    
    try {
      // Mark as read - backend handles the update immediately
      await this.request(`/api/chat/space/${spaceId}/mark-read`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      
      // Update only the badge for this specific space (no delay needed, backend is synchronous)
      await this.updateSpaceBadge(spaceId);
      await this.updateUnreadBadge();
    } catch (markReadErr) {
      console.error(`[MARK READ] Error for ${spaceId}:`, markReadErr);
    } finally {
      this[markReadKey] = false;
    }
  }
  
  async initSupabaseClient() {
    if (this.supabaseClient) return this.supabaseClient;
    
    try {
      console.log('🔧 Initializing Supabase client for realtime...');
      const config = await this.request('/api/users/supabase-config');
      console.log('📋 Supabase config received:', { url: config?.url ? 'SET' : 'MISSING', anonKey: config?.anonKey ? 'SET' : 'MISSING' });
      
      if (config?.url && config?.anonKey) {
        // Dynamic import of Supabase
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        this.supabaseClient = createClient(config.url, config.anonKey, {
          auth: {
            cookieOptions: {
              sameSite: 'none',
              secure: true
            }
          },
          realtime: {
            params: {
              eventsPerSecond: 10
            }
          }
        });
        console.log('✅ Supabase client created');
        return this.supabaseClient;
      } else {
        console.error('❌ Missing Supabase config');
      return null;
      }
    } catch (err) {
      console.error('❌ Failed to initialize Supabase:', err);
      return null;
    }
  }
  
  async setupChatRealtime(chatId, messagesContainer) {
    // Prevent duplicate subscriptions - check if already setting up
    const setupKey = `realtime-setup-${chatId}`;
    if (window[setupKey]) {
      console.log('⏳ Realtime setup already in progress for chat:', chatId);
      return;
    }
    window[setupKey] = true;
    
    // Cleanup previous subscription for this chat
    if (this.chatSubscriptions.has(chatId)) {
      const oldChannel = this.chatSubscriptions.get(chatId);
      try {
        oldChannel.unsubscribe();
      } catch {
        // Ignore errors when unsubscribing
      }
      this.chatSubscriptions.delete(chatId);
    }
    
    // Initialize Supabase client if needed
    const client = await this.initSupabaseClient();
    if (!client) {
      console.log('⚠️ Supabase client not available, will use polling instead');
      // Start polling as fallback
      this.startChatPolling(chatId, messagesContainer);
      return;
    }
    
    console.log('📡 Setting up realtime subscription for chat:', chatId);
    const channelName = `chat:${chatId}`;
    
    // Add error handler to get more details
      const channel = client
        .channel(channelName, {
          config: {
            broadcast: { self: true }
          }
        })
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `chat_id=eq.${chatId}`
          },
        // eslint-disable-next-line no-unused-vars
        async (_payload) => {
          // Check if user is near bottom (within 100px) - if so, auto-scroll and add new message
          const isNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 100;
          
          // Load only the last message to append it
          try {
            const { messages } = await this.request(`/api/chat/${chatId}/messages?limit=1`);
            if (messages && messages.length > 0) {
              const newMessage = messages[0];
              
              // Check if message already exists (prevent duplicates)
              const existingMessage = messagesContainer.querySelector(`[data-message-id="${newMessage.id}"]`);
              if (!existingMessage) {
                // Append new message at the end
                this.renderChatMessages(messagesContainer, [newMessage], false, true); // append mode
                
                // Auto-scroll to bottom if user was near bottom
                if (isNearBottom) {
                  setTimeout(() => {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                  }, 0);
                }
              }
            }
          } catch (err) {
            console.error('Failed to load new message:', err);
            // Fallback: reload last 20 messages if loading single message fails
            const wrapper = messagesContainer.closest('.chat-wrapper');
            if (wrapper) {
              const spaceId = wrapper?.dataset?.spaceId || this.activeSpace?.id;
              // Only reload if user is near bottom (to avoid disrupting scroll position)
              if (isNearBottom) {
                this.loadChatMessages(wrapper, chatId, spaceId, true); // skipRealtime = true
              }
            }
          }
          
          // Update unread badges when new message arrives
          // This ensures badges update even if chat is not visible
          await this.updateSpaceUnreadBadges();
          
          // If this chat tab is currently visible, mark the new messages as read
          const wrapper = messagesContainer.closest('.chat-wrapper');
          if (wrapper) {
            const spaceId = wrapper?.dataset?.spaceId || this.activeSpace?.id;
            if (spaceId) {
              // Small delay to ensure messages are loaded before marking as read
              setTimeout(() => {
                this.markChatAsReadIfVisible(spaceId);
              }, 300);
            }
          }
          }
        )
        .subscribe((status, err) => {
        console.log('📡 Realtime subscription status:', status);
        if (err) {
          console.error('❌ Realtime subscription error details:', err);
        }
          
          if (status === 'SUBSCRIBED') {
          console.log('✅✅✅ Subscribed to realtime for chat:', chatId);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Error subscribing to realtime - will use polling');
          console.error('   This usually means:');
          console.error('   1. Realtime is not enabled for chat_messages table');
          console.error('   2. RLS policies are blocking the subscription');
          console.error('   3. REPLICA IDENTITY is not set to FULL');
          console.error('   Check Supabase Dashboard > Database > Replication');
          this.startChatPolling(chatId, messagesContainer);
        } else if (status === 'TIMED_OUT') {
          console.error('❌ Realtime subscription timed out - will use polling');
          this.startChatPolling(chatId, messagesContainer);
        } else if (status === 'CLOSED') {
          console.error('❌ Realtime subscription closed');
          // Only start polling if we don't already have an active subscription
          // (might be closing because we're creating a new one)
          if (!this.chatSubscriptions.has(chatId)) {
            console.log('🔄 Starting polling as fallback');
            this.startChatPolling(chatId, messagesContainer);
          } else {
            console.log('⏸️ Skipping polling - new subscription already active');
          }
        }
      });
    
    this.chatSubscriptions.set(chatId, channel);
    delete window[setupKey]; // Clear setup flag
  }
  
  startChatPolling(chatId, messagesContainer) {
    // Stop any existing polling for this chat
    const pollingKey = `chat-poll-${chatId}`;
    if (window[pollingKey]) {
      clearInterval(window[pollingKey]);
    }
    
    console.log('🔄 Starting polling for chat:', chatId);
    // Poll every 2 seconds
    window[pollingKey] = setInterval(() => {
      const container = messagesContainer.closest('.chat-wrapper');
      if (container) {
        this.loadChatMessages(container, chatId, null, true); // skipRealtime = true to avoid recreating subscriptions
      } else {
        // Container removed, stop polling
        clearInterval(window[pollingKey]);
        delete window[pollingKey];
      }
    }, 2000);
  }

  renderChatMessages(container, messages, prepend = false, append = false) {
    const user = this.user;
    
    if (!prepend && !append && messages.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: #5f6368; padding: 40px 20px; flex: 1; display: flex; align-items: center; justify-content: center;">
          No messages yet. Start the conversation!
        </div>
      `;
      return;
    }

    if ((prepend || append) && messages.length === 0) {
      return; // Don't render anything if prepending/appending empty messages
    }

    // Group consecutive messages from the same user
    const groupedMessages = [];
    let currentGroup = null;

    messages.forEach((msg, index) => {
      const isOwn = msg.user_id === user?.id;
      const prevMsg = index > 0 ? messages[index - 1] : null;
      const isNewGroup = !prevMsg || prevMsg.user_id !== msg.user_id;

      if (isNewGroup) {
        if (currentGroup) {
          groupedMessages.push(currentGroup);
        }
        currentGroup = {
          userId: msg.user_id,
          isOwn: isOwn,
          userName: msg.user?.name || msg.user?.email || 'Unknown',
          avatarPhoto: msg.user?.avatar_photo || null,
          messages: [msg]
        };
      } else {
        currentGroup.messages.push(msg);
      }
    });

    if (currentGroup) {
      groupedMessages.push(currentGroup);
    }

    // Create fragment for efficient DOM manipulation
    const fragment = document.createDocumentFragment();

    // Render grouped messages
    groupedMessages.forEach((group, groupIndex) => {
      const isFirstGroup = groupIndex === 0;
      const prevGroup = groupIndex > 0 ? groupedMessages[groupIndex - 1] : null;
      const isDifferentUser = !prevGroup || prevGroup.userId !== group.userId;

      // Add spacing between different users
      // When appending, check if last message in container is from same user
      if (append && isFirstGroup) {
        const lastMessageEl = container.lastElementChild;
        if (lastMessageEl && lastMessageEl.getAttribute('data-message-id')) {
          const lastMessageUserId = lastMessageEl.getAttribute('data-user-id');
          if (lastMessageUserId && lastMessageUserId === String(group.userId)) {
            // Same user, no spacer needed
          } else {
            // Different user, add spacer
            const spacer = document.createElement('div');
            spacer.style.cssText = 'height: 8px;';
            fragment.appendChild(spacer);
          }
        }
      } else if (!isFirstGroup && isDifferentUser) {
        const spacer = document.createElement('div');
        spacer.style.cssText = 'height: 8px;';
        fragment.appendChild(spacer);
      }

      group.messages.forEach((msg, msgIndex) => {
        const isFirstInGroup = msgIndex === 0;
        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const cleanMessage = msg.message?.trim() || '';
        const messageHTML = cleanMessage ? this.escapeHTML(cleanMessage).replace(/\n/g, '<br>') : '';

        const msgEl = document.createElement('div');
        msgEl.setAttribute('data-message-id', msg.id);
        msgEl.setAttribute('data-created-at', msg.created_at);
        msgEl.setAttribute('data-user-id', msg.user_id || '');
        const marginBottom = msgIndex < group.messages.length - 1 ? '3px' : '8px'; // Small spacing between messages in same group, normal spacing between groups
        
        // Avatar always at top, aligned with name
        msgEl.style.cssText = `display: flex; ${group.isOwn ? 'justify-content: flex-end;' : 'justify-content: flex-start;'}; margin-bottom: ${marginBottom}; position: relative; align-items: flex-start; gap: 8px;`;
        
        // Avatar (only for first message in group, always at top)
        let avatarHTML = '';
        if (isFirstInGroup) {
          if (group.avatarPhoto) {
            avatarHTML = `
              <img 
                src="${this.escapeHTML(group.avatarPhoto)}" 
                alt="${this.escapeHTML(group.userName)}"
                style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0; margin-top: ${!group.isOwn ? '16px' : '0'}; ${group.isOwn ? 'order: 2;' : 'order: 0;'}"
              />
            `;
          } else {
            // Fallback: show initials
            const initials = group.userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const bgColor = group.isOwn ? '#4285f4' : '#e8eaed';
            const textColor = group.isOwn ? '#ffffff' : '#5f6368';
            avatarHTML = `
              <div style="width: 32px; height: 32px; border-radius: 50%; background: ${bgColor}; color: ${textColor}; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 500; flex-shrink: 0; margin-top: ${!group.isOwn ? '16px' : '0'}; ${group.isOwn ? 'order: 2;' : 'order: 0;'}">
                ${this.escapeHTML(initials)}
              </div>
            `;
          }
        } else {
          // Spacer for alignment when no avatar (same height as avatar)
          avatarHTML = `<div style="width: 32px; flex-shrink: 0; ${group.isOwn ? 'order: 2;' : 'order: 0;'}"></div>`;
        }

        msgEl.innerHTML = `
          ${avatarHTML}
          <div style="max-width: calc(60% - 40px); ${group.isOwn ? 'margin-left: auto;' : 'margin-right: auto;'} position: relative; ${group.isOwn ? 'order: 1;' : 'order: 1;'}">
            ${isFirstInGroup && !group.isOwn ? `<div style="font-size: 12px; color: #5f6368; margin-bottom: 4px; padding: 0 12px;">${this.escapeHTML(group.userName)}</div>` : ''}
            <div class="chat-message-bubble" style="
              padding: 10px 14px;
              border-radius: ${group.isOwn ? (isFirstInGroup ? '18px 18px 4px 18px' : '18px 4px 4px 18px') : (isFirstInGroup ? '18px 18px 18px 4px' : '4px 18px 18px 4px')};
              background: ${group.isOwn ? '#4285f4' : '#f1f3f5'};
              color: ${group.isOwn ? '#ffffff' : '#202124'};
              font-size: 14px;
              line-height: 1.4;
              word-wrap: break-word;
              user-select: text;
              -webkit-user-select: text;
              cursor: text;
              position: relative;
            ">
              ${messageHTML}
              <div class="chat-message-time" style="
                font-size: 11px;
                color: ${group.isOwn ? '#4285f4' : '#5f6368'};
                position: absolute;
                ${group.isOwn ? 'left: -55px;' : 'right: -55px;'}
                top: 50%;
                transform: translateY(-50%);
                white-space: nowrap;
                opacity: 0;
                transition: opacity 0.2s ease;
                pointer-events: none;
                z-index: 10;
              ">
                ${time}
              </div>
            </div>
          </div>
        `;
        
        // Add hover effect to show time
        const messageBubble = msgEl.querySelector('.chat-message-bubble');
        if (messageBubble) {
          messageBubble.addEventListener('mouseenter', () => {
            const timeEl = msgEl.querySelector('.chat-message-time');
            if (timeEl) {
              timeEl.style.opacity = '1';
            }
          });
          messageBubble.addEventListener('mouseleave', () => {
            const timeEl = msgEl.querySelector('.chat-message-time');
            if (timeEl) {
              timeEl.style.opacity = '0';
            }
          });
        }
        
        fragment.appendChild(msgEl);
      });
    });

    // Append, prepend, or replace fragment
    if (prepend) {
      container.insertBefore(fragment, container.firstChild);
    } else if (append) {
      container.appendChild(fragment);
    } else {
      container.innerHTML = '';
      container.appendChild(fragment);
    }
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
        // Desktop More dropdown removed - no longer needed
        
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
        const tabsContCleanup = document.getElementById('tabs-cont');
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
          
          // Desktop More dropdown removed - no longer needed
          // Try data-sortable-id first, then fallback to data-tab-id
          const elementAtPoint = document.elementFromPoint(e.clientX, e.clientY);
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
                position: finalDropIndicator?.position || 'after'
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
        const spaceId = chatContainer?.dataset?.spaceId || this.activeSpace?.id;
        this.loadChatMessages(chatContainer, chatId, spaceId);
        
        // Mark as read after sending (user is actively viewing this chat)
        if (spaceId) {
          this.markChatAsReadIfVisible(spaceId);
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      alert('Failed to send message');
    }
  }
}

// Fix PWA height for iOS - force full screen height
function fixPWAHeight() {
  if (window.matchMedia('(display-mode: standalone)').matches && window.matchMedia('(max-width: 768px)').matches) {
    const correctHeight = screen.height + 'px';
    const bottomBarHeight = 72; // Height of mobile bottom bar
    
    // Set body to full screen height
    document.body.style.setProperty('height', correctHeight, 'important');
    
    // Set main container to full screen height
    const main = document.querySelector('.flex.h-screen');
    if (main) {
      main.style.setProperty('height', correctHeight, 'important');
    }
    
    // Ensure mobile views respect bottom bar space
    const mobileViews = ['mobile-projects-view', 'mobile-messenger-view'];
    mobileViews.forEach(id => {
      const view = document.getElementById(id);
      if (view) {
        view.style.setProperty('bottom', bottomBarHeight + 'px', 'important');
        view.style.setProperty('height', 'auto', 'important');
      }
    });
    
    console.log('✅ PWA height fixed to', screen.height, '- Content respects bottom bar');
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
        
        // Fix PWA height after initialization
        setTimeout(fixPWAHeight, 100);
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

