/**
 * Cloudflare Worker - Notion Proxy
 * 
 * Este worker actúa como proxy transparente para Notion, reescribiendo
 * el host y manejando headers, cookies y CSP correctamente.
 * 
 * Para usar:
 * 1. Copia este código en Cloudflare Dashboard > Workers & Pages > Create Worker
 * 2. Despliega el worker
 * 3. Configura una ruta en tu dominio si es necesario
 */

// Notion CSS Injection (optimizado para mejor rendimiento)
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

// Notion JS Injection (aplica estilos dinámicamente)
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

export default {
  async fetch(request, env, ctx) {
    // Manejar preflight OPTIONS primero
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    
    // Obtener la URL de la petición
    const url = new URL(request.url);
    const workerUrl = new URL(request.url);
    const workerHost = workerUrl.hostname;
    const workerProtocol = workerUrl.protocol;
    
    // Si la ruta comienza con https://, extraer la ruta de Notion
    let notionPath = url.pathname;
    if (notionPath.startsWith('/https://') || notionPath.startsWith('/http://')) {
      try {
        const extractedUrl = notionPath.substring(1); // Remover el primer /
        const parsedUrl = new URL(extractedUrl);
        if (parsedUrl.hostname.includes('notion.so') || parsedUrl.hostname.includes('notion.com')) {
          notionPath = parsedUrl.pathname + parsedUrl.search;
        }
      } catch (e) {
        // Si falla, usar la ruta tal cual
      }
    }
    
    // Reescribir el host a www.notion.so (Notion usa www.notion.so para su sitio y APIs)
    url.hostname = 'www.notion.so';
    url.protocol = 'https:';
    url.pathname = notionPath;
    
    // Preparar headers para la petición a Notion
    const headers = new Headers(request.headers);
    
    // Actualizar el Host header
    headers.set('Host', 'www.notion.so');
    
    // Remover headers que podrían causar problemas
    headers.delete('X-Forwarded-Host');
    headers.delete('X-Forwarded-Proto');
    headers.delete('CF-Connecting-IP');
    headers.delete('CF-Ray');
    headers.delete('CF-Visitor');
    headers.delete('X-Forwarded-For');
    
    // Mantener referer pero actualizar si es necesario
    if (headers.has('Referer')) {
      const referer = headers.get('Referer');
      try {
        const refererUrl = new URL(referer);
        refererUrl.hostname = 'www.notion.so';
        headers.set('Referer', refererUrl.toString());
      } catch (e) {
        // Si el referer no es válido, mantenerlo o eliminarlo
        headers.set('Referer', 'https://www.notion.so/');
      }
    }
    
    // Mantener Origin pero actualizar si es necesario
    if (headers.has('Origin')) {
      const origin = headers.get('Origin');
      try {
        const originUrl = new URL(origin);
        originUrl.hostname = 'www.notion.so';
        originUrl.protocol = 'https:';
        headers.set('Origin', originUrl.toString());
      } catch (e) {
        headers.set('Origin', 'https://www.notion.so');
      }
    }
    
    // Obtener el body si existe (para métodos POST, PUT, PATCH)
    let requestBody = null;
    const methodsWithBody = ['POST', 'PUT', 'PATCH'];
    const hasBody = methodsWithBody.includes(request.method) && request.body !== null;
    
    if (hasBody) {
      try {
        // Clonar la petición para leer el body sin consumirlo
        const clonedRequest = request.clone();
        requestBody = await clonedRequest.arrayBuffer();
      } catch (e) {
        console.error('Error reading request body:', e);
        requestBody = null;
      }
    }
    
    // Función para seguir redirects internamente
    const followRedirects = async (initialUrl, maxRedirects = 5) => {
      let currentUrl = initialUrl;
      let redirectCount = 0;
      
      while (redirectCount < maxRedirects) {
        // Solo enviar body en la primera petición y solo para métodos que lo requieren
        // Los redirects generalmente no deben incluir el body (excepto 307/308)
        const shouldSendBody = redirectCount === 0 && hasBody && requestBody !== null && requestBody.byteLength > 0;
        
        // Crear headers frescos para cada petición
        const requestHeaders = new Headers(headers);
        
        // Si hay body, asegurar que Content-Length esté presente
        if (shouldSendBody) {
          requestHeaders.set('Content-Length', requestBody.byteLength.toString());
        } else {
          requestHeaders.delete('Content-Length');
        }
        
        const modifiedRequest = new Request(currentUrl.toString(), {
          method: request.method,
          headers: requestHeaders,
          body: shouldSendBody ? requestBody : null,
          redirect: 'manual', // Manejar redirects manualmente
          cf: {
            cacheEverything: false,
          }
        });
        
        const response = await fetch(modifiedRequest);
        
        // Si es un redirect, seguirlo internamente
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('Location');
          if (location) {
            try {
              const locationUrl = new URL(location, currentUrl);
              // Si apunta a cualquier dominio de Notion, seguir el redirect
              if (locationUrl.hostname.includes('notion.so') || locationUrl.hostname.includes('notion.com')) {
                // Normalizar a www.notion.so
                if (locationUrl.hostname.includes('notion.so') && !locationUrl.hostname.startsWith('www.')) {
                  locationUrl.hostname = locationUrl.hostname.replace(/^([^.]+\.)?notion\.so$/, 'www.notion.so');
                }
                currentUrl = locationUrl;
                redirectCount++;
                continue;
              }
            } catch (e) {
              // Si no es una URL válida pero es relativa, construirla
              if (location.startsWith('/')) {
                currentUrl = new URL(location, currentUrl);
                redirectCount++;
                continue;
              }
            }
          }
        }
        
        // Si no es redirect o no podemos seguirlo, devolver la respuesta
        return { response, finalUrl: currentUrl };
      }
      
      // Si excedimos los redirects, devolver la última respuesta
      const finalRequest = new Request(currentUrl.toString(), {
        method: request.method,
        headers: headers,
        body: hasBody && requestBody ? requestBody : null,
        redirect: 'manual',
        cf: { cacheEverything: false }
      });
      const response = await fetch(finalRequest);
      return { response, finalUrl: currentUrl };
    };
    
    try {
      // Seguir redirects automáticamente
      const { response, finalUrl } = await followRedirects(url);
      
      // Obtener el tipo de contenido
      const contentType = response.headers.get('Content-Type') || '';
      const isHTML = contentType.includes('text/html');
      const isText = contentType.includes('text/') || contentType.includes('application/javascript') || contentType.includes('application/json');
      
      // Clonar el body para procesarlo si es HTML/texto
      let body = response.body;
      let modifiedBody = body;
      
      if (isHTML || isText) {
        const text = await response.text();
        
        // Lista de patrones que NO deben ser reescritos
        // Estos son servicios externos o internos que deben ir directo a Notion
        const excludedPatterns = [
          // WebSocket y servicios de mensajería
          /msgstore/i,           // Servicios de mensajería/WebSocket
          /msgstore-\d+/,        // msgstore-001, msgstore-002, etc.
          /ws:\/\//,             // WebSocket URLs (protocolo ws://)
          /wss:\/\//,            // WebSocket URLs (protocolo wss://)
          
          // Analytics y tracking (causan requests repetitivos)
          /\/v1\//,              // Statsig analytics (/v1/initialize, /v1/rgstr)
          /\/v1\/initialize/,    // Statsig initialize (muy repetitivo)
          /\/v1\/rgstr/,         // Statsig register (muy repetitivo)
          /statsig\.com/,        // Statsig directamente
          /statsigapi\.net/,     // Statsig API
          /http-inputs-notion\.splunkcloud\.com/, // Splunk analytics
          /connect\.facebook\.net/, // Facebook Pixel
          /analytics\./,         // Cualquier analytics
          /tracking\./,          // Cualquier tracking
          
          // APIs específicas que causan requests repetitivos o errores
          /\/api\/v3\/loadPageChunk/, // API de carga de páginas (puede ser repetitivo)
          /\/api\/v3\/getRecordValues/, // API de valores de registros
          /\/api\/v3\/getPublicPageData/, // API de datos públicos
          /\/api\/v3\/getSignedFileUrls/, // API de URLs firmadas
          /\/api\/v3\/getUploadFileUrl/, // API de upload
          /\/api\/v3\/submitTransaction/, // API de transacciones
          /\/api\/v3\/enqueueTask/, // API de tareas
          /\/api\/v3\/getTasksForBlock/, // API de tareas por bloque
          
          // Recursos estáticos y CDN (no necesitan proxy)
          /img\.notionusercontent\.com/, // Imágenes de Notion (ya tienen su propio dominio)
          /notion-static\.com/, // Archivos estáticos de Notion
          /\/static\//,         // Archivos estáticos
          /\/_next\//,          // Next.js internals (si Notion los usa)
          /\/_vercel\//,        // Vercel internals
        ];
        
        // Función helper para verificar si una URL debe ser excluida
        const shouldExclude = (url) => {
          // Normalizar URL para comparación (convertir a string si es necesario)
          const urlStr = typeof url === 'string' ? url : String(url);
          
          // Si la URL ya apunta al Worker, no reescribirla (evitar doble reescritura)
          if (urlStr.includes(workerHost)) {
            return true;
          }
          
          // Si la URL no es de Notion, no reescribirla (aunque los regex ya filtran esto)
          if (!/notion\.(so|com)/i.test(urlStr)) {
            return true;
          }
          
          // Verificar patrones de exclusión
          return excludedPatterns.some(pattern => pattern.test(urlStr));
        };
        
        // Reescribir todas las URLs de notion.so y notion.com en el contenido
        modifiedBody = text
          // Reemplazar URLs completas de notion.so (incluyendo subdominios)
          .replace(/https?:\/\/([a-zA-Z0-9-]+\.)?notion\.so([^"'\s<>)]*)/gi, (match, subdomain, path) => {
            // NO reescribir si es un patrón excluido
            if (shouldExclude(match)) {
              return match; // Dejar la URL original
            }
            return `${workerProtocol}//${workerHost}${path || ''}`;
          })
          // Reemplazar URLs completas de notion.com (incluyendo subdominios)
          .replace(/https?:\/\/([a-zA-Z0-9-]+\.)?notion\.com([^"'\s<>)]*)/gi, (match, subdomain, path) => {
            // NO reescribir si es un patrón excluido
            if (shouldExclude(match)) {
              return match; // Dejar la URL original
            }
            return `${workerProtocol}//${workerHost}${path || ''}`;
          })
          // Reemplazar window.location y similares
          .replace(/window\.location\s*=\s*["']https?:\/\/([^"']*notion\.so[^"']*)["']/gi, (match, url) => {
            if (shouldExclude(url)) return match;
            return `window.location="${url.replace(/https?:\/\/([^/]*)/, `${workerProtocol}//${workerHost}`)}"`;
          })
          // Reemplazar cualquier referencia a notion.so en strings
          .replace(/(["'])([^"']*notion\.so[^"']*)(["'])/gi, (match, quote1, url, quote2) => {
            if (shouldExclude(url)) return match;
            return `${quote1}${url.replace(/https?:\/\/([a-zA-Z0-9-]+\.)?notion\.so/gi, `${workerProtocol}//${workerHost}`).replace(/notion\.so/gi, workerHost)}${quote2}`;
          })
          .replace(/(["'])([^"']*notion\.com[^"']*)(["'])/gi, (match, quote1, url, quote2) => {
            if (shouldExclude(url)) return match;
            return `${quote1}${url.replace(/https?:\/\/([a-zA-Z0-9-]+\.)?notion\.com/gi, `${workerProtocol}//${workerHost}`).replace(/notion\.com/gi, workerHost)}${quote2}`;
          })
          // Reemplazar URLs en atributos href, src, action, etc.
          .replace(/(href|src|action|data-url|data-href)\s*=\s*["']([^"']*notion\.so[^"']*)["']/gi, (match, attr, url) => {
            if (shouldExclude(url)) return match;
            const newUrl = url.startsWith('http') 
              ? url.replace(/https?:\/\/([a-zA-Z0-9-]+\.)?notion\.so/gi, `${workerProtocol}//${workerHost}`)
              : url.replace(/notion\.so/gi, workerHost);
            return `${attr}="${newUrl}"`;
          })
          .replace(/(href|src|action|data-url|data-href)\s*=\s*["']([^"']*notion\.com[^"']*)(["'])/gi, (match, attr, url) => {
            if (shouldExclude(url)) return match;
            const newUrl = url.startsWith('http')
              ? url.replace(/https?:\/\/([a-zA-Z0-9-]+\.)?notion\.com/gi, `${workerProtocol}//${workerHost}`)
              : url.replace(/notion\.com/gi, workerHost);
            return `${attr}="${newUrl}"`;
          });
        
        // Inyectar CSS y JS de Notion solo en respuestas HTML
        if (isHTML) {
          // Verificar que no se haya inyectado ya (evitar duplicados)
          if (!modifiedBody.includes('kasimir-notion-css') && !modifiedBody.includes('kasimir-notion-js')) {
            // Inyectar CSS antes de </head>
            if (modifiedBody.includes('</head>')) {
              modifiedBody = modifiedBody.replace('</head>', `<style id="kasimir-notion-css">${NOTION_CSS}</style></head>`);
            } else if (modifiedBody.includes('<head>')) {
              // Si no hay </head>, agregar antes del cierre del head
              modifiedBody = modifiedBody.replace('<head>', `<head><style id="kasimir-notion-css">${NOTION_CSS}</style>`);
            }
            
            // Inyectar JS antes de </body> o </html>
            if (modifiedBody.includes('</body>')) {
              modifiedBody = modifiedBody.replace('</body>', `<script id="kasimir-notion-js">${NOTION_JS}</script></body>`);
            } else if (modifiedBody.includes('</html>')) {
              modifiedBody = modifiedBody.replace('</html>', `<script id="kasimir-notion-js">${NOTION_JS}</script></html>`);
            }
          }
        }
      }
      
      // Clonar la respuesta para poder modificar headers
      const modifiedResponse = new Response(modifiedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      
      // Remover CSP headers que bloquean proxies
      modifiedResponse.headers.delete('Content-Security-Policy');
      modifiedResponse.headers.delete('Content-Security-Policy-Report-Only');
      modifiedResponse.headers.delete('X-Frame-Options');
      modifiedResponse.headers.delete('X-Content-Type-Options');
      
      // Actualizar headers de seguridad para permitir el proxy
      modifiedResponse.headers.set(
        'Content-Security-Policy',
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;"
      );
      
      // Manejar Set-Cookie para mantener sesiones
      // Reemplazar dominio en cookies de notion.so al dominio del worker
      const setCookieHeaders = modifiedResponse.headers.get('Set-Cookie');
      if (setCookieHeaders) {
        // Obtener todas las cookies (puede haber múltiples)
        const setCookies = Array.isArray(setCookieHeaders) 
          ? setCookieHeaders 
          : modifiedResponse.headers.getAll('Set-Cookie');
        
        if (setCookies && setCookies.length > 0) {
          modifiedResponse.headers.delete('Set-Cookie');
          const workerDomain = workerHost;
          
          setCookies.forEach(cookie => {
            if (!cookie) return;
            
            // Extraer el nombre y valor de la cookie antes de modificar
            const cookieParts = cookie.split(';');
            const nameValue = cookieParts[0];
            const attributes = cookieParts.slice(1);
            
            // NO remover el dominio - mantenerlo pero cambiarlo al worker domain si existe
            // Las cookies con dominio funcionan mejor en iframes cross-origin
            let modifiedCookie = cookie
              .replace(/domain=\.?notion\.so/gi, `domain=.${workerDomain}`)
              .replace(/domain=notion\.so/gi, `domain=.${workerDomain}`)
              .replace(/domain=\.?notion\.com/gi, `domain=.${workerDomain}`)
              .replace(/domain=notion\.com/gi, `domain=.${workerDomain}`);
            
            // Si la cookie NO tiene dominio explícito, mantenerla sin dominio (funciona para el dominio actual)
            // Solo modificar si ya tiene dominio
            
            // Asegurar SameSite=None y Secure para cross-origin (necesario para iframes)
            if (!modifiedCookie.match(/SameSite\s*=/i)) {
              modifiedCookie += '; SameSite=None; Secure';
            } else {
              // Reemplazar SameSite=Strict o Lax por None (necesario para iframes)
              modifiedCookie = modifiedCookie.replace(/SameSite\s*=\s*(Strict|Lax)/gi, 'SameSite=None');
              if (!modifiedCookie.match(/;\s*Secure/i) && !modifiedCookie.match(/^[^;]*Secure/i)) {
                modifiedCookie += '; Secure';
              }
            }
            
            // Asegurar que Path esté presente (algunos navegadores lo requieren)
            if (!modifiedCookie.match(/Path\s*=/i)) {
              modifiedCookie += '; Path=/';
            }
            
            modifiedResponse.headers.append('Set-Cookie', modifiedCookie);
          });
        }
      }
      
      // Si aún hay un redirect después de seguirlos, convertirlo en un redirect interno
      if (response.status >= 300 && response.status < 400) {
        const location = modifiedResponse.headers.get('Location');
        if (location) {
            try {
              const locationUrl = new URL(location, 'https://www.notion.so');
              // Reescribir cualquier redirect a notion.so para que apunte al worker
              if (locationUrl.hostname.includes('notion.so') || locationUrl.hostname.includes('notion.com')) {
                locationUrl.hostname = workerHost;
                locationUrl.protocol = workerProtocol;
                modifiedResponse.headers.set('Location', locationUrl.toString());
              } else if (location.startsWith('/')) {
                // Es una ruta relativa, construir la URL completa con el worker
                modifiedResponse.headers.set('Location', `${workerProtocol}//${workerHost}${location}`);
              }
            } catch (e) {
              // Si no es una URL válida pero empieza con /, reescribirla
              if (location.startsWith('/')) {
                modifiedResponse.headers.set('Location', `${workerProtocol}//${workerHost}${location}`);
              }
            }
        }
      }
      
      // Headers CORS para Safari
      modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');
      modifiedResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD');
      modifiedResponse.headers.set('Access-Control-Allow-Headers', '*');
      modifiedResponse.headers.set('Access-Control-Allow-Credentials', 'true');
      modifiedResponse.headers.set('Access-Control-Expose-Headers', '*');
      
      return modifiedResponse;
      
    } catch (error) {
      // Manejo de errores mejorado
      console.error('Proxy error:', error);
      
      // Si es un error de red o conexión, intentar devolver una respuesta más útil
      const errorMessage = error.message || 'Unknown error';
      const errorResponse = {
        error: 'Proxy error',
        message: errorMessage,
        url: request.url,
        method: request.method,
      };
      
      return new Response(
        JSON.stringify(errorResponse),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD',
            'Access-Control-Allow-Headers': '*',
          },
        }
      );
    }
  },
};
