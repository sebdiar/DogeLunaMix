# Deployment en Replit - Guía Completa

## Paso 1: Preparar el Proyecto en Replit

1. **Crear nuevo Repl**
   - Ve a https://replit.com
   - Crea un nuevo "Node.js" Repl
   - Importa el proyecto (o clona desde Git)

2. **Instalar dependencias**
   ```bash
   npm install
   cd backend && npm install && cd ..
   ```

## Paso 2: Configurar Variables de Entorno

Ve a la pestaña **Secrets** (🔒) en Replit y agrega:

```
SUPABASE_URL=tu_supabase_url
SUPABASE_KEY=tu_supabase_anon_key
SUPABASE_SERVICE_KEY=tu_supabase_service_role_key
JWT_SECRET=tu_jwt_secret_seguro
NOTION_API_KEY=tu_notion_api_key
NOTION_DATABASE_ID=tu_notion_database_id
PORT=3000
BACKEND_PORT=3001
```

**Nota:** Replit asignará automáticamente el puerto del frontend (PORT), pero puedes especificarlo.

## Paso 3: Construir el Frontend

Ejecuta una vez para construir:
```bash
npm run build
```

## Paso 4: Iniciar la Aplicación

Replit usará automáticamente el comando `npm run start:replit` configurado en `.replit`.

Esto iniciará:
- **Backend** en puerto `BACKEND_PORT` (3001 por defecto)
- **Frontend** en puerto `PORT` (asignado por Replit)

## Paso 5: Obtener URL para Webhooks

Una vez que la aplicación esté corriendo:

1. Replit te dará una URL como: `https://TU-PROYECTO.replit.app`
2. Tu webhook endpoint será: `https://TU-PROYECTO.replit.app/api/notion/webhook`
3. Usa esta URL para configurar el webhook en Notion

## Estructura de Puertos en Replit

- **Frontend (Fastify)**: Usa `process.env.PORT` (Replit lo asigna automáticamente)
- **Backend (Express)**: Usa `process.env.BACKEND_PORT` (3001 por defecto, o PORT + 1)

**IMPORTANTE:** En Replit, solo el puerto principal (PORT) es público. Necesitamos que el backend sea accesible desde el frontend. 

### Solución: Proxy en el Frontend

El frontend debe hacer proxy de las requests a `/api/*` hacia el backend. Esto requiere modificar `server.js` para que actúe como proxy.

## Alternativa: Un solo servidor

Para simplificar, podemos hacer que el frontend sirva también las rutas del backend usando un proxy.

## Troubleshooting

- **"Backend no responde"**: Verifica que BACKEND_PORT esté configurado
- **"Build failed"**: Ejecuta `npm run build` manualmente
- **"Port already in use"**: Cambia BACKEND_PORT a otro puerto

















