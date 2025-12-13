import { useState, useEffect } from 'react';
import { Bookmark, Plus, MoreHorizontal, Trash2, Edit2, Image, FileText } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import api from '../../utils/api';
import NewTabModal from './NewTabModal';
import TabAvatarEditor from './TabAvatarEditor';
import { getFaviconUrl } from '../../utils/favicon';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import SortableItem from './SortableItem';

export default function TabsList({ onSelect, activeTab, activeSpace }) {
  const [tabs, setTabs] = useState([]);
  const [showNewTabModal, setShowNewTabModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(null);
  const [editingTab, setEditingTab] = useState(null);
  const [editingAvatar, setEditingAvatar] = useState(null);

  useEffect(() => {
    loadTabs();
  }, []);

  const loadTabs = async () => {
    try {
      const { tabs } = await api.getTabs();
      setTabs(tabs || []);
    } catch (err) {
      console.error('Failed to load tabs:', err);
    }
  };

  const handleCreateTab = async (tabData) => {
    try {
      const { tab } = await api.createTab({
        title: tabData.title,
        url: tabData.url || 'https://www.google.com',
        type: tabData.type || 'browser',
        metadata: tabData.type === 'ai-dashboard' ? { prompt: tabData.prompt } : null
      });
      setTabs([...tabs, tab]);
    } catch (err) {
      console.error('Failed to create tab:', err);
    }
  };

  const handleDeleteTab = async (id) => {
    try {
      await api.deleteTab(id);
      setTabs(tabs.filter(t => t.id !== id));
      setMenuOpen(null);
    } catch (err) {
      console.error('Failed to delete tab:', err);
    }
  };

  const handleUpdateTab = async (id, data) => {
    try {
      const { tab } = await api.updateTab(id, data);
      setTabs(tabs.map(t => t.id === id ? tab : t));
      setEditingTab(null);
    } catch (err) {
      console.error('Failed to update tab:', err);
    }
  };

  const handleSaveAvatar = async (avatarData) => {
    if (!editingAvatar) return;
    try {
      await handleUpdateTab(editingAvatar.id, {
        avatar_emoji: avatarData.emoji,
        avatar_color: avatarData.color,
        avatar_photo: avatarData.photo
      });
      setEditingAvatar(null);
    } catch (err) {
      console.error('Failed to update avatar:', err);
    }
  };

  const isActive = (tab) => !activeSpace && activeTab?.id === tab.id;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const { activeId, dropIndicator, handleDragStart, handleDragMove, handleDragEnd: handleDragEndHook } = useDragAndDrop({
    items: tabs,
    allowHierarchy: false,
    onReorder: async ({ draggedId, targetId, position }) => {
      try {
        const oldIndex = tabs.findIndex((tab) => tab.id === draggedId);
        const newIndex = tabs.findIndex((tab) => tab.id === targetId);
        
        let finalIndex = newIndex;
        if (position === 'after') {
          finalIndex = newIndex + 1;
        }
        
        const newTabs = arrayMove(tabs, oldIndex, finalIndex);
        setTabs(newTabs);
        
        const updates = newTabs.map((tab, index) => ({
          id: tab.id,
          position: index,
          parent_id: null
        }));
        await api.reorderTabs(updates);
      } catch (err) {
        console.error('Failed to reorder tabs:', err);
      }
    }
  });

  return (
    <div className="py-1">
      <div className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        <span>Tabs</span>
        <button
          onClick={() => setShowNewTabModal(true)}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
          title="New Tab"
        >
          <Plus size={14} />
        </button>
      </div>

      <NewTabModal
        isOpen={showNewTabModal}
        onClose={() => setShowNewTabModal(false)}
        onCreate={handleCreateTab}
      />

      <TabAvatarEditor
        isOpen={!!editingAvatar}
        onClose={() => setEditingAvatar(null)}
        onSave={handleSaveAvatar}
        initialData={editingAvatar ? {
          emoji: editingAvatar.avatar_emoji,
          color: editingAvatar.avatar_color,
          photo: editingAvatar.avatar_photo
        } : {}}
      />

      <DndContext 
        sensors={sensors} 
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEndHook}
      >
        <SortableContext items={tabs.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <div className="px-2 space-y-0.5">
            {tabs.map((tab) => (
              <SortableItem
                key={tab.id}
                id={tab.id}
                isActive={isActive(tab)}
                onSelect={() => onSelect(tab)}
                dropIndicator={dropIndicator}
                isDraggingActive={!!activeId}
              >
                {editingTab === tab.id ? (
                  <input
                    type="text"
                    defaultValue={tab.title}
                    className="flex-1 bg-gray-50 border border-gray-300 rounded px-2 py-0.5 text-sm text-gray-900 focus:outline-none"
                    autoFocus
                    onBlur={(e) => handleUpdateTab(tab.id, { title: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleUpdateTab(tab.id, { title: e.target.value });
                      if (e.key === 'Escape') setEditingTab(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ 
                        border: tab.avatar_color ? `1px solid ${tab.avatar_color}` : '1px solid #e5e7eb',
                        color: tab.avatar_color || '#6b7280'
                      }}
                    >
                      {tab.avatar_photo ? (
                        <img src={tab.avatar_photo} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : tab.avatar_emoji ? (
                        <span className="text-sm">{tab.avatar_emoji}</span>
                      ) : tab.url && !tab.url.startsWith('luna://') && !tab.url.startsWith('doge://') ? (
                        <img 
                          src={getFaviconUrl(tab.url)} 
                          alt="" 
                          className="w-4 h-4 object-contain"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            if (e.target.nextSibling) e.target.nextSibling.style.display = 'block';
                          }}
                        />
                      ) : null}
                      <FileText size={14} style={{ display: (tab.avatar_photo || tab.avatar_emoji || (tab.url && !tab.url.startsWith('luna://') && !tab.url.startsWith('doge://'))) ? 'none' : 'block' }} />
                    </div>
                    
                    <span className="flex-1 text-sm truncate">{tab.title}</span>
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(menuOpen === tab.id ? null : tab.id);
                        }}
                        className="p-0.5 opacity-0 group-hover:opacity-100 hover:text-gray-900 transition-opacity"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      
                      {menuOpen === tab.id && (
                        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingAvatar(tab);
                              setMenuOpen(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                          >
                            <Image size={14} />
                            <span>Edit icon</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTab(tab.id);
                              setMenuOpen(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                          >
                            <Edit2 size={14} />
                            <span>Rename</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteTab(tab.id);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={14} />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </SortableItem>
            ))}
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeId ? (
            <div className="opacity-60 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2.5">
              <div className="flex items-center gap-3">
                <FileText size={14} className="text-gray-500" />
                <span className="text-sm text-gray-700">
                  {tabs.find(t => t.id === activeId)?.title || 'Tab'}
                </span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

