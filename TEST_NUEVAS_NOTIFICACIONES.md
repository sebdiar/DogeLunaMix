# ✅ Túneles Activos - Sistema NUEVO de Push Notifications

## 🎉 Todo listo con el NUEVO sistema (solo backend)

### ✨ CAMBIO IMPORTANTE:
**Desactivé las notificaciones viejas del frontend** que no funcionaban en Replit.
Ahora SOLO funciona el sistema nuevo (backend con VAPID keys).

---

## 🔗 URLs para Probar

### 📱 Frontend (abre esta URL):
```
https://exclusively-queens-utilize-comes.trycloudflare.com
```

### 🔧 Backend (ya configurado automáticamente):
```
https://tales-exec-arrested-eng.trycloudflare.com
```

---

## 🧪 Cómo probar el NUEVO sistema

### Paso 1: Abrir la app
Abre en tu navegador:
```
https://exclusively-queens-utilize-comes.trycloudflare.com
```

### Paso 2: Iniciar sesión
- Inicia sesión con tu cuenta

### Paso 3: Aceptar permisos
- Acepta las notificaciones cuando te pida

### Paso 4: Verificar en consola
Abre DevTools (F12) → Console

Deberías ver:
```
✅ "Notification service worker registered"
✅ "Subscribed to push notifications"  o  "Already subscribed"
✅ "Push subscription saved to server"
```

### Paso 5: TEST DEFINITIVO (app cerrada)
**Este es el test que confirma que es el NUEVO sistema:**

1. **CIERRA TODAS las pestañas** de la app
2. Desde otro dispositivo/cuenta, envíate un mensaje
3. **¿Te llegó notificación?**
   - ✅ **SÍ** = Funciona el sistema NUEVO 🎉
   - ❌ **NO** = Necesitamos revisar

---

## 🔍 Logs del Backend (para depurar)

Si quieres ver los logs del backend en tiempo real:

```bash
tail -f /tmp/backend.log
```

Deberías ver algo como:
```
✅ VAPID keys configured for push notifications
DogeUB Backend running on port 3001
[PUSH] Sending push notifications to 1 user(s)
```

---

## 📊 Qué cambió vs sistema viejo

### ❌ Sistema VIEJO (frontend local):
- ❌ Solo funcionaba si la app estaba ABIERTA
- ❌ NO funcionaba en Replit
- ❌ Usaba Supabase Realtime directamente en frontend
- ❌ **DESACTIVADO en línea 455 de luna-integration.js**

### ✅ Sistema NUEVO (backend con VAPID):
- ✅ Funciona incluso si la app está CERRADA
- ✅ Funciona en Replit y en local
- ✅ Usa el backend para enviar notificaciones
- ✅ Requiere VAPID keys (ya configuradas)

---

## 🎯 Pruebas a realizar

- [ ] Abrir la app y aceptar permisos
- [ ] Ver en consola: "Subscribed to push notifications"
- [ ] **CERRAR todas las pestañas de la app**
- [ ] Enviarse un mensaje desde otro dispositivo
- [ ] ¿Llega la notificación? ← **TEST CRÍTICO**
- [ ] Abrir la notificación, ¿abre el chat correcto?

---

## 🐛 Si NO llegan notificaciones con app cerrada

### 1. Verificar suscripción en Supabase:
```sql
SELECT * FROM push_subscriptions;
```
Debe haber al menos 1 fila con tu `user_id`.

### 2. Verificar logs del backend:
```bash
tail -20 /tmp/backend.log
```
Cuando alguien te envía un mensaje, deberías ver:
```
[PUSH] Sending push notifications to 1 user(s)
```

### 3. Verificar permisos del navegador:
- Chrome: Configuración → Privacidad → Configuración de sitios → Notificaciones
- Debe estar en "Permitir"

### 4. Verificar que el service worker esté activo:
- DevTools → Application → Service Workers
- Debe aparecer: `notifications-sw.js` (status: activated)

---

## 🛑 Para detener todo cuando termines

```bash
pkill -f "node.*server.js" && pkill -f "vite" && pkill -f "cloudflared"
```

---

## 🚀 Siguiente paso (cuando funcione aquí)

1. **Restaurar API_URL** a vacío en `luna-integration.js`:
   ```javascript
   const API_URL = '';
   ```

2. **Agregar VAPID keys a Replit Secrets:**
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_MAILTO`

3. **Commit y push:**
   ```bash
   git add .
   git commit -m "feat: push notifications with backend (no frontend fallback)"
   git push
   ```

---

## 📞 Información para ti

**Backend URL:** `https://tales-exec-arrested-eng.trycloudflare.com`
**Frontend URL:** `https://exclusively-queens-utilize-comes.trycloudflare.com`

**Logs:**
- Backend: `tail -f /tmp/backend.log`
- Frontend: `tail -f /tmp/frontend.log`

**¡Ahora prueba el test definitivo!** (cerrar app y recibir notificación)

