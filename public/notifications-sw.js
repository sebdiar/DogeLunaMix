// Service Worker for Push Notifications
const CACHE_NAME = 'dogeluna-notifications-v1';

// Install event
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Push event - triggered when a push notification is received
self.addEventListener('push', (event) => {
  let data = {};
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'DogeLunaMix', body: event.data.text() };
    }
  }

  const options = {
    title: data.title || 'DogeLunaMix',
    body: data.body || 'You have a new message',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || 'default',
    data: data.data || {},
    requireInteraction: false,
    silent: false
  };

  event.waitUntil(
    self.registration.showNotification(options.title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const urlToOpen = notificationData.url || '/';
  const spaceId = notificationData.spaceId;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already an app window open
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          // Focus existing window and send message to open chat
          if ('focus' in client) {
            client.focus();
            // Post message to the client to open the specific chat
            if (spaceId) {
              client.postMessage({
                type: 'OPEN_CHAT',
                spaceId: spaceId
              });
            }
            return;
          }
        }
        
        // If no existing window, open a new one
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

















