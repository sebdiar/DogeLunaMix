import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';

export default function ContentArea({ activeSpace, activeTab, spaceTabs, onSpaceTabSelect }) {
  const [currentUrl, setCurrentUrl] = useState('tabs://new');
  const [chatData, setChatData] = useState(null);

  useEffect(() => {
    if (activeTab) {
      // Handle different tab types
      if (activeTab.url?.startsWith('luna://chat/') || activeTab.url?.startsWith('doge://chat/')) {
        // Load chat
        const spaceId = activeTab.url.split('/').pop();
        loadChat(spaceId);
      } else if (activeTab.type === 'ai-dashboard') {
        // AI Dashboard - placeholder for now
        setCurrentUrl('doge://ai-dashboard');
      } else if (activeTab.url) {
        // Regular browser tab
        setCurrentUrl(activeTab.url);
      }
    } else if (activeSpace && spaceTabs.length > 0) {
      // If space is selected but no tab, select first tab (usually Chat)
      const firstTab = spaceTabs[0];
      onSpaceTabSelect(firstTab);
      if (firstTab.url?.startsWith('luna://chat/') || firstTab.url?.startsWith('doge://chat/')) {
        const spaceId = firstTab.url.split('/').pop();
        loadChat(spaceId);
      } else if (firstTab.url) {
        setCurrentUrl(firstTab.url);
      }
    } else {
      // Default new tab page
      setCurrentUrl('tabs://new');
    }
  }, [activeTab, activeSpace, spaceTabs, onSpaceTabSelect]);

  const loadChat = async (spaceId) => {
    try {
      const data = await api.getChatForSpace(spaceId);
      setChatData(data);
      setCurrentUrl(`doge://chat/${spaceId}`);
    } catch (err) {
      console.error('Failed to load chat:', err);
    }
  };

  // If it's a chat, render chat UI
  if (currentUrl?.startsWith('doge://chat/') || currentUrl?.startsWith('luna://chat/')) {
    return (
      <div className="flex-1 flex flex-col bg-white">
        <ChatComponent chatData={chatData} />
      </div>
    );
  }

  // If it's AI Dashboard, render placeholder
  if (currentUrl === 'doge://ai-dashboard') {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">AI Dashboard</h2>
          <p className="text-gray-600">Coming soon...</p>
        </div>
      </div>
    );
  }

  // Regular browser iframe
  return (
    <div className="flex-1 flex flex-col bg-white">
      <iframe
        src={`/src/static/loader.html${currentUrl && currentUrl !== 'tabs://new' ? `?url=${encodeURIComponent(currentUrl)}` : ''}`}
        className="flex-1 w-full border-none"
        title="Browser"
      />
    </div>
  );
}

