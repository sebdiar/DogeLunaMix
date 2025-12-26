# 🚀 Guía de Deploy a Replit - Push Notifications

Esta guía te ayudará a deployar las notificaciones push a Replit una vez que las hayas probado localmente.

## 📋 Prerrequisitos

- ✅ Push notifications probadas localmente con ngrok
- ✅ Todo funcionando correctamente
- ✅ `API_URL` restaurado a `''` en `luna-integration.js`

## 🎯 Pasos de Deploy

### Paso 1: Agregar VAPID Keys a Replit Secrets

1. **Ve a tu proyecto en Replit:**
   - Abre [replit.com](https://replit.com)
   - Abre tu proyecto DogeLunaMix

2. **Abre el panel de Secrets:**
   - Haz click en el icono de candado 🔐 en el sidebar izquierdo
   - O busca "Secrets" en el panel de herramientas

3. **Agrega las siguientes secrets:**
   
   | Key | Value |
   |-----|-------|
   | `VAPID_PUBLIC_KEY` | `BHHhuWaVULh1G757aYjl08B0HZIR29nFwIjgm6gGNKkG3kJ76IYTEAKgXcYP5LoL0zEXIN5Gnz3IavLgHHsfnl4` |
   | `VAPID_PRIVATE_KEY` | `kFCM5MFVWm8ZqSmNOQc4LAeoB2tF5n3lTVRS8MGr2xE` |
   | `VAPID_MAILTO` | `mailto:tu-email@example.com` |

   ⚠️ **Reemplaza** `tu-email@example.com` con tu email real.

4. **Haz click en "Add Secret" para cada una**

### Paso 2: Verificar API_URL en Frontend

Asegúrate de que `API_URL` esté vacío:

```javascript
// dogeub/src/static/scripts/luna-integration.js (línea 2)
const API_URL = '';  // ✅ Debe estar vacío para producción
```

### Paso 3: Commit y Push

```bash
# Desde el directorio raíz del proyecto
git add .
git commit -m "feat: add push notifications support"
git push
```

### Paso 4: Actualizar Submodule en Replit (si es necesario)

Si estás usando un submodule para `dogeub`:

```bash
cd dogeub
git push origin main  # O tu branch principal
cd ..
git add dogeub
git commit -m "chore: update dogeub submodule - push notifications"
git push
```

### Paso 5: Esperar Rebuild Automático

- Replit detectará los cambios automáticamente
- El proyecto se rebuildeará
- Espera a que veas "✅ Ready" en la consola

### Paso 6: Verificar Logs del Backend

En la consola de Replit, deberías ver:

```
DogeUB Backend running on port 3001
✅ VAPID keys configured for push notifications
```

⚠️ **Si ves:**
```
⚠️  VAPID keys not configured - push notifications will not work
```

Entonces las secrets no se configuraron correctamente. Revisa el Paso 1.

### Paso 7: Probar en Producción

1. **Abre tu PWA instalada** (o abre la URL de Replit en el navegador)

2. **Inicia sesión**

3. **Acepta permisos de notificaciones** cuando se solicite

4. **Abre la consola del navegador** (F12) y verifica:
   ```
   Notification service worker registered
   Subscribed to push notifications
   Push subscription saved to server
   ```

5. **Envía un mensaje de prueba:**
   - Desde otro dispositivo o cuenta
   - Envía un mensaje a tu cuenta
   - Minimiza la app o cambia a otra app
   - Deberías recibir una notificación push 🔔

## ✅ Verificación Final

- [ ] Backend muestra "✅ VAPID keys configured"
- [ ] Frontend se suscribe correctamente a push
- [ ] Notificaciones llegan cuando la app está en segundo plano
- [ ] Hacer click en la notificación abre el chat correcto
- [ ] El nombre del remitente aparece correctamente
- [ ] No hay errores en la consola

## 🔍 Troubleshooting en Replit

### "VAPID keys not configured"
- **Problema:** Las secrets no se agregaron correctamente
- **Solución:** 
  1. Verifica que las 3 secrets estén en el panel de Secrets
  2. Verifica que los nombres sean EXACTOS (mayúsculas y minúsculas importan)
  3. Reinicia el Repl manualmente (Stop → Run)

### "Failed to subscribe to push notifications"
- **Problema:** El backend no puede procesar la suscripción
- **Solución:**
  1. Verifica que la tabla `push_subscriptions` exista en Supabase
  2. Verifica que la migración se haya corrido correctamente
  3. Revisa logs del backend en Replit para errores

### "Push notifications not arriving"
- **Problema:** Las notificaciones no llegan
- **Solución:**
  1. Verifica que la app esté **instalada como PWA** (no solo en el navegador)
  2. Verifica que los permisos de notificación estén aceptados en el sistema operativo
  3. Verifica logs del backend cuando se envía un mensaje
  4. En iOS, las notificaciones push tienen limitaciones (solo funcionan si la PWA está instalada)

### "TypeError: Cannot read property 'sendNotification' of undefined"
- **Problema:** web-push no está instalado en Replit
- **Solución:**
  1. Verifica que `web-push` esté en `dogeub/backend/package.json` dependencies
  2. Si no está, agrégalo y haz commit/push
  3. Replit lo instalará automáticamente al rebuilder

## 🔄 Rollback (si algo sale mal)

Si algo no funciona y necesitas volver atrás:

```bash
git revert HEAD  # Revierte el último commit
git push
```

Replit automáticamente volverá a la versión anterior.

## 📱 Testing en iOS (PWA instalada)

Para probar en iOS:

1. **Abre Safari** en tu iPhone/iPad
2. **Ve a tu URL de Replit**
3. **Instala la PWA:**
   - Toca el botón de compartir
   - Selecciona "Agregar a la pantalla de inicio"
4. **Abre la PWA desde la pantalla de inicio** (no desde Safari)
5. **Acepta permisos de notificación**
6. **Prueba enviando un mensaje**

⚠️ **Nota:** En iOS, las notificaciones push **solo funcionan cuando la PWA está instalada**. No funcionan en Safari regular.

## 📱 Testing en Android (PWA instalada)

Para probar en Android:

1. **Abre Chrome** en tu Android
2. **Ve a tu URL de Replit**
3. **Instala la PWA:**
   - Chrome te mostrará un banner de instalación
   - O ve a Menú → "Instalar app"
4. **Abre la PWA desde el cajón de apps**
5. **Acepta permisos de notificación**
6. **Prueba enviando un mensaje**

## 🎉 ¡Listo!

Si todo funciona correctamente, tus usuarios ahora recibirán notificaciones push cuando:
- Reciban un mensaje nuevo
- La app esté cerrada o en segundo plano
- Tengan permisos de notificación aceptados

---

## 💡 Mejoras Futuras (Opcional)

- [ ] Agregar sonido personalizado a las notificaciones
- [ ] Agregar acciones a las notificaciones (responder, marcar como leído)
- [ ] Agregar notificaciones para otros eventos (menciones, tareas, etc.)
- [ ] Agregar preferencias de notificación por usuario
- [ ] Agregar modo "No molestar"

---

**¿Todo funcionó?** ¡Felicidades! 🎉 Tus push notifications están live en producción.


