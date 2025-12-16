// SIMPLE MOBILE BOTTOM BAR - Rewritten for clarity and reliability
// This file contains a simplified version of the mobile bottom bar rendering and drag & drop

// Make it available globally
window.SimpleMobileBottomBar = class SimpleMobileBottomBar {
  constructor(lunaIntegration) {
    this.lunaIntegration = lunaIntegration;
    this.draggedElement = null;
    this.draggedData = null;
    this.isDragging = false;
  }

  // Simple render - just clear and rebuild
  render(isEditing = false) {
    const container = document.getElementById('mobile-tabs-container');
    const bottomBar = document.getElementById('mobile-bottom-bar');
    if (!container || !bottomBar) return;

    // ALWAYS clear container first to prevent duplicates
    container.innerHTML = '';

    // Get tabs
    const tabs = window.tabManager?.tabs || [];
    const personalTabs = tabs.filter(t => {
      const url = t.url || '';
      return url && url !== '/new' && url !== 'tabs://new' && !t.spaceId && !this.lunaIntegration.isChatUrl(url);
    });

    // Get which tabs are in More
    const moreTabIds = this.lunaIntegration.getMobileMoreTabIdsSync();
    const bottomBarTabs = personalTabs.filter(t => {
      const tId = String(t.backendId || t.id);
      return !moreTabIds.has(tId);
    });

    // Apply saved order if exists
    const savedOrder = this.lunaIntegration.getMobileBottomBarOrderSync();
    let visibleTabs = bottomBarTabs.slice(0, 3);
    
    if (savedOrder && savedOrder.length > 0) {
      // Reorder based on saved order (only tabs, ignore fixed buttons for now)
      const orderedTabs = [];
      const tabMap = new Map(visibleTabs.map(t => [String(t.backendId || t.id), t]));
      
      savedOrder.forEach(item => {
        if (item.type === 'tab') {
          const tab = tabMap.get(String(item.id));
          if (tab) {
            orderedTabs.push(tab);
            tabMap.delete(String(item.id));
          }
        }
      });
      
      // Add remaining tabs
      tabMap.forEach(tab => orderedTabs.push(tab));
      visibleTabs = orderedTabs.slice(0, 3);
    }

    // Render each tab
    visibleTabs.forEach(tab => {
      const tabItem = this.createTabItem(tab, isEditing);
      container.appendChild(tabItem);
    });
    
    // Store more tabs for More view
    this.lunaIntegration.mobileMoreTabs = personalTabs.filter(t => {
      const tId = String(t.backendId || t.id);
      return moreTabIds.has(tId);
    });

    // Setup drag & drop if editing
    if (isEditing) {
      this.setupDragAndDrop();
    } else {
      this.removeDragAndDrop();
    }

    // Always restore fixed button listeners
    // setupFixedButtonListeners() eliminado - ahora se maneja en renderMobileBottomBar()
    if (this.lunaIntegration) {
      this.lunaIntegration.renderMobileBottomBar();
    }
  }

  // Create a single tab item
  createTabItem(tab, isEditing) {
    const tabItem = document.createElement('div');
    tabItem.className = 'bottom-nav-item';
    tabItem.dataset.tabId = tab.id;
    if (tab.backendId) tabItem.dataset.backendId = tab.backendId;
    if (tab.active) tabItem.classList.add('active');

    // Get icon from tabTemplate
    const tabHtml = window.tabManager.tabTemplate(tab, !isEditing, false);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = tabHtml;
    const originalTab = wrapper.firstElementChild;
    const iconCircle = originalTab?.querySelector('.rounded-full');

    // Icon
    const iconDiv = document.createElement('div');
    iconDiv.className = 'icon';
    if (iconCircle) {
      const iconClone = iconCircle.cloneNode(true);
      iconClone.style.cssText = 'width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;';
      
      // Resize internal images/SVGs
      iconClone.querySelectorAll('img, svg').forEach(el => {
        el.style.maxWidth = '20px';
        el.style.maxHeight = '20px';
        el.style.width = 'auto';
        el.style.height = 'auto';
        if (el.tagName === 'IMG') el.style.objectFit = 'contain';
      });
      
      iconDiv.appendChild(iconClone);
    } else {
      // Fallback icon
      iconDiv.innerHTML = `<div style="width: 36px; height: 36px; border-radius: 50%; border: 1px solid #e8eaed; display: flex; align-items: center; justify-content: center;">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"></rect>
        </svg>
      </div>`;
    }

    // Label
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = tab.title || 'Tab';

    tabItem.appendChild(iconDiv);
    tabItem.appendChild(label);

    // Three dots button if editing
    if (isEditing) {
      const threeDots = document.createElement('button');
      threeDots.className = 'mobile-tab-menu-btn';
      threeDots.style.cssText = 'position: absolute; top: 4px; right: 4px; padding: 2px; opacity: 0.7; z-index: 1000; background: rgba(255, 255, 255, 0.9); border-radius: 50%; border: 1px solid rgba(0,0,0,0.1); cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 2px rgba(0,0,0,0.1); pointer-events: auto; width: 20px; height: 20px;';
      threeDots.dataset.tabId = tab.id;
      if (tab.backendId) threeDots.dataset.backendId = tab.backendId;
      threeDots.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #5f6368;">
        <circle cx="12" cy="12" r="1"></circle>
        <circle cx="12" cy="5" r="1"></circle>
        <circle cx="12" cy="19" r="1"></circle>
      </svg>`;
      
      threeDots.addEventListener('click', async (e) => {
        e.stopPropagation();
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
            const response = await this.lunaIntegration.request(`/api/tabs/${tab.backendId}`);
            if (response?.tab) {
              this.lunaIntegration.showTabMenu(e, response.tab);
              return;
            }
          } catch (err) {}
        }
        this.lunaIntegration.showTabMenu(e, tabData);
      }, true);
      
      tabItem.appendChild(threeDots);
    }

    // Click handler
    tabItem.addEventListener('click', (e) => {
      if (e.target.closest('.mobile-tab-menu-btn')) return;
      const bottomBar = document.getElementById('mobile-bottom-bar');
      if (bottomBar?.classList.contains('editing')) {
        e.preventDefault();
        return;
      }
      if (window.tabManager) {
        window.tabManager.activate(tab.id);
        if (window.mobileUI?.hideAll) window.mobileUI.hideAll();
      }
    });

    return tabItem;
  }

  // Simple drag & drop using event delegation
  setupDragAndDrop() {
    const bottomBar = document.getElementById('mobile-bottom-bar');
    if (!bottomBar || !bottomBar.classList.contains('editing')) return;

    // Remove old listeners
    this.removeDragAndDrop();

    // Use event delegation on the bottom bar itself
    bottomBar.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    bottomBar.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    bottomBar.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
  }

  removeDragAndDrop() {
    const bottomBar = document.getElementById('mobile-bottom-bar');
    if (!bottomBar) return;
    
    // Clone to remove all listeners
    const newBottomBar = bottomBar.cloneNode(true);
    bottomBar.parentNode.replaceChild(newBottomBar, bottomBar);
    
    // Restore fixed button listeners
    // setupFixedButtonListeners() eliminado - ahora se maneja en renderMobileBottomBar()
    if (this.lunaIntegration) {
      this.lunaIntegration.renderMobileBottomBar();
    }
  }

  handleTouchStart(e) {
    const item = e.target.closest('.bottom-nav-item');
    if (!item) return;
    
    const bottomBar = document.getElementById('mobile-bottom-bar');
    if (!bottomBar?.classList.contains('editing')) return;
    
    if (e.target.closest('.mobile-tab-menu-btn')) return;
    
    e.preventDefault();
    this.isDragging = true;
    this.draggedElement = item;
    
    const tabId = item.dataset.tabId;
    if (tabId) {
      const tabs = window.tabManager?.tabs || [];
      const tab = tabs.find(t => String(t.id) === String(tabId));
      this.draggedData = { type: 'tab', tab: tab };
    } else if (item.dataset.fixedButton) {
      this.draggedData = { type: 'fixed', id: item.dataset.fixedButton };
    }
    
    item.classList.add('dragging');
    item.style.opacity = '0.5';
  }

  handleTouchMove(e) {
    if (!this.isDragging || !this.draggedElement) return;
    
    const bottomBar = document.getElementById('mobile-bottom-bar');
    if (!bottomBar?.classList.contains('editing')) {
      this.cancelDrag();
      return;
    }
    
    e.preventDefault();
    const touch = e.touches[0];
    const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetItem = elementBelow?.closest('.bottom-nav-item');
    
    if (targetItem && targetItem !== this.draggedElement) {
      const allItems = Array.from(bottomBar.querySelectorAll('.bottom-nav-item'));
      const draggedIndex = allItems.indexOf(this.draggedElement);
      const targetIndex = allItems.indexOf(targetItem);
      
      if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
        if (draggedIndex < targetIndex) {
          targetItem.parentNode.insertBefore(this.draggedElement, targetItem.nextSibling);
        } else {
          targetItem.parentNode.insertBefore(this.draggedElement, targetItem);
        }
      }
    }
  }

  handleTouchEnd(e) {
    if (!this.isDragging || !this.draggedElement) return;
    
    e.preventDefault();
    const touch = e.changedTouches[0];
    const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    const moreBtn = elementBelow?.closest('#mobile-nav-more');
    
    if (moreBtn && this.draggedData?.type === 'tab' && this.draggedData?.tab) {
      this.lunaIntegration.moveTabToMobileMore(this.draggedData.tab).then(() => {
        this.render(true); // Re-render in editing mode
        this.lunaIntegration.renderMore(false, 'mobile');
      });
    } else {
      this.lunaIntegration.saveMobileBottomBarOrder();
    }
    
    this.cancelDrag();
  }

  cancelDrag() {
    if (this.draggedElement) {
      this.draggedElement.classList.remove('dragging');
      this.draggedElement.style.opacity = '';
    }
    this.draggedElement = null;
    this.draggedData = null;
    this.isDragging = false;
  }
};

