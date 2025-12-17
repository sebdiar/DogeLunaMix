// dumb hack to allow firefox to work (please dont do this in prod)
// don't worry i will
if (navigator.userAgent.includes('Firefox')) {
  Object.defineProperty(globalThis, 'crossOriginIsolated', {
    value: true,
    writable: false,
  });
}

importScripts('/scram/scramjet.all.js');
const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

// Notion CSS Injection (exact same from Kasimir-Browser - optimized for performance)
const NOTION_CSS = `
  .fullWidth .notion-frame div.notion-scroller.vertical div.layout.layout-wide,
  .fullWidth .notion-frame .notion-scroller.vertical .layout.layout-wide,
  div.layout.layout-wide,
  .fullWidth div.layout.layout-wide {
    --margin-width: 60px !important;
  }
  
  .notion-selectable {
    max-width: 2500px !important;
  }
  
  [class*="timeline"] .notion-selectable,
  [class*="gantt"] .notion-selectable {
    max-width: none !important;
  }
  
  .notion-record-icon.notranslate:has(.pageEmpty),
  .pageEmpty,
  .notion-record-icon.notranslate button:has(.pageEmpty) {
    display: none !important;
    visibility: hidden !important;
    height: 0 !important;
    width: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }
  
  .notion-page-controls {
    padding-top: 10px !important;
  }
`;

const NOTION_JS = `
  (function() {
    const apply = () => {
      document.querySelectorAll('.layout.layout-wide, .fullWidth .layout.layout-wide').forEach(el => {
        el.style.setProperty('--margin-width', '60px', 'important');
      });
      document.querySelectorAll('.notion-page-controls').forEach(el => {
        el.style.setProperty('padding-top', '10px', 'important');
      });
      document.querySelectorAll('.notion-record-icon.notranslate').forEach(icon => {
        if (icon.querySelector('.pageEmpty')) {
          icon.style.cssText = 'display:none!important;visibility:hidden!important;height:0!important;width:0!important;margin:0!important;padding:0!important;overflow:hidden!important';
        }
      });
      document.querySelectorAll('[class*="timeline"], [class*="gantt"]').forEach(container => {
        container.querySelectorAll('.notion-selectable').forEach(el => {
          el.style.setProperty('max-width', 'none', 'important');
        });
      });
      const layoutContent = document.querySelector('div.layout-content');
      if (layoutContent) {
        for (const pseudoSel of layoutContent.querySelectorAll('div.pseudoSelection')) {
          const icon = pseudoSel.querySelector('.notion-record-icon.notranslate');
          if (icon && !pseudoSel.closest('.notion-list-view, .notion-table-view, .notion-board-view, .notion-gallery-view, [class*="collection"]') && !icon.querySelector('.pageEmpty')) {
            icon.style.setProperty('margin-top', '50px', 'important');
            icon.style.setProperty('height', '50px', 'important');
            break;
          }
        }
      }
    };
    apply();
    setTimeout(apply, 1000);
    new MutationObserver(apply).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  })();
`;

async function injectNotionContent(html) {
  // Check if already injected to avoid duplicates
  if (html.includes('kasimir-notion-css') || html.includes('kasimir-notion-js')) {
    return html;
  }
  
  // Inject CSS before </head>
  let modifiedHtml = html.replace('</head>', `<style id="kasimir-notion-css">${NOTION_CSS}</style></head>`);
  
  // Inject JS before </body> or </html>
  if (modifiedHtml.includes('</body>')) {
    modifiedHtml = modifiedHtml.replace('</body>', `<script id="kasimir-notion-js">${NOTION_JS}</script></body>`);
  } else if (modifiedHtml.includes('</html>')) {
    modifiedHtml = modifiedHtml.replace('</html>', `<script id="kasimir-notion-js">${NOTION_JS}</script></html>`);
  }
  
  return modifiedHtml;
}

async function handleRequest(event) {
  await scramjet.loadConfig();
  
  // Check if it's a Notion URL
  const url = event.request.url;
  const isNotion = url.includes('notion.so') || url.includes('notion.com');
  // IMPORTANT: NO procesar Notion si viene del Cloudflare Worker (debe usar el Worker directamente)
  const isCloudflareWorker = url.includes('silent-queen-f1d8.sebdiar.workers.dev');
  
  // Si es Notion pero viene del Cloudflare Worker, NO procesar con ScramJet
  if (isNotion && isCloudflareWorker) {
    // Dejar que el Cloudflare Worker maneje esto directamente
    return fetch(event.request);
  }
  
  if (scramjet.route(event)) {
    const response = await scramjet.fetch(event);
    
    // Intercept HTML responses for Notion (solo si NO viene del Cloudflare Worker)
    if (isNotion && !isCloudflareWorker && response && response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        try {
          const html = await response.clone().text();
          const modifiedHtml = await injectNotionContent(html);
          
          // Create new headers object (can't copy Headers directly)
          const newHeaders = new Headers(response.headers);
          
          // Return modified response
          return new Response(modifiedHtml, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
          });
        } catch (error) {
          // Return original if injection fails
          return response;
        }
      }
    }
    
    return response;
  }

  // For non-Scramjet requests, also check for Notion (solo si NO viene del Cloudflare Worker)
  if (isNotion && !isCloudflareWorker) {
    try {
      const response = await fetch(event.request);
      
      if (response && response.ok) {
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('text/html')) {
          const html = await response.clone().text();
          const modifiedHtml = await injectNotionContent(html);
          
          // Create new headers object
          const newHeaders = new Headers(response.headers);
          
          return new Response(modifiedHtml, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
          });
        }
      }
      
      return response;
    } catch (error) {
      return fetch(event.request);
    }
  }

  return fetch(event.request);
}

self.addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event));
});

let playgroundData;
self.addEventListener('message', ({ data }) => {
  if (data.type === 'playgroundData') {
    playgroundData = data;
  }
});

scramjet.addEventListener('request', (e) => {
  if (playgroundData && e.url.href.startsWith(playgroundData.origin)) {
    const headers = {};
    const origin = playgroundData.origin;
    if (e.url.href === origin + '/') {
      headers['content-type'] = 'text/html';
      e.response = new Response(playgroundData.html, {
        headers,
      });
    } else if (e.url.href === origin + '/style.css') {
      headers['content-type'] = 'text/css';
      e.response = new Response(playgroundData.css, {
        headers,
      });
    } else if (e.url.href === origin + '/script.js') {
      headers['content-type'] = 'application/javascript';
      e.response = new Response(playgroundData.js, {
        headers,
      });
    } else {
      e.response = new Response('empty response', {
        headers,
      });
    }
    e.response.rawHeaders = headers;
    e.response.rawResponse = {
      body: e.response.body,
      headers: headers,
      status: e.response.status,
      statusText: e.response.statusText,
    };
    e.response.finalURL = e.url.toString();
  } else {
    return;
  }
});
