# Migración 012: Notificaciones Automáticas de Mensajes

Esta migración implementa un trigger de PostgreSQL que automáticamente envía notificaciones push cuando se inserta cualquier mensaje en `chat_messages`, sin importar si es un mensaje de usuario o del sistema.

## ¿Qué hace?

1. **Crea una función PostgreSQL** (`notify_chat_message_inserted`) que:
   - Se ejecuta automáticamente después de cada INSERT en `chat_messages`
   - Envía una petición HTTP al backend para procesar las notificaciones push
   - Funciona para mensajes de usuario (`user_id` no null) y mensajes del sistema (`user_id` null)

2. **Crea un trigger** que ejecuta la función automáticamente

## Configuración Requerida

### 1. Ejecutar la migración

Ejecuta el archivo `012-auto-notify-chat-messages.sql` en el SQL Editor de Supabase.

### 2. Configurar la URL del Backend

Necesitas configurar la URL de tu backend para que el trigger sepa dónde enviar las notificaciones.

**Opción A: Configuración global (recomendada)**

En el SQL Editor de Supabase, ejecuta:

```sql
ALTER DATABASE postgres SET app.backend_url = 'https://tu-backend.com';
```

Reemplaza `https://tu-backend.com` con la URL real de tu backend (ej: `https://teneriadiaz.replit.app`).

**Opción B: Configuración por sesión**

Si no puedes cambiar la configuración global, puedes configurarla por sesión:

```sql
SET app.backend_url = 'https://tu-backend.com';
```

**Opción C: Editar la migración**

Si ninguna de las opciones anteriores funciona, edita la línea en `012-auto-notify-chat-messages.sql`:

```sql
'http://localhost:3001'  -- Cambia esto a tu URL de producción
```

### 3. Verificar que pg_net esté habilitado

Supabase tiene `pg_net` habilitado por defecto, pero si encuentras errores, verifica:

```sql
SELECT * FROM pg_available_extensions WHERE name = 'pg_net';
```

Si no está disponible, puedes habilitarlo (aunque normalmente ya está):

```sql
CREATE EXTENSION IF NOT EXISTS pg_net;
```

## ¿Cómo funciona?

1. Cuando se inserta un mensaje en `chat_messages` (desde cualquier lugar):
   - El trigger se ejecuta automáticamente
   - La función hace una petición HTTP POST a `/api/chat/internal/notify-message`
   - El endpoint del backend procesa la notificación y envía push notifications

2. **Ventajas**:
   - ✅ Automático para TODOS los mensajes (usuario y sistema)
   - ✅ No necesitas recordar llamar funciones manualmente
   - ✅ Consistente en todo el código
   - ✅ Funciona incluso si el mensaje se inserta desde otro lugar

3. **Fallback**:
   - Si `pg_net` no está disponible o falla, el trigger registra un warning pero no rompe la inserción del mensaje
   - El mensaje se guarda correctamente aunque la notificación falle

## Testing

Para verificar que funciona:

1. **Inserta un mensaje de prueba** desde cualquier lugar (API, directamente en la DB, etc.)
2. **Verifica los logs** del backend - deberías ver una petición a `/api/chat/internal/notify-message`
3. **Verifica que lleguen las notificaciones push** a los participantes del chat

## Troubleshooting

### El trigger no envía notificaciones

1. Verifica que la URL del backend esté configurada correctamente
2. Verifica que `pg_net` esté habilitado
3. Revisa los logs de Supabase para ver si hay errores en la función
4. Verifica que el endpoint `/api/chat/internal/notify-message` esté funcionando

### Notificaciones duplicadas

Si ves notificaciones duplicadas, significa que todavía hay código que envía notificaciones manualmente. Busca y remueve cualquier llamada a `sendSystemMessageNotifications` o código similar.

### El trigger falla silenciosamente

El trigger está diseñado para no fallar aunque haya errores (para no romper la inserción de mensajes). Revisa los warnings en los logs de Supabase.

## Notas Importantes

- El trigger usa `SECURITY DEFINER` para poder hacer peticiones HTTP
- El endpoint interno verifica el header `X-Internal-Request` para seguridad
- Si el trigger falla, el mensaje se guarda igual (no se rompe la funcionalidad principal)

