import { useState, useEffect } from 'react';
import { Users, Plus, MessageCircle, UserCircle } from 'lucide-react';
import api from '../../utils/api';

export default function UsersList({ activeSpace, onSelect }) {
  const [spaces, setSpaces] = useState([]);
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSpaces();
  }, []);

  // Reload spaces when activeSpace changes to ensure we have the latest list
  useEffect(() => {
    if (activeSpace?.category === 'user') {
      loadSpaces();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSpace?.id]);

  const loadSpaces = async () => {
    try {
      const { spaces } = await api.getSpaces('user');
      setSpaces(spaces || []);
    } catch (err) {
      console.error('Failed to load user spaces:', err);
    }
  };

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { users } = await api.getUsers();
      setAvailableUsers(users || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleShowPicker = () => {
    setShowUserPicker(true);
    loadUsers();
  };

  const handleSelectUser = async (user) => {
    try {
      // First, reload spaces to make sure we have the latest list
      await loadSpaces();
      
      // Search for existing DM - check by name, email, display_name, or other_user_id
      const existingDM = spaces.find(
        s => 
          s.name === user.name || 
          s.name === user.email || 
          s.display_name === user.name ||
          s.display_name === user.email ||
          s.other_user_id === user.id ||
          (s.owner && s.owner.id === user.id) ||
          (s.user_id === user.id && s.category === 'user')
      );
      
      if (existingDM) {
        onSelect(existingDM);
        setShowUserPicker(false);
        return;
      }

      // The backend will check for existing spaces/chats before creating
      const { space } = await api.createSpace({
        name: user.name || user.email,
        category: 'user'
      });

      // Reload spaces to update the list
      await loadSpaces();
      
      // Use the space returned by backend - it's either existing or newly created
      onSelect(space);
      setShowUserPicker(false);
    } catch (err) {
      console.error('Failed to create DM:', err);
    }
  };

  const currentUser = api.getUser();
  const currentUserId = currentUser?.id;

  const getDisplayName = (space) => {
    const name = space.display_name || space.name;
    // Check if this is a self-reference (user's own space)
    if (space.user_id === currentUserId && space.category === 'user') {
      return `${name} (you)`;
    }
    return name;
  };

  const filteredUsers = availableUsers.filter(user => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      user.name?.toLowerCase().includes(q) ||
      user.email?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="py-1 mt-4">
      <div className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        <span>Direct Messages</span>
        <button
          onClick={handleShowPicker}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
          title="New Message"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="px-2 space-y-0.5">
        {spaces.map((space) => (
          <div
            key={space.id}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
              activeSpace?.id === space.id ? 'bg-blue-100 text-blue-600 font-medium shadow-sm' : 'text-gray-700 hover:bg-gray-100'
            }`}
            onClick={() => onSelect(space)}
          >
            <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-medium flex-shrink-0 overflow-hidden">
              {space.other_user_photo ? (
                <img src={space.other_user_photo} alt="" className="w-full h-full object-cover" />
              ) : (
                <span>{getDisplayName(space)[0]?.toUpperCase() || 'U'}</span>
              )}
            </div>
            <span className="flex-1 text-sm truncate">{getDisplayName(space)}</span>
          </div>
        ))}

        {showUserPicker ? (
          <div className="mt-2 bg-white border border-gray-200 rounded-lg overflow-hidden">
            <input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent border-b border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none"
              autoFocus
            />
            <div className="max-h-40 overflow-y-auto">
              {loading ? (
                <div className="px-3 py-2 text-sm text-gray-500">Loading...</div>
              ) : filteredUsers.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">No users found</div>
              ) : (
                filteredUsers.map(user => {
                  const isCurrentUser = user.id === currentUserId;
                  return (
                    <button
                      key={user.id}
                      onClick={() => handleSelectUser(user)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors text-left"
                    >
                      <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-xs font-medium text-white overflow-hidden flex-shrink-0">
                        {user.avatar_photo ? (
                          <img src={user.avatar_photo} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span>{(user.name || user.email)[0].toUpperCase()}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          {user.name || user.email}
                          {isCurrentUser && <span className="text-gray-500 ml-1">(you)</span>}
                        </div>
                        {user.name && (
                          <div className="text-xs text-gray-500 truncate">{user.email}</div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            <button
              onClick={() => {
                setShowUserPicker(false);
                setSearchQuery('');
              }}
              className="w-full px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border-t border-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}




