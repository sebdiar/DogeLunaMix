# 🧪 Guía para Probar Notificaciones Push de Mensajes del Sistema

## Endpoints de Prueba Disponibles

### 1. Notificación Push Directa (Recomendado para probar primero)

**Endpoint:** `POST /api/notifications/test/system`

**Descripción:** Envía una notificación push de prueba directamente, sin crear un mensaje en la base de datos. Útil para verificar que las notificaciones push funcionan correctamente.

**Headers:**
```
Authorization: Bearer YOUR_AUTH_TOKEN
Content-Type: application/json
```

**Body (opcional):**
```json
{
  "title": "System",
  "body": "Mensaje de prueba personalizado"
}
```

**Ejemplo con curl:**
```bash
curl -X POST https://tu-backend.com/api/notifications/test/system \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "System", "body": "🧪 Test notification"}'
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "message": "Test system notification sent",
  "sent": 1,
  "failed": 0,
  "total": 1,
  "title": "System",
  "body": "🧪 Test notification"
}
```

---

### 2. Mensaje del Sistema en Chat

**Endpoint:** `POST /api/chat/test/system-message`

**Descripción:** Crea un mensaje del sistema real en un chat específico y envía notificaciones push a todos los participantes. Útil para probar el flujo completo de mensajes del sistema.

**Headers:**
```
Authorization: Bearer YOUR_AUTH_TOKEN
Content-Type: application/json
```

**Body:**
```json
{
  "chatId": "uuid-del-chat",
  "message": "Mensaje de prueba opcional"
}
```

**Ejemplo con curl:**
```bash
curl -X POST https://tu-backend.com/api/chat/test/system-message \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"chatId": "uuid-del-chat", "message": "🧪 Test system message"}'
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "message": "Test system message sent",
  "data": {
    "messageId": "uuid-del-mensaje",
    "chatId": "uuid-del-chat",
    "message": "🧪 Test system message",
    "createdAt": "2024-01-01T12:00:00Z",
    "notificationSent": true
  }
}
```

---

## Cómo Obtener el Token de Autenticación

1. **Desde el navegador (DevTools):**
   - Abre la aplicación en el navegador
   - Abre DevTools (F12)
   - Ve a la pestaña "Application" o "Storage"
   - Busca "Local Storage" o "Session Storage"
   - Busca la clave que contiene el token (puede ser `token`, `authToken`, `accessToken`, etc.)

2. **Desde la consola del navegador:**
   ```javascript
   // Si usas localStorage
   localStorage.getItem('token')
   
   // O si está en sessionStorage
   sessionStorage.getItem('token')
   ```

3. **Desde el código del frontend:**
   - Busca dónde se almacena el token después del login
   - Puede estar en `localStorage`, `sessionStorage`, o en el estado de la aplicación

---

## Cómo Obtener el Chat ID

1. **Desde la URL del chat:**
   - Si la URL es algo como `/chat/uuid-del-chat`, el UUID es el chatId

2. **Desde la API:**
   ```bash
   # Obtener todos tus chats
   curl -X GET https://tu-backend.com/api/chat/my-chats \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

3. **Desde la base de datos:**
   - Consulta la tabla `chats` o `space_chats` para encontrar el chatId

---

## Pruebas con Postman

1. **Crear una nueva request:**
   - Method: `POST`
   - URL: `https://tu-backend.com/api/notifications/test/system`

2. **Headers:**
   - `Authorization`: `Bearer YOUR_TOKEN`
   - `Content-Type`: `application/json`

3. **Body (opcional):**
   ```json
   {
     "title": "System",
     "body": "🧪 Test desde Postman"
   }
   ```

4. **Enviar la request**

---

## Verificar que las Notificaciones Llegaron

1. **En el navegador:**
   - Asegúrate de que tienes permisos de notificaciones activados
   - La notificación debería aparecer en la esquina de la pantalla
   - Si no aparece, verifica los permisos en la configuración del navegador

2. **En la consola del servidor:**
   - Revisa los logs del backend
   - Deberías ver mensajes como:
     ```
     ✅ VAPID keys configured for push notifications
     [PUSH] Sending push notifications to 1 user(s)
     ```

3. **En la base de datos:**
   - Verifica la tabla `push_subscriptions` para confirmar que tienes suscripciones activas
   - Verifica la tabla `chat_messages` si usaste el endpoint 2

---

## Solución de Problemas

### Error: "No active push subscriptions found"
- **Causa:** No tienes una suscripción activa a push notifications
- **Solución:** 
  1. Asegúrate de haber aceptado los permisos de notificaciones en el navegador
  2. Verifica que el frontend haya llamado a `/api/notifications/subscribe` correctamente
  3. Revisa la tabla `push_subscriptions` en la base de datos

### Error: "VAPID keys not configured"
- **Causa:** Las claves VAPID no están configuradas en las variables de entorno
- **Solución:** Configura `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` en tu backend

### La notificación no aparece
- Verifica que el navegador tenga permisos de notificaciones
- Verifica que la aplicación no esté en primer plano (algunos navegadores no muestran notificaciones si la app está activa)
- Revisa la consola del navegador para errores
- Verifica que el service worker esté registrado correctamente

---

## Próximos Pasos

Una vez que confirmes que las notificaciones push funcionan con estos endpoints de prueba, los mensajes del sistema reales (de Notion tasks, recordatorios, etc.) deberían funcionar automáticamente.

