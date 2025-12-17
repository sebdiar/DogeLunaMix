import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function SortableItem({
  id,
  children,
  isActive,
  onSelect,
  dropIndicator,
  isDraggingActive,
  depth = 0,
  className = '',
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id,
    animateLayoutChanges: () => false,
  });

  const style = {
    transform: isDraggingActive ? 'translate3d(0, 0, 0)' : CSS.Transform.toString(transform),
    transition: isDraggingActive ? 'none' : transition,
    opacity: isDragging ? 0.3 : 1,
    marginLeft: `${depth * 16}px`,
  };

  const showDropBefore = dropIndicator?.targetId === id && dropIndicator?.position === 'before';
  const showDropAfter = dropIndicator?.targetId === id && dropIndicator?.position === 'after';
  const showDropInside = dropIndicator?.targetId === id && dropIndicator?.position === 'inside';

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="relative" data-sortable-id={id}>
      {showDropBefore && (
        <div className="absolute -top-px left-0 right-0 h-0.5 bg-blue-500 z-20" style={{ marginLeft: `${depth * 16}px` }} />
      )}

      <div
        {...listeners}
        onClick={() => onSelect && onSelect()}
        className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer ${
          showDropInside ? '' : 'transition-all'
        } ${
          isActive ? 'bg-blue-100 text-blue-600 font-medium shadow-sm' : 'text-gray-700 hover:bg-gray-100'
        } ${showDropInside ? 'bg-blue-200' : ''} ${className}`}
      >
        {children}
      </div>

      {showDropAfter && (
        <div className="absolute -bottom-px left-0 right-0 h-0.5 bg-blue-500 z-20" style={{ marginLeft: `${depth * 16}px` }} />
      )}
    </div>
  );
}

















