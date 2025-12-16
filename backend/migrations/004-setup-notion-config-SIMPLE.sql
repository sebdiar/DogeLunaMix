-- =====================================================
-- DOGEUB - SETUP NOTION CONFIG (GLOBAL - RECOMENDADO)
-- =====================================================
-- 
-- OPCIÓN 1: Usar variables de entorno (RECOMENDADO)
-- Agrega estas líneas a tu archivo .env en la raíz del proyecto:
--
-- NOTION_API_KEY=secret_tu_api_key_aqui
-- NOTION_DATABASE_ID=tu_database_id_aqui
--
-- Si usas variables de entorno, NO necesitas ejecutar este SQL.
-- El backend las usará automáticamente para todos los usuarios.
--
-- =====================================================
-- OPCIÓN 2: Configuración por usuario (si cada usuario tiene su propia DB)
-- =====================================================
-- Si cada usuario necesita su propia base de datos de Notion,
-- ejecuta este SQL reemplazando los valores:

INSERT INTO notion_config (user_id, api_key, database_id, enabled)
SELECT 
  u.id,
  'secret_tu_api_key_aqui',     -- Reemplaza con tu API key de Notion (comienza con "secret_")
  'tu_database_id_aqui',        -- Reemplaza con tu Database ID (UUID sin guiones o con guiones)
  true
FROM users u
WHERE u.email = 'sebdiar@gmail.com'  -- Tu email
ON CONFLICT (user_id) 
DO UPDATE SET 
  api_key = EXCLUDED.api_key,
  database_id = EXCLUDED.database_id,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

-- =====================================================
-- Obtener tu API key de Notion:
-- 1. Ve a https://www.notion.so/my-integrations
-- 2. Crea una nueva integración (o usa una existente)
-- 3. Copia el "Internal Integration Token" (comienza con "secret_")
--
-- Obtener tu Database ID:
-- 1. Abre tu base de datos de Notion
-- 2. Copia la URL, el ID está en la URL
--    Ejemplo: https://www.notion.so/32caracteres1234567890abcdef?v=...
--    El Database ID son los 32 caracteres después de / (sin guiones)
--    O si tiene guiones: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
-- =====================================================














