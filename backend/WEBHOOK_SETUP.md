# Notion Webhook Setup Guide

## Configuración de Webhooks en Notion

Para recibir notificaciones automáticas cuando se crean, actualizan o archivan páginas en Notion:

### 1. Obtener URL del Webhook

Tu endpoint de webhook es:
```
http://TU_DOMINIO/api/notion/webhook
```

Para desarrollo local, necesitas usar un servicio como:
- **ngrok**: `ngrok http 3001` y usar la URL proporcionada
- **localtunnel**: `lt --port 3001`
- O cualquier otro túnel público

**Ejemplo con ngrok:**
```bash
ngrok http 3001
# Usar: https://abc123.ngrok.io/api/notion/webhook
```

### 2. Configurar Webhook en Notion

1. Ve a tu integración en Notion: https://www.notion.so/my-integrations
2. Selecciona tu integración
3. En la sección "Webhooks", haz click en "Add webhook"
4. Ingresa tu URL del webhook: `https://TU_TUNEL/api/notion/webhook`
5. Selecciona los eventos que quieres recibir:
   - ✅ `page.created`
   - ✅ `page.updated`
   - ✅ `page.archived`
   - ✅ `page.deleted`
6. Selecciona tu base de datos (database)
7. Guarda el webhook

### 3. Eventos Soportados

El webhook procesa los siguientes eventos:

- **page.created**: Cuando se crea una nueva página en Notion → Crea un proyecto en DogeUB
- **page.updated**: Cuando se actualiza una página (nombre, parent, etc.) → Actualiza el proyecto en DogeUB
- **page.archived**: Cuando se archiva una página → Archiva el proyecto en DogeUB
- **page.deleted**: Cuando se elimina una página → Archiva el proyecto en DogeUB (no lo elimina)

### 4. Verificación de Firma (Futuro)

Actualmente el webhook acepta todas las solicitudes. En producción, deberías:

1. Configurar un secreto compartido en Notion
2. Verificar el header `X-Notion-Signature` usando HMAC-SHA256
3. Solo procesar webhooks válidos

### 5. Testing

Para probar el webhook localmente:

1. Inicia el backend: `cd backend && node server.js`
2. Inicia un túnel: `ngrok http 3001`
3. Configura el webhook en Notion con la URL de ngrok
4. Crea/actualiza una página en Notion
5. Verifica los logs del backend: `tail -f /tmp/dogeub-backend.log`

### Notas Importantes

- El webhook debe responder con 200 OK rápidamente (Notion espera respuesta en < 3 segundos)
- Los cambios se procesan de forma asíncrona
- Si falla la sincronización, se puede recuperar con la sincronización manual al cargar proyectos














