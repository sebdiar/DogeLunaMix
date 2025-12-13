# DogeUB Backend

Backend API para DogeUB con Express y Supabase.

## Configuración

1. **Configurar variables de entorno**

   Crea un archivo `.env` en la raíz del proyecto (`dogeub/.env`) con:

   ```env
   SUPABASE_URL=tu_supabase_url
   SUPABASE_KEY=tu_supabase_anon_key
   SUPABASE_SERVICE_KEY=tu_supabase_service_role_key
   JWT_SECRET=tu_jwt_secret_cambiar_en_produccion
   BACKEND_PORT=3001
   ```

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

