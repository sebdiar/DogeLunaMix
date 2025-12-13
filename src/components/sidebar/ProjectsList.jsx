import { useState, useEffect } from 'react';
import { FolderKanban, Plus, MoreHorizontal, Trash2, Edit2, Image, Users, ChevronRight, ChevronDown } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import api from '../../utils/api';
import TabAvatarEditor from './TabAvatarEditor';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import SortableItem from './SortableItem';

export default function ProjectsList({ activeSpace, onSelect }) {
  const [spaces, setSpaces] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [menuOpen, setMenuOpen] = useState(null);
  const [editingSpace, setEditingSpace] = useState(null);
  const [editingAvatar, setEditingAvatar] = useState(null);

  useEffect(() => {
    loadSpaces();
  }, []);

  const loadSpaces = async () => {
    try {
      const { spaces } = await api.getSpaces('project');
      setSpaces(spaces || []);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      const { space } = await api.createSpace({
        name: newName.trim(),
        category: 'project'
      });
      setSpaces([...spaces, space]);
      setNewName('');
      setShowNew(false);
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.deleteSpace(id);
      setSpaces(spaces.filter(s => s.id !== id));
      setMenuOpen(null);
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      const { space } = await api.updateSpace(id, data);
      setSpaces(spaces.map(s => s.id === id ? space : s));
      setEditingSpace(null);
    } catch (err) {
      console.error('Failed to update project:', err);
    }
  };

  const handleSaveAvatar = async (avatarData) => {
    if (!editingAvatar) return;
    try {
      await handleUpdate(editingAvatar.id, {
        avatar_emoji: avatarData.emoji,
        avatar_color: avatarData.color,
        avatar_photo: avatarData.photo
      });
      setEditingAvatar(null);
    } catch (err) {
      console.error('Failed to update avatar:', err);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const { activeId, dropIndicator, handleDragStart, handleDragMove, handleDragEnd: handleDragEndHook } = useDragAndDrop({
    items: spaces,
    allowHierarchy: true,
    onReorder: async ({ draggedId, targetId, position, targetParentId }) => {
      try {
        await api.reorderSpaces(draggedId, targetId, position, targetParentId);
        await loadSpaces();
      } catch (err) {
        console.error('Failed to update project hierarchy:', err);
      }
    }
  });

  const handleToggleExpanded = async (spaceId) => {
    const space = spaces.find(s => s.id === spaceId);
    if (!space) return;
    
    try {
      await api.updateSpace(spaceId, {
        is_expanded: !space.is_expanded
      });
      setSpaces(spaces.map(s => s.id === spaceId ? { ...s, is_expanded: !s.is_expanded } : s));
    } catch (err) {
      console.error('Failed to toggle expanded:', err);
    }
  };

  const buildTree = () => {
    const roots = spaces.filter(s => !s.parent_id);
    const children = spaces.filter(s => s.parent_id);
    
    const tree = [];
    
    const addChildren = (parent, depth = 0) => {
      tree.push({ ...parent, depth });
      
      if (parent.is_expanded) {
        const kids = children.filter(c => c.parent_id === parent.id);
        kids.forEach(kid => addChildren(kid, depth + 1));
      }
    };
    
    roots.forEach(root => addChildren(root));
    return tree;
  };

  const hierarchicalSpaces = buildTree();

  return (
    <div className="py-1 mt-4">
      <div className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        <span>Projects</span>
        <button
          onClick={() => setShowNew(true)}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
          title="New Project"
        >
          <Plus size={14} />
        </button>
      </div>

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
        <SortableContext items={hierarchicalSpaces.map(s => s.id)} strategy={verticalListSortingStrategy}>
          <div className="px-2 space-y-0.5" data-dnd-container>
            {hierarchicalSpaces.map((space) => {
              const hasChildren = spaces.some(s => s.parent_id === space.id);
              
              return (
                <SortableItem
                  key={space.id}
                  id={space.id}
                  depth={space.depth}
                  isActive={activeSpace?.id === space.id}
                  onSelect={() => onSelect(space)}
                  dropIndicator={dropIndicator}
                  isDraggingActive={!!activeId}
                >
                  {hasChildren ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleExpanded(space.id);
                      }}
                      className="p-0.5 hover:bg-gray-100 rounded transition-colors z-10"
                    >
                      {space.is_expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  ) : (
                    <div className="w-5" />
                  )}

                  {editingSpace === space.id ? (
                    <input
                      type="text"
                      defaultValue={space.name}
                      className="flex-1 bg-gray-50 border border-gray-300 rounded px-2 py-0.5 text-sm text-gray-900 focus:outline-none"
                      autoFocus
                      onBlur={(e) => handleUpdate(space.id, { name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdate(space.id, { name: e.target.value });
                        if (e.key === 'Escape') setEditingSpace(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ 
                          border: space.avatar_color ? `1px solid ${space.avatar_color}` : '1px solid #e5e7eb',
                          color: space.avatar_color || '#6b7280'
                        }}
                      >
                        {space.avatar_photo ? (
                          <img src={space.avatar_photo} alt="" className="w-full h-full rounded-full object-cover" />
                        ) : space.avatar_emoji ? (
                          <span className="text-sm">{space.avatar_emoji}</span>
                        ) : (
                          <Users size={14} />
                        )}
                      </div>
                      
                      <span className="flex-1 text-sm truncate">{space.name}</span>

                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpen(menuOpen === space.id ? null : space.id);
                          }}
                          className="p-0.5 opacity-0 group-hover:opacity-100 hover:text-gray-900 transition-opacity"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        
                        {menuOpen === space.id && (
                          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingAvatar(space);
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
                                setEditingSpace(space.id);
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
                                handleDelete(space.id);
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
              );
            })}

            {showNew ? (
              <form onSubmit={handleCreate} className="mt-2">
                <input
                  type="text"
                  placeholder="Project name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowNew(false);
                      setNewName('');
                    }
                  }}
                />
              </form>
            ) : null}
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeId ? (
            <div className="opacity-60 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2.5">
              <div className="flex items-center gap-3">
                <Users size={14} className="text-gray-500" />
                <span className="text-sm text-gray-700">
                  {spaces.find(s => s.id === activeId)?.name || 'Project'}
                </span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

