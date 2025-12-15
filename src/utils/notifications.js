// Notifications service for PWA push notifications

let notificationPermission = null;
let serviceWorkerRegistration = null;

/**
 * Register the notification service worker
 */
export async function registerNotificationServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/notifications-sw.js', {
        scope: '/'
      });
      serviceWorkerRegistration = registration;
      console.log('Notification service worker registered:', registration.scope);
      return registration;
    } catch (error) {
      console.error('Failed to register notification service worker:', error);
      return null;
    }
  }
  return null;
}

/**
 * Request notification permission from the user
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('This browser does not support notifications');
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    notificationPermission = 'granted';
    return 'granted';
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    notificationPermission = permission;
    return permission;
  }

  notificationPermission = 'denied';
  return 'denied';
}

/**
 * Check if notifications are supported and permitted
 */
export function isNotificationSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

/**
 * Check if notifications are permitted
 */
export function hasNotificationPermission() {
  return Notification.permission === 'granted';
}

/**
 * Show a local notification
 */
export async function showNotification(title, options = {}) {
  if (!hasNotificationPermission()) {
    console.warn('Notification permission not granted');
    return;
  }

  if (!serviceWorkerRegistration) {
    // Fallback to regular Notification API if service worker is not ready
    new Notification(title, {
      icon: '/icon.svg',
      badge: '/icon.svg',
      ...options
    });
    return;
  }

  await serviceWorkerRegistration.showNotification(title, {
    icon: '/icon.svg',
    badge: '/icon.svg',
    ...options
  });
}

/**
 * Initialize notifications (register service worker and request permission)
 */
export async function initNotifications() {
  if (!isNotificationSupported()) {
    console.warn('Notifications not supported in this browser');
    return false;
  }

  // Register service worker first
  const registration = await registerNotificationServiceWorker();
  if (!registration) {
    return false;
  }

  // Request permission (but don't force it - let user request it when needed)
  // This is typically called when user explicitly enables notifications
  return true;
}

/**
 * Create a Supabase client for the frontend (using anon key)
 * Note: This requires SUPABASE_URL and SUPABASE_ANON_KEY to be available
 * For security, these should ideally come from environment variables or API
 */
export function createSupabaseClient() {
  try {
    // Try to get from window config if available
    const supabaseUrl = window.__SUPABASE_URL__ || import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = window.__SUPABASE_ANON_KEY__ || import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn('Supabase credentials not found. Notifications may not work.');
      return null;
    }

    // Dynamic import to avoid bundling issues if Supabase is not available
    if (typeof window !== 'undefined' && window.supabaseCreateClient) {
      return window.supabaseCreateClient(supabaseUrl, supabaseAnonKey);
    }

    // Try to use @supabase/supabase-js if available
    // For now, we'll use polling approach if Supabase client is not available
    return null;
  } catch (error) {
    console.error('Error creating Supabase client:', error);
    return null;
  }
}

/**
 * Setup notification listener for chat messages using polling as fallback
 * This should be called when user is authenticated
 */
export function setupChatNotifications(userId, onNewMessage, api) {
  if (!userId || !api) {
    console.warn('Cannot setup chat notifications: missing userId or api');
    return null;
  }

  // Try to use Supabase Realtime if available
  const supabaseClient = createSupabaseClient();
  
  if (supabaseClient) {
    // Use Supabase Realtime for real-time notifications
    try {
      const channel = supabaseClient
        .channel(`chat-notifications-${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `user_id=neq.${userId}` // Only messages from other users
          },
          async (payload) => {
            await handleNewMessage(payload.new, userId, supabaseClient, onNewMessage);
          }
        )
        .subscribe();

      return { type: 'realtime', channel, cleanup: () => channel.unsubscribe() };
    } catch (error) {
      console.error('Error setting up Supabase Realtime:', error);
      // Fall through to polling
    }
  }

  // Fallback to polling approach
  let lastMessageTime = new Date().toISOString();
  let pollingInterval = null;

  const pollForNewMessages = async () => {
    try {
      // This would require a backend endpoint to check for new messages
      // For now, we'll just log that polling is not fully implemented
      // In a real implementation, you'd call an API endpoint that checks for new messages
      // since the lastMessageTime
    } catch (error) {
      console.error('Error polling for messages:', error);
    }
  };

  pollingInterval = setInterval(pollForNewMessages, 5000); // Poll every 5 seconds

  return {
    type: 'polling',
    interval: pollingInterval,
    cleanup: () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    }
  };
}

/**
 * Handle a new message notification
 */
async function handleNewMessage(message, userId, supabaseClient, onNewMessage) {
  try {
    // Get chat participants to verify user has access
    const { data: participants } = await supabaseClient
      .from('chat_participants')
      .select('user_id')
      .eq('chat_id', message.chat_id);

    const hasAccess = participants?.some(p => p.user_id === userId);
    
    if (!hasAccess) {
      return; // User doesn't have access to this chat
    }

    // Get sender info
    const { data: sender } = await supabaseClient
      .from('users')
      .select('name, email')
      .eq('id', message.user_id)
      .single();

    const senderName = sender?.name || sender?.email || 'Someone';

    // Check if app is in foreground
    const isAppInForeground = document.visibilityState === 'visible';
    
    // Only show notification if app is in background or user is not viewing this chat
    if (!isAppInForeground) {
      // Show browser notification
      await showNotification(`${senderName}`, {
        body: message.message,
        tag: `chat-${message.chat_id}`,
        data: {
          url: `/indev?chat=${message.chat_id}`,
          chatId: message.chat_id,
          type: 'chat_message'
        }
      });
    }

    // Call the callback to update UI if needed
    if (onNewMessage && typeof onNewMessage === 'function') {
      onNewMessage(message);
    }
  } catch (error) {
    console.error('Error handling new message:', error);
  }
}

/**
 * Unsubscribe from chat notifications
 */
export function unsubscribeChatNotifications(subscription) {
  if (subscription && subscription.cleanup) {
    subscription.cleanup();
  } else if (subscription && subscription.unsubscribe) {
    // Legacy support for direct channel
    subscription.unsubscribe();
  }
}

