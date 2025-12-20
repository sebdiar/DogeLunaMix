# 🧪 Guía de Testing Local con Push Notifications

Esta guía te ayudará a probar las notificaciones push localmente usando ngrok **antes** de hacer deploy a Replit.

## 📋 Prerrequisitos

1. ✅ Backend corriendo localmente (puerto 3001)
2. ✅ Frontend corriendo localmente (puerto 5173)
3. ✅ ngrok instalado ([descargar aquí](https://ngrok.com/download))
4. ✅ Supabase configurado en `.env`

## 🚀 Pasos de Testing

### Paso 1: Configurar Variables de Entorno

1. **Agregar VAPID keys a tu `.env` local:**
   
   Abre `dogeub/.env` y agrega estas líneas (si no existen):
   ```bash
   VAPID_PUBLIC_KEY=BHHhuWaVULh1G757aYjl08B0HZIR29nFwIjgm6gGNKkG3kJ76IYTEAKgXcYP5LoL0zEXIN5Gnz3IavLgHHsfnl4
   VAPID_PRIVATE_KEY=kFCM5MFVWm8ZqSmNOQc4LAeoB2tF5n3lTVRS8MGr2xE
   VAPID_MAILTO=mailto:tu-email@example.com
   ```

   ⚠️ **Reemplaza** `tu-email@example.com` con tu email real.

### Paso 2: Correr la Migración en Supabase

1. Ve a tu [Supabase Dashboard](https://supabase.com/dashboard)
2. Selecciona tu proyecto
3. Ve a **SQL Editor**
4. Copia y pega el contenido de `dogeub/backend/migrations/011-create-push-subscriptions.sql`
5. Haz click en **Run**
6. ✅ Deberías ver: "Success. No rows returned"

### Paso 3: Iniciar Backend Localmente

```bash
cd dogeub/backend
npm start
```

Deberías ver:
```
DogeUB Backend running on port 3001
✅ VAPID keys configured for push notifications
```

### Paso 4: Exponer Backend con ngrok

**En una nueva terminal:**

```bash
ngrok http 3001
```

Ngrok te dará una URL pública como:
```
Forwarding  https://abc123.ngrok.io -> http://localhost:3001
```

⚠️ **Copia esta URL** (la parte `https://abc123.ngrok.io`)

### Paso 5: Configurar Frontend para Usar ngrok

1. **Actualiza el `API_URL` en el frontend:**
   
   Abre `dogeub/src/static/scripts/luna-integration.js` (línea 2):
   
   **Antes:**
   ```javascript
   const API_URL = '';
   ```
   
   **Después:**
   ```javascript
   const API_URL = 'https://abc123.ngrok.io';  // Tu URL de ngrok
   ```

2. **Guarda el archivo**

### Paso 6: Iniciar Frontend

```bash
cd dogeub
npm run dev
```

### Paso 7: Probar en el Navegador

1. **Abre el navegador en** `http://localhost:5173`
2. **Inicia sesión** con tu cuenta
3. **Acepta permisos de notificaciones** cuando se solicite
4. **Abre la consola del navegador** (F12)
   - Deberías ver:
     ```
     Notification service worker registered
     Notification permission granted
     Subscribed to push notifications
     Push subscription saved to server
     ```

### Paso 8: Enviar Mensaje de Prueba

1. **Abre dos ventanas del navegador:**
   - Ventana A: Usuario 1 (tu cuenta)
   - Ventana B: Usuario 2 (otra cuenta de prueba)

2. **En Ventana B:**
   - Minimiza la ventana o cambia a otra app
   - **Importante:** La app debe estar en segundo plano para ver la notificación push

3. **En Ventana A:**
   - Envía un mensaje al Usuario 2

4. **Resultado esperado:**
   - 🔔 Deberías ver una notificación del sistema en tu dispositivo
   - El título será el nombre del remitente
   - El cuerpo será el mensaje

### Paso 9: Verificar en la Consola del Backend

En la terminal del backend, deberías ver logs como:
```
[CHAT] New message sent: { chatId: '...', userId: '...' }
[PUSH] Sending push notifications to 1 user(s)
```

## 🔍 Troubleshooting

### "Notifications not supported"
- **Problema:** Tu navegador no soporta notificaciones
- **Solución:** Usa Chrome, Firefox, Edge o Safari

### "Notification permission denied"
- **Problema:** Rechazaste los permisos de notificación
- **Solución:** 
  1. Haz click en el candado 🔒 en la barra de direcciones
  2. Cambia los permisos de "Notificaciones" a "Permitir"
  3. Recarga la página

### "Failed to subscribe to push notifications"
- **Problema:** VAPID keys no configuradas correctamente
- **Solución:** Verifica que las VAPID keys estén en tu `.env` y reinicia el backend

### "No push notification received"
- **Problema:** Varios posibles
- **Solución:**
  1. Verifica que la app esté en **segundo plano** (minimizada o en otra pestaña)
  2. Verifica que la suscripción se haya guardado (check consola)
  3. Verifica logs del backend para errores
  4. Verifica que ngrok esté corriendo y la URL sea correcta

### "TypeError: web-push is not a function"
- **Problema:** La librería web-push no está instalada o no se importó correctamente
- **Solución:** 
  ```bash
  cd dogeub/backend
  npm install web-push
  ```

## ✅ Checklist Final

Antes de hacer deploy a Replit, verifica:

- [ ] Push notifications funcionan localmente con ngrok
- [ ] Notificaciones llegan cuando la app está en segundo plano
- [ ] El nombre del remitente aparece correctamente
- [ ] El mensaje se muestra correctamente
- [ ] Hacer click en la notificación abre el chat correcto
- [ ] No hay duplicados de notificaciones
- [ ] Los badges de mensajes sin leer se actualizan correctamente

## 🚀 Siguiente Paso: Deploy a Replit

Una vez que todo funcione localmente:

1. **Restaura `API_URL` en el frontend:**
   ```javascript
   const API_URL = '';  // Vacío para producción
   ```

2. **Agrega VAPID keys a Replit Secrets:**
   - Ve a tu Repl
   - Haz click en "Secrets" (🔐)
   - Agrega:
     - `VAPID_PUBLIC_KEY` = `BHHh...`
     - `VAPID_PRIVATE_KEY` = `kFCM...`
     - `VAPID_MAILTO` = `mailto:tu-email@example.com`

3. **Haz commit y push:**
   ```bash
   git add .
   git commit -m "feat: add push notifications support"
   git push
   ```

4. **Espera a que Replit haga rebuild automático**

5. **¡Listo!** Las notificaciones push deberían funcionar en producción.

---

## 💡 Notas Importantes

- **ngrok** es SOLO para testing local. En producción (Replit), las notificaciones funcionarán sin ngrok.
- Las **VAPID keys** son las mismas para local y producción.
- Puedes generar nuevas VAPID keys en cualquier momento con: `npx web-push generate-vapid-keys`
- Si generas nuevas keys, todos los usuarios deberán **resubscribirse** (cerrar sesión y volver a iniciar sesión).

---

**¿Preguntas?** Revisa la sección de Troubleshooting o contacta a soporte.