function ChatComponent({ chatData }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const loadMessages = useCallback(async (chatId, showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      
      const { messages: newMessages } = await api.getMessages(chatId);
      setMessages(newMessages || []);
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (chatData?.chat?.id) {
      loadMessages(chatData.chat.id, true); // Show loading on initial load
    }
  }, [chatData?.chat?.id, loadMessages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !chatData?.chat?.id) return;

    const messageText = newMessage.trim();
    setNewMessage(''); // Clear input immediately for better UX

    try {
      await api.sendMessage(chatData.chat.id, messageText);
      // Reload messages after sending (Realtime will update automatically)
      // Small delay to ensure message is saved
      setTimeout(() => {
        loadMessages(chatData.chat.id);
      }, 200);
    } catch (err) {
      console.error('Failed to send message:', err);
      setNewMessage(messageText); // Restore message on error
    }
  };

  const user = api.getUser();
  
  // #region agent log
  useEffect(() => {
    const logData = {location:'ContentArea.jsx:132',message:'User data loaded',data:{userId:user?.id,userName:user?.name,userEmail:user?.email,userAvatarPhoto:user?.avatar_photo,userHasAvatar:!!user?.avatar_photo},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
    console.log('DEBUG A - User data:', logData);
    fetch('http://127.0.0.1:7242/ingest/666869cb-9251-4224-9e7d-37070918adfc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(err=>console.error('Log fetch failed:',err));
  }, [user]);
  // #endregion
  
  // #region agent log
  useEffect(() => {
    if (messages.length > 0) {
      const logData = {location:'ContentArea.jsx:138',message:'Messages loaded',data:{messageCount:messages.length,messages:messages.map(m=>({id:m.id,userId:m.user_id,userAvatarPhoto:m.user?.avatar_photo,userName:m.user?.name,hasUserData:!!m.user})),currentUserId:user?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'};
      console.log('DEBUG B - Messages data:', logData);
      fetch('http://127.0.0.1:7242/ingest/666869cb-9251-4224-9e7d-37070918adfc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(err=>console.error('Log fetch failed:',err));
    }
  }, [messages, user]);
  // #endregion

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="text-center text-gray-500">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-500">No messages yet. Start the conversation!</div>
        ) : (
          messages.map((msg) => {
            // Detect if message is a system message (member added/removed notifications)
            const isSystemMessage = msg.message?.includes('agregó a') || msg.message?.includes('eliminó a');
            
            // System messages are displayed differently (centered, gray, smaller, less opacity, no user info)
            if (isSystemMessage) {
              return (
                <div key={msg.id} className="flex justify-center my-1">
                  <div className="text-xs text-gray-400 opacity-70 text-center px-3 py-1.5 max-w-md">
                    {msg.message}
                  </div>
                </div>
              );
            }
            
            // Regular user messages
            const isOwn = msg.user_id === user?.id;
            const userAvatar = msg.user?.avatar_photo || msg.user?.avatar_url;
            const userName = msg.user?.name || msg.user?.email || 'Unknown';
            const userInitials = userName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
            const currentUserInitials = user ? ((user.name || user.email || 'U').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)) : 'U';
            
            // #region agent log
            const logData = {location:'ContentArea.jsx:175',message:'Rendering message avatar',data:{msgId:msg.id,isOwn,userAvatar:!!userAvatar,userAvatarValue:userAvatar,userName,userHasAvatarPhoto:!!user?.avatar_photo,currentUserAvatar:user?.avatar_photo,msgUser:msg.user,currentUser:user,willRenderOtherAvatar:!isOwn,willRenderOwnAvatar:isOwn},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
            console.log('DEBUG C - Rendering message:', logData);
            fetch('http://127.0.0.1:7242/ingest/666869cb-9251-4224-9e7d-37070918adfc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(err=>console.error('Log fetch failed:',err));
            // #endregion
            
            return (
              <div
                key={msg.id}
                className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
                style={{ display: 'flex' }}
              >
                {/* Avatar para mensajes de otros usuarios (izquierda) */}
                {!isOwn && (
                  <div 
                    className="rounded-full bg-gray-300 flex-shrink-0 flex items-center justify-center overflow-hidden border border-gray-400" 
                    style={{ 
                      width: '32px', 
                      height: '32px',
                      minWidth: '32px', 
                      minHeight: '32px',
                      position: 'relative'
                    }}
                    // #region agent log
                    ref={(el) => {
                      if (el) {
                        const logData = {location:'ContentArea.jsx:187',message:'Other user avatar rendered',data:{msgId:msg.id,isVisible:el.offsetParent!==null,hasAvatar:!!userAvatar,computedStyle:window.getComputedStyle(el).display,width:el.offsetWidth,height:el.offsetHeight},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'};
                        console.log('DEBUG D - Other avatar DOM:', logData);
                        fetch('http://127.0.0.1:7242/ingest/666869cb-9251-4224-9e7d-37070918adfc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(err=>console.error('Log fetch failed:',err));
                      }
                    }}
                    // #endregion
                  >
                    {userAvatar ? (
                      <>
                        <img 
                          src={userAvatar} 
                          alt={userName} 
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', position: 'absolute', top: 0, left: 0 }}
                          onError={(e) => {
                            console.log('Avatar image failed to load:', userAvatar);
                            e.target.style.display = 'none';
                            const initialsSpan = e.target.parentElement?.querySelector('.avatar-initials');
                            if (initialsSpan) {
                              initialsSpan.style.display = 'block';
                            }
                          }}
                        />
                        <span 
                          className="avatar-initials"
                          style={{ 
                            fontSize: '12px', 
                            lineHeight: '1', 
                            color: '#4B5563', 
                            fontWeight: '500',
                            display: 'none',
                            position: 'relative',
                            zIndex: 1
                          }}
                        >
                          {userInitials}
                        </span>
                      </>
                    ) : (
                      <span 
                        style={{ 
                          fontSize: '12px', 
                          lineHeight: '1', 
                          color: '#4B5563', 
                          fontWeight: '500'
                        }}
                      >
                        {userInitials}
                      </span>
                    )}
                  </div>
                )}
                
                {/* Burbuja del mensaje */}
                <div
                  className={`max-w-md px-4 py-2 rounded-lg ${
                    isOwn
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                  style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
                >
                  {!isOwn && (
                    <div className="text-sm font-medium mb-1">
                      {userName}
                    </div>
                  )}
                  <div className="text-sm select-text">{msg.message}</div>
                  <div className={`text-xs mt-1 ${isOwn ? 'text-blue-100' : 'text-gray-500'}`}>
                    {new Date(msg.created_at).toLocaleTimeString()}
                  </div>
                </div>
                
                {/* Avatar para mensajes propios (derecha) */}
                {isOwn && (
                  <div 
                    className="rounded-full bg-blue-500 flex-shrink-0 flex items-center justify-center overflow-hidden border border-blue-600" 
                    style={{ 
                      width: '32px', 
                      height: '32px',
                      minWidth: '32px', 
                      minHeight: '32px',
                      position: 'relative'
                    }}
                    // #region agent log
                    ref={(el) => {
                      if (el) {
                        const logData = {location:'ContentArea.jsx:245',message:'Own avatar rendered',data:{msgId:msg.id,isVisible:el.offsetParent!==null,hasAvatar:!!user?.avatar_photo,computedStyle:window.getComputedStyle(el).display,width:el.offsetWidth,height:el.offsetHeight},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'};
                        console.log('DEBUG D - Own avatar DOM:', logData);
                        fetch('http://127.0.0.1:7242/ingest/666869cb-9251-4224-9e7d-37070918adfc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(err=>console.error('Log fetch failed:',err));
                      }
                    }}
                    // #endregion
                  >
                    {user?.avatar_photo ? (
                      <>
                        <img 
                          src={user.avatar_photo} 
                          alt={user.name || user.email} 
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', position: 'absolute', top: 0, left: 0 }}
                          onError={(e) => {
                            console.log('Current user avatar image failed to load:', user.avatar_photo);
                            e.target.style.display = 'none';
                            const initialsSpan = e.target.parentElement?.querySelector('.avatar-initials-own');
                            if (initialsSpan) {
                              initialsSpan.style.display = 'block';
                            }
                          }}
                        />
                        <span 
                          className="avatar-initials-own"
                          style={{ 
                            fontSize: '12px', 
                            lineHeight: '1', 
                            color: 'white', 
                            fontWeight: '500',
                            display: 'none',
                            position: 'relative',
                            zIndex: 1
                          }}
                        >
                          {currentUserInitials}
                        </span>
                      </>
                    ) : (
                      <span 
                        style={{ 
                          fontSize: '12px', 
                          lineHeight: '1', 
                          color: 'white', 
                          fontWeight: '500'
                        }}
                      >
                        {currentUserInitials}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      
      <form onSubmit={handleSend} className="border-t border-gray-200 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

