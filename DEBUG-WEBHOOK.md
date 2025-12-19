# Debugging Notion Webhook con Túnel Local

## Pasos Rápidos

### 1. Iniciar el Backend Localmente

En una terminal, ve a la carpeta del backend e inícialo:

```bash
cd /Users/bass/Downloads/APPS/DogeLunaMix/dogeub/backend
npm run dev
```

Deberías ver: `DogeUB Backend running on port 3001`

### 2. Crear el Túnel HTTPS

En **otra terminal**, ejecuta:

```bash
cd /Users/bass/Downloads/APPS/DogeLunaMix/dogeub
node backend-tunnel.js
```

Verás algo como:
```
✅ Túnel creado exitosamente!
🌐 URL del backend (para webhook de Notion):
   https://abc123.trycloudflare.com/api/notion/webhook
```

### 3. Actualizar Webhook en Notion

1. Ve a la configuración de tu webhook en Notion
2. Cambia la URL del webhook a la URL que apareció en el paso 2 (ej: `https://abc123.trycloudflare.com/api/notion/webhook`)
3. Guarda los cambios

### 4. Probar

1. Crea un nuevo task en Notion
2. **Inmediatamente** verás los logs en la terminal donde está corriendo el backend
3. Los logs aparecerán en tiempo real, sin delay

### 5. Cuando Termines

- Presiona `Ctrl+C` en la terminal del túnel para cerrarlo
- **IMPORTANTE**: Vuelve a cambiar el webhook en Notion a la URL de Replit: `https://teneriadiaz.replit.app/api/notion/webhook`

## Ventajas del Túnel Local

✅ Logs inmediatos y claros  
✅ Puedes hacer cambios y ver resultados en segundos  
✅ No tienes que esperar por push/restart de Replit  
✅ Puedes usar Postman/curl para probar eventos simulados  

## Troubleshooting

**El backend no inicia:**
- Verifica que el puerto 3001 no esté ocupado: `lsof -ti:3001`
- Si está ocupado: `lsof -ti:3001 | xargs kill -9`

**El túnel no se crea:**
- Verifica que cloudflared esté instalado: `which cloudflared`
- Si no: `brew install cloudflared`

**No veo logs:**
- Asegúrate de que el backend esté corriendo en el puerto 3001
- Verifica que la URL del túnel sea correcta
