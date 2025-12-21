-- SCRIPT PARA BORRAR TODOS LOS CHATS DE USUARIOS (DMs)
-- ⚠️ ESTE SCRIPT BORRA PERMANENTEMENTE LOS MENSAJES Y CHATS DE USUARIOS
-- NO AFECTA PROYECTOS NI USUARIOS EN LA TABLA 'users'

-- Paso 1: Obtener los IDs de chats asociados a spaces de categoría "user"
WITH user_space_chats AS (
  SELECT sc.chat_id
  FROM space_chats sc
  JOIN spaces s ON sc.space_id = s.id
  WHERE s.category = 'user'
)

-- Paso 2: Borrar mensajes de esos chats
DELETE FROM chat_messages
WHERE chat_id IN (SELECT chat_id FROM user_space_chats);

-- Paso 3: Borrar participantes de esos chats
DELETE FROM chat_participants
WHERE chat_id IN (
  SELECT sc.chat_id
  FROM space_chats sc
  JOIN spaces s ON sc.space_id = s.id
  WHERE s.category = 'user'
);

-- Paso 4: Borrar relaciones space_chats para spaces de usuario
DELETE FROM space_chats
WHERE space_id IN (
  SELECT id FROM spaces WHERE category = 'user'
);

-- Paso 5: Borrar los chats huérfanos (sin ninguna relación en space_chats)
DELETE FROM chats
WHERE id NOT IN (SELECT chat_id FROM space_chats);

-- Paso 6: Borrar los spaces de categoría "user"
DELETE FROM spaces
WHERE category = 'user';

-- Paso 7: Borrar read status de chats que ya no existen
DELETE FROM chat_message_reads
WHERE chat_id NOT IN (SELECT id FROM chats);

