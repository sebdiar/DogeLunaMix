# ✅ Túneles de Cloudflare Activos - Push Notifications Testing

## 🎉 Todo está listo para probar!

### 🔗 URLs Activas

**Frontend (para abrir en el navegador):**
```
https://psychology-purple-influences-fraction.trycloudflare.com
```

**Backend (ya configurado en el frontend):**
```
https://mpegs-sewing-viewpicture-tale.trycloudflare.com
```

---

## 📱 Cómo probar las Push Notifications

### Paso 1: Abrir la app
Abre esta URL en tu navegador (Chrome, Edge, o Safari):
```
https://psychology-purple-influences-fraction.trycloudflare.com
```

### Paso 2: Iniciar sesión
- Inicia sesión con tu cuenta

### Paso 3: Aceptar permisos de notificación
- El navegador te pedirá permiso para mostrar notificaciones
- **Haz click en "Permitir"** ✅

### Paso 4: Verificar en la consola
1. Abre DevTools (F12 o clic derecho → Inspeccionar)
2. Ve a la pestaña "Console"
3. Deberías ver:
   ```
   Notification service worker registered
   Notification permission granted
   Subscribed to push notifications
   Push subscription saved to server
   ```

### Paso 5: Probar notificaciones
**Opción A - Desde otro dispositivo/cuenta:**
1. Abre la misma URL en otro dispositivo o navegador (con otra cuenta)
2. Envía un mensaje a tu cuenta principal
3. En tu dispositivo principal, **minimiza la ventana o cambia a otra app**
4. Deberías recibir una notificación push 🔔

**Opción B - Desde el mismo navegador (dos pestañas):**
1. Abre dos pestañas con diferentes cuentas
2. En la Pestaña 1: Minimiza o cambia de pestaña
3. En la Pestaña 2: Envía un mensaje al usuario de la Pestaña 1
4. Deberías ver una notificación del sistema

---

## ✅ Qué verificar

- [ ] El navegador pide permiso de notificaciones
- [ ] La consola muestra "Subscribed to push notifications"
- [ ] Al enviar un mensaje, aparece una notificación del sistema
- [ ] El nombre del remitente aparece correctamente
- [ ] Al hacer click en la notificación, se abre el chat correcto
- [ ] NO hay notificaciones duplicadas

---

## 🔍 Troubleshooting

### No me pide permisos de notificación
- Verifica que no hayas bloqueado las notificaciones antes
- Ve a la configuración del sitio (candado 🔒 en la barra de direcciones)
- Cambia los permisos de notificación a "Preguntar" o "Permitir"
- Recarga la página

### "Failed to subscribe to push notifications"
- Verifica que el backend esté corriendo (debería mostrar logs en la terminal)
- Verifica que la tabla `push_subscriptions` exista en Supabase
- Revisa la consola del navegador para más detalles del error

### No me llegan notificaciones
- **Importante:** La app debe estar en segundo plano o minimizada
- Verifica que los permisos estén aceptados en el sistema operativo
- Verifica los logs del backend cuando se envía un mensaje
- Prueba desde otro navegador/dispositivo

### "ERR_BLOCKED_BY_CLIENT" en la consola
- Es normal, es un bloqueador de anuncios
- No afecta el funcionamiento de las push notifications

---

## 🛑 Para detener todo

Cuando termines de probar, detén los servicios:

```bash
# 1. Detener túneles de Cloudflare
pkill -f cloudflared

# 2. Detener backend
lsof -ti:3001 | xargs kill -9

# 3. Detener frontend
lsof -ti:5174 | xargs kill -9
```

O simplemente cierra las terminales donde están corriendo.

---

## 📝 Después de probar

Cuando termines de probar y todo funcione:

1. **Restaurar API_URL:**
   - Abre `dogeub/src/static/scripts/luna-integration.js`
   - Cambia la línea 3 de vuelta a:
     ```javascript
     const API_URL = '';
     ```

2. **Commit los cambios (sin el API_URL):**
   ```bash
   git add .
   git commit -m "feat: add push notifications support"
   git push
   ```

3. **Deploy a Replit:**
   - Sigue la guía: `DEPLOY_TO_REPLIT.md`
   - Agrega las VAPID keys a Replit Secrets
   - Espera el rebuild
   - ¡Listo!

---

## 🎉 ¡Disfruta probando las notificaciones push!

Si todo funciona aquí con los túneles de Cloudflare, funcionará perfectamente en Replit.



