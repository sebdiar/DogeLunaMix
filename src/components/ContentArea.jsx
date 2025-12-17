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
            return (
              <div
                key={msg.id}
                className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-md px-4 py-2 rounded-lg ${
                    isOwn
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <div className="text-sm font-medium mb-1">
                    {msg.user?.name || msg.user?.email || 'Unknown'}
                  </div>
                  <div className="text-sm">{msg.message}</div>
                  <div className={`text-xs mt-1 ${isOwn ? 'text-blue-100' : 'text-gray-500'}`}>
                    {new Date(msg.created_at).toLocaleTimeString()}
                  </div>
                </div>
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

