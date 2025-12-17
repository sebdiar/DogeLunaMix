import { useState, useEffect, useRef } from 'react';

export function useDragAndDrop({ items, onReorder, allowHierarchy = false }) {
  const [activeId, setActiveId] = useState(null);
  const [dropIndicator, setDropIndicator] = useState(null);
  const mouseYRef = useRef(0);

  useEffect(() => {
    const handleMouseMove = (e) => {
      mouseYRef.current = e.clientY;
    };
    
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragMove = (event) => {
    const { active, over } = event;
    
    if (!over || over.id === active.id) {
      setDropIndicator(null);
      return;
    }
    
    const overElement = document.querySelector(`[data-sortable-id="${over.id}"]`);
    if (!overElement) {
      setDropIndicator(null);
      return;
    }
    
    const overRect = overElement.getBoundingClientRect();
    const mouseY = mouseYRef.current;
    const relativeY = mouseY - overRect.top;
    const percentage = (relativeY / overRect.height) * 100;
    
    const targetItem = items.find(s => s.id === over.id);
    
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
    
    setDropIndicator({ targetId: over.id, position });
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    
    const currentIndicator = dropIndicator;
    setActiveId(null);
    setDropIndicator(null);
    
    if (!over || active.id === over.id) return;
    
    const draggedItem = items.find(s => s.id === active.id);
    const targetItem = items.find(s => s.id === over.id);
    
    if (!draggedItem || !targetItem) return;
    
    let position = currentIndicator?.position || 'before';
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
  };

  return {
    activeId,
    dropIndicator,
    handleDragStart,
    handleDragMove,
    handleDragEnd
  };
}

















