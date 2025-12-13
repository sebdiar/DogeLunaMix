import express from 'express';
import supabase from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Webhook endpoint debe ser público (sin autenticación) - Notion lo llama directamente
// Las demás rutas requieren autenticación
const authenticateExceptWebhook = (req, res, next) => {
  // Si es el webhook endpoint, no requiere autenticación
  if (req.path === '/webhook' && req.method === 'POST') {
    return next();
  }
  // Para todas las demás rutas, usar autenticación normal
  return authenticate(req, res, next);
};

router.use(authenticateExceptWebhook);

// Get Notion config for current user
router.get('/config', async (req, res) => {
  try {
    const { data: config, error } = await supabase
      .from('notion_config')
      .select('*')
      .eq('user_id', req.userId)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
      console.error('Error fetching Notion config:', error);
      return res.status(500).json({ error: 'Failed to fetch Notion config' });
    }
    
    // Return config or default empty config
    res.json({ 
      config: config || {
        user_id: req.userId,
        api_key: null,
        database_id: null,
        enabled: false
      }
    });
  } catch (error) {
    console.error('Get Notion config error:', error);
    res.status(500).json({ error: 'Failed to get Notion config' });
  }
});

// Create or update Notion config
router.post('/config', async (req, res) => {
  try {
    const { api_key, database_id, enabled } = req.body;
    
    // Check if config already exists
    const { data: existing } = await supabase
      .from('notion_config')
      .select('id')
      .eq('user_id', req.userId)
      .single();
    
    const configData = {
      user_id: req.userId,
      api_key: api_key || null,
      database_id: database_id || null,
      enabled: enabled !== undefined ? Boolean(enabled) : false,
      updated_at: new Date().toISOString()
    };
    
    let config;
    if (existing) {
      // Update existing
      const { data, error } = await supabase
        .from('notion_config')
        .update(configData)
        .eq('user_id', req.userId)
        .select('*')
        .single();
      
      if (error) {
        console.error('Error updating Notion config:', error);
        return res.status(500).json({ error: 'Failed to update Notion config' });
      }
      config = data;
    } else {
      // Create new
      const { data, error } = await supabase
        .from('notion_config')
        .insert(configData)
        .select('*')
        .single();
      
      if (error) {
        console.error('Error creating Notion config:', error);
        return res.status(500).json({ error: 'Failed to create Notion config' });
      }
      config = data;
    }
    
    // Don't return the API key for security
    const { api_key: _, ...safeConfig } = config;
    
    res.json({ config: safeConfig });
  } catch (error) {
    console.error('Save Notion config error:', error);
    res.status(500).json({ error: 'Failed to save Notion config' });
  }
});

// Webhook endpoint (NO requiere autenticación - Notion llama este endpoint)
// IMPORTANTE: Este endpoint debe ser público para que Notion pueda llamarlo
router.post('/webhook', async (req, res) => {
  try {
    // Notion envía un header X-Notion-Signature para verificar la autenticidad
    // Por ahora, confiamos en que viene de Notion (en producción, verificar la firma)
    const signature = req.headers['x-notion-signature'];
    
    // Obtener el evento del body
    const { object, type, data } = req.body;
    
    // Solo procesar eventos de páginas (pages)
    if (object !== 'page') {
      return res.status(200).json({ received: true, message: 'Not a page event, ignoring' });
    }
    
    // Obtener configuración global de Notion
    const apiKey = process.env.NOTION_API_KEY;
    const databaseId = process.env.NOTION_DATABASE_ID;
    
    if (!apiKey || !databaseId) {
      return res.status(200).json({ received: true, message: 'Notion not configured' });
    }
    
    // Procesar según el tipo de evento
    switch (type) {
      case 'page.created':
      case 'page.updated':
        await handlePageUpdate(data, apiKey, databaseId);
        break;
      case 'page.archived':
        await handlePageArchived(data);
        break;
      case 'page.deleted':
        await handlePageDeleted(data);
        break;
      default:
        console.log('Unhandled webhook event type:', type);
    }
    
    // Responder 200 OK inmediatamente (Notion espera respuesta rápida)
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    // Responder 200 para que Notion no reintente infinitamente
    res.status(200).json({ received: true, error: error.message });
  }
});

// Helper: Manejar creación/actualización de página
async function handlePageUpdate(pageData, apiKey, databaseId) {
  try {
    const pageId = pageData.id;
    
    // Verificar que la página pertenece a nuestra base de datos
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28'
      }
    });
    
    if (!response.ok) {
      console.error('Failed to fetch page from Notion:', response.statusText);
      return;
    }
    
    const page = await response.json();
    
    // Verificar que pertenece a nuestra database
    if (page.parent?.database_id !== databaseId) {
      return; // No es de nuestra database, ignorar
    }
    
    // Obtener nombre de la página
    let pageName = 'Untitled';
    if (page.properties?.Name?.title) {
      const titleArray = page.properties.Name.title;
      if (titleArray.length > 0 && titleArray[0].text) {
        pageName = titleArray[0].text.content;
      }
    }
    
    // Obtener parent_id si existe
    let parentNotionPageId = null;
    if (page.properties) {
      const parentPropNames = ['Parent item', 'Parent Item', 'Parent', 'parent', 'Parent_id'];
      for (const propName of parentPropNames) {
        if (page.properties[propName]?.type === 'relation' && 
            page.properties[propName].relation?.length > 0) {
          parentNotionPageId = page.properties[propName].relation[0].id;
          break;
        }
      }
    }
    
    // Obtener estado de Archive
    let isArchived = false;
    if (page.properties?.Archive?.type === 'checkbox') {
      isArchived = page.properties.Archive.checkbox || false;
    } else if (page.archived) {
      isArchived = true;
    }
    
    // Buscar espacio existente por notion_page_id
    const { data: existingSpace } = await supabase
      .from('spaces')
      .select('*')
      .eq('notion_page_id', pageId)
      .single();
    
    if (existingSpace) {
      // Actualizar espacio existente
      // Mapear parent_id de Notion a local
      let parentSpaceId = null;
      if (parentNotionPageId) {
        const { data: parentSpace } = await supabase
          .from('spaces')
          .select('id')
          .eq('notion_page_id', parentNotionPageId)
          .single();
        if (parentSpace) {
          parentSpaceId = parentSpace.id;
        }
      }
      
      await supabase
        .from('spaces')
        .update({
          name: pageName,
          parent_id: parentSpaceId,
          archived: isArchived,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingSpace.id);
    } else {
      // Página nueva en Notion que no existe localmente
      // NO creamos automáticamente - se sincronizará cuando el usuario cargue proyectos
      // Esto evita crear espacios para usuarios que no los necesitan
      console.log(`New Notion page detected (${pageId}: ${pageName}), will sync on next project load`);
    }
  } catch (error) {
    console.error('Error handling page update:', error);
    throw error;
  }
}

// Helper: Manejar página archivada
async function handlePageArchived(pageData) {
  try {
    const pageId = pageData.id;
    
    await supabase
      .from('spaces')
      .update({ archived: true })
      .eq('notion_page_id', pageId);
  } catch (error) {
    console.error('Error handling page archived:', error);
    throw error;
  }
}

// Helper: Manejar página eliminada
async function handlePageDeleted(pageData) {
  try {
    const pageId = pageData.id;
    
    // Marcamos como archivado en lugar de eliminar (para mantener historial)
    await supabase
      .from('spaces')
      .update({ archived: true })
      .eq('notion_page_id', pageId);
  } catch (error) {
    console.error('Error handling page deleted:', error);
    throw error;
  }
}

export default router;

