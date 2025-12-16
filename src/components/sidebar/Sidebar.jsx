import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, LogOut } from 'lucide-react';
import api from '../../utils/api';
import TabsList from './TabsList';
import ProjectsList from './ProjectsList';
import UsersList from './UsersList';

export default function Sidebar({
  width,
  onWidthChange,
  onResizeStart,
  onResizeEnd,
  activeSpace,
  onSpaceSelect,
  onSpaceClose,
  onBookmarkSelect,
  activeTab
}) {
  const navigate = useNavigate();
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef(null);
  const user = api.getUser();

  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsResizing(true);
    onResizeStart?.();

    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (e) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(200, Math.min(400, startWidth + delta));
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      onResizeEnd?.();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleLogout = () => {
    api.logout();
    navigate('/login');
  };

  return (
    <div
      ref={sidebarRef}
      className="h-screen flex flex-col relative bg-gray-50 border-r border-gray-200"
      style={{ width: `${width}px`, minWidth: 200, maxWidth: 400 }}
    >
      <div
        className={`absolute top-0 right-0 h-full w-1 cursor-col-resize transition-colors hover:bg-blue-400 ${
          isResizing ? 'bg-blue-500' : ''
        }`}
        onMouseDown={handleMouseDown}
        style={{ zIndex: 100 }}
      />

      <div className="h-full flex flex-col bg-white rounded-r-2xl shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">DogeUB</span>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          <TabsList
            onSelect={onBookmarkSelect}
            activeTab={activeTab}
            activeSpace={activeSpace}
          />

          <ProjectsList
            activeSpace={activeSpace}
            onSelect={onSpaceSelect}
          />

          <UsersList
            activeSpace={activeSpace}
            onSelect={onSpaceSelect}
          />
        </div>

        <div className="p-3 space-y-1 border-t border-gray-200">
          <button
            onClick={() => navigate('/settings')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all text-sm"
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>

          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-100 transition-all cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-sm font-medium flex-shrink-0 overflow-hidden">
              {user?.avatar_photo ? (
                <img src={user.avatar_photo} alt="" className="w-full h-full object-cover" />
              ) : (
                <span>{(user?.name || user?.email || 'U')[0].toUpperCase()}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-900 font-medium truncate">{user?.name || user?.email}</div>
              <div className="text-xs text-gray-500">Online</div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-gray-500 hover:text-red-500 transition-colors rounded-lg"
              title="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}














