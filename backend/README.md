# DogeUB Backend

Backend API para DogeUB con Express y Supabase.

## Configuración

1. **Configurar variables de entorno**

   Crea un archivo `.env` en la raíz del proyecto (`dogeub/.env`) con:

   ```env
   SUPABASE_URL=tu_supabase_url
   SUPABASE_KEY=tu_supabase_anon_key
   SUPABASE_ANON_KEY=tu_supabase_anon_key  # Opcional: si está definido, se usa en lugar de SUPABASE_KEY para frontend
   SUPABASE_SERVICE_KEY=tu_supabase_service_role_key
   JWT_SECRET=tu_jwt_secret_cambiar_en_produccion
   BACKEND_PORT=3001
   NOTION_API_KEY=tu_notion_api_key  # Opcional: para sincronización con Notion
   NOTION_DATABASE_ID=tu_notion_database_id  # Opcional: ID de la base de datos de proyectos en Notion
   NOTION_USERS_DATABASE_ID=tu_notion_users_database_id  # Opcional: ID de la base de datos de usuarios en Notion
   NOTION_TASKS_DATABASE_ID=tu_notion_tasks_database_id  # Opcional: ID de la base de datos de tasks en Notion
   NOTION_TASKS_REMINDER_ENABLED=true  # Opcional: Habilitar recordatorios matutinos de tasks (default: false)
   NOTION_TASKS_REMINDER_HOUR=6  # Opcional: Hora para recordatorios en formato 24h (default: 6)
   ```
   
   **Nota sobre las claves de Supabase:**
   - `SUPABASE_KEY` o `SUPABASE_ANON_KEY`: Clave pública (anon key) - segura para frontend, respeta RLS
   - `SUPABASE_SERVICE_KEY`: Clave privada (service_role key) - solo para backend, bypass RLS
   - Puedes obtener ambas claves en tu dashboard de Supabase: Settings > API

2. **Ejecutar migración SQL**

   Ejecuta el archivo `backend/migrations/001-initial-schema.sql` en el SQL Editor de Supabase.

3. **Instalar dependencias**

   ```bash
   cd backend
   npm install
   ```

4. **Iniciar servidor**

   ```bash
   # Desarrollo (con watch)
   npm run dev

   # Producción
   npm start
   ```

## Integración con Notion Tasks

El backend puede integrarse con una base de datos de tasks de Notion para enviar mensajes del sistema automáticamente cuando se crean nuevos tasks y recordatorios matutinos para tasks que vencen hoy.

### Configuración

1. **Variables de entorno requeridas:**
   - `NOTION_TASKS_DATABASE_ID` - ID de la base de datos de tasks en Notion
   - `NOTION_API_KEY` - API key de Notion (ya debe estar configurada)

2. **Variables de entorno opcionales:**
   - `NOTION_TASKS_REMINDER_ENABLED=true` - Habilitar recordatorios matutinos (default: false)
   - `NOTION_TASKS_REMINDER_HOUR=6` - Hora para recordatorios en formato 24h (default: 6 AM)

3. **Configurar webhook en Notion:**
   - Ve a tu integración en Notion: https://www.notion.so/my-integrations
   - Configura un webhook que apunte a: `https://TU_DOMINIO/api/notion/webhook`
   - Selecciona la base de datos de tasks
   - Habilita el evento `page.created`

### Esquema de Mensajes del Sistema

**Mensaje de nuevo task:**
```
Nueva tarea: [Título del task]
Asignado: [Nombre del usuario] | Vence: [Fecha DD/MM/YYYY]
```

**Mensaje de recordatorio (tasks que vencen hoy):**
```
Recordatorio: [Título del task] vence hoy
Asignado: [Nombre del usuario]
```

### Requisitos de la Base de Datos de Tasks

La base de datos de tasks en Notion debe tener:
- Un campo de relación llamado "Project" que conecte con la base de datos de proyectos
- Un campo de tipo "Person" para el asignado (opcional)
- Un campo de tipo "Date" para la fecha de vencimiento (opcional)

## Endpoints

- `POST /api/auth/register` - Registrar usuario
- `POST /api/auth/login` - Iniciar sesión
- `GET /api/auth/me` - Obtener usuario actual
- `GET /api/tabs` - Obtener tabs personales
- `POST /api/tabs` - Crear tab
- `PUT /api/tabs/:id` - Actualizar tab
- `DELETE /api/tabs/:id` - Eliminar tab
- `GET /api/spaces` - Obtener spaces (proyectos/DMs)
- `POST /api/spaces` - Crear space
- `GET /api/spaces/:id` - Obtener space con tabs
- `GET /api/chat/space/:spaceId` - Obtener chat de un space
- `POST /api/chat/:chatId/messages` - Enviar mensaje

## Notas

- El backend usa JWT para autenticación
- Todas las rutas excepto `/api/auth/*` requieren autenticación
- El token se envía en el header: `Authorization: Bearer <token>`

