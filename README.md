# DogeLunaMix

Browser-in-Browser frontend con integración LUNA y Notion.

## 🚀 Características

- **Browser-in-Browser**: Navegación segura a través de proxy (Scramjet/Ultraviolet)
- **Integración LUNA**: UI/UX inspirada en LUNA con sidebar vertical
- **Backend Express + Supabase**: Autenticación, tabs, espacios, chat
- **Integración Notion**: Sincronización bidireccional de proyectos
- **Webhooks**: Sincronización automática Notion ↔ DogeUB
- **Jerarquía de Proyectos**: Soporte para parents/sub-parents
- **Chat**: Sistema de mensajería integrado
- **AI Dashboards**: Soporte para dashboards personalizados

## 📋 Requisitos

- Node.js 18+
- Cuenta de Supabase
- (Opcional) Notion API key y Database ID para sincronización

## 🛠️ Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/sebdiar/DogeLunaMix.git
cd DogeLunaMix
```

### 2. Instalar dependencias

```bash
# Frontend
npm install

# Backend
cd backend
npm install
cd ..
```

### 3. Configurar variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# Supabase
SUPABASE_URL=tu_supabase_url
SUPABASE_KEY=tu_supabase_anon_key
SUPABASE_SERVICE_KEY=tu_supabase_service_role_key

# JWT
JWT_SECRET=tu_jwt_secret_seguro

# Backend
BACKEND_PORT=3001

# Notion (opcional)
NOTION_API_KEY=tu_notion_api_key
NOTION_DATABASE_ID=tu_notion_database_id
```

### 4. Ejecutar migraciones SQL

Ejecuta las migraciones en el orden indicado en `backend/migrations/` en el SQL Editor de Supabase:
- `001-initial-schema.sql`
- `002-add-type-column.sql`
- `003-add-notion-integration.sql`

### 5. Construir frontend

```bash
npm run build
```

### 6. Iniciar servidores

```bash
# Opción 1: Script automático
bash start-all.sh

# Opción 2: Manual
# Terminal 1 - Backend
cd backend && npm start

# Terminal 2 - Frontend
node server.js
```

La aplicación estará disponible en `http://localhost:2345/indev`

## 🌐 Deployment en Replit

Ver guía completa en [REPLIT_DEPLOY.md](./docs/REPLIT_DEPLOY.md)

1. Importa el proyecto en Replit
2. Configura las variables de entorno en Secrets
3. El proyecto se iniciará automáticamente

## 🔗 Webhooks de Notion

Para configurar sincronización automática con Notion, ver [backend/WEBHOOK_SETUP.md](./backend/WEBHOOK_SETUP.md)

## 📚 Estructura del Proyecto

```
dogeub/
├── backend/          # Backend Express + Supabase
│   ├── routes/       # Rutas API
│   ├── services/     # Servicios (Notion, etc.)
│   └── migrations/   # Migraciones SQL
├── src/              # Frontend React
│   ├── components/   # Componentes React
│   ├── pages/        # Páginas
│   └── static/       # Archivos estáticos (loader.html, scripts)
├── dist/             # Build del frontend (generado)
└── server.js         # Servidor Fastify para frontend
```

## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor:
1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Ver [LICENSE](./LICENSE) para más detalles.
