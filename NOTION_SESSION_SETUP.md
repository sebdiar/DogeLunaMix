# Configuración de Sesión Compartida de Notion

## ¿Qué hace esto?

Permite que todos los usuarios vean la misma cuenta de Notion automáticamente, sin necesidad de hacer login. Es como tener un VPS donde todos comparten la misma sesión.

## Pasos para configurar:

### 1. Obtener las cookies de sesión de Notion

1. Abre tu cuenta de Notion en el navegador (Chrome/Firefox)
2. Abre las DevTools (F12)
3. Ve a la pestaña **Application** (Chrome) o **Storage** (Firefox)
4. En el menú lateral, expande **Cookies** > `https://www.notion.so`
5. Copia los valores de las siguientes cookies importantes:
   - `token_v2` (muy importante - token de autenticación)
   - `notion_user_id` (ID del usuario)
   - `notion_browser_id` (ID del navegador)
   - `notion_session` (sesión)
   - `notion_locale` (opcional - locale)
   - `notion_theme` (opcional - tema)

### 2. Formatear las cookies

Formatea las cookies así (separadas por punto y coma y espacio):

```
token_v2=tu_token_aqui; notion_user_id=tu_user_id_aqui; notion_browser_id=tu_browser_id_aqui; notion_session=tu_session_aqui
```

Ejemplo completo:
```
token_v2=v2%3Aabc123def456...; notion_user_id=abc-123-def; notion_browser_id=xyz-789; notion_session=session_token_here; notion_locale=es; notion_theme=light
```

**Importante:** 
- Mantén los valores URL-encoded si Notion los tiene así (como `v2%3A` en lugar de `v2:`)
- Las cookies menos importantes (`notion_locale`, `notion_theme`) son opcionales pero recomendadas

### 3. Configurar en Cloudflare Worker

1. Ve a tu Cloudflare Dashboard
2. Selecciona **Workers & Pages** > Tu worker (silent-queen-f1d8 o el que uses)
3. Ve a **Settings** > **Variables**
4. Agrega una nueva variable:
   - **Variable name:** `NOTION_SESSION_COOKIES`
   - **Value:** Pega el string de cookies formateado del paso 2
5. Haz clic en **Save**

### 4. Desplegar cambios

Si modificaste el código del Worker, asegúrate de hacer **Deploy** para aplicar los cambios.

## Actualizar las cookies cuando expiren

Las cookies de Notion pueden expirar. Para actualizarlas:

1. Repite el paso 1 para obtener las nuevas cookies
2. Ve a Cloudflare Dashboard > Workers & Pages > Tu worker > Settings > Variables
3. Actualiza el valor de `NOTION_SESSION_COOKIES`
4. Guarda los cambios

**Nota:** Puedes hacer un "hard refresh" (Ctrl+Shift+R / Cmd+Shift+R) en la app para que tome las nuevas cookies sin necesidad de redeployar el Worker (si solo cambiaste la variable).

## Troubleshooting

### Las cookies no funcionan
- Verifica que los nombres de las cookies estén correctos (case-sensitive)
- Asegúrate de que `token_v2` esté presente y sea válido
- Verifica que no haya espacios extra en el string

### La sesión expira
- Las cookies de Notion pueden expirar después de un tiempo
- Si todos los usuarios pierden acceso, actualiza las cookies siguiendo los pasos anteriores

### Algunos usuarios ven otra cuenta
- Esto no debería pasar si está configurado correctamente
- Verifica que el Worker esté desplegado con los últimos cambios
- Limpia la caché del navegador y recarga


