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
// TEMPORALMENTE DESHABILITADO: Los proyectos solo se crean desde la app, no desde webhooks
router.post('/webhook', async (req, res) => {
  try {
    // WEBHOOK DESHABILITADO TEMPORALMENTE
    // Los proyectos solo se crean cuando el usuario los crea en la app (POST /api/spaces)
    // El webhook NO debe crear proyectos automáticamente
    console.log('⚠️  Webhook received but IGNORED - projects are only created from the app, not from Notion webhooks');
    
    // Manejar verificación de webhook (Notion envía un verification_token)
    if (req.body.type === 'webhook.verification' || req.body.verification_token) {
      const { verification_token } = req.body;
      console.log('🔑 Webhook verification token received:', verification_token);
      // Devolver el token de verificación para confirmar la suscripción
      return res.status(200).json({ verification_token });
    }
    
    // Responder 200 OK pero no procesar nada (evitar creación automática de proyectos)
    res.status(200).json({ received: true, message: 'Webhook disabled - projects only created from app' });
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
    
    // Buscar TODOS los espacios existentes por notion_page_id (puede haber uno por cada usuario)
    const { data: allExistingSpaces } = await supabase
      .from('spaces')
      .select('*')
      .eq('notion_page_id', pageId)
      .eq('category', 'project')
      .order('created_at', { ascending: true });
    
    // Agrupar por user_id para detectar duplicados por usuario
    const spacesByUserId = new Map();
    if (allExistingSpaces) {
      for (const space of allExistingSpaces) {
        if (!spacesByUserId.has(space.user_id)) {
          spacesByUserId.set(space.user_id, []);
        }
        spacesByUserId.get(space.user_id).push(space);
      }
    }
    
    // Para cada usuario, eliminar duplicados (mantener solo el más antiguo)
    const spacesToUpdate = [];
    for (const [userId, userSpaces] of spacesByUserId.entries()) {
      if (userSpaces.length > 1) {
        // Hay duplicados para este usuario, eliminar los más recientes
        userSpaces.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const original = userSpaces[0];
        const duplicates = userSpaces.slice(1);
        
        console.log(`⚠️ Found ${duplicates.length} duplicate(s) for user ${userId} and notion_page_id ${pageId}, removing duplicates...`);
        
        for (const duplicate of duplicates) {
          const { error: deleteError } = await supabase
            .from('spaces')
            .delete()
            .eq('id', duplicate.id);
          
          if (deleteError) {
            console.error(`Error deleting duplicate project ${duplicate.id}:`, deleteError);
          } else {
            console.log(`✅ Deleted duplicate project ${duplicate.id} (user: ${userId}, notion_page_id: ${pageId})`);
          }
        }
        
        spacesToUpdate.push(original);
      } else if (userSpaces.length === 1) {
        spacesToUpdate.push(userSpaces[0]);
      }
    }
    
    // Actualizar TODOS los espacios (uno por cada usuario) con los datos de Notion
    if (spacesToUpdate.length > 0) {
      // Actualizar cada espacio según su usuario
      for (const space of spacesToUpdate) {
        // Para parent_id, buscar el espacio del mismo usuario con el parent notion_page_id
        let parentSpaceId = null;
        if (parentNotionPageId) {
          const { data: userParentSpace } = await supabase
            .from('spaces')
            .select('id')
            .eq('notion_page_id', parentNotionPageId)
            .eq('user_id', space.user_id)
            .eq('category', 'project')
            .maybeSingle();
          
          if (userParentSpace) {
            parentSpaceId = userParentSpace.id;
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
          .eq('id', space.id);
      }
    } else {
      // Página nueva en Notion que no existe localmente
      // NO creamos automáticamente - los proyectos solo se crean cuando el usuario los crea en la app
      // El flujo es: Usuario crea proyecto en app → se crea en Notion (no al revés)
      console.log(`New Notion page detected (${pageId}: ${pageName}), but NOT creating locally - projects are only created from the app`);
      // No hacer nada - los proyectos se crean únicamente desde la aplicación, no desde webhooks de Notion
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
    const pageId = pageData?.id || pageData;
    
    if (!pageId) {
      console.error('handlePageDeleted: No pageId provided', pageData);
      return;
    }
    
    console.log('🗑️ Handling page deleted:', pageId);
    
    // Buscar el espacio por notion_page_id
    const { data: space, error: findError } = await supabase
      .from('spaces')
      .select('id, name')
      .eq('notion_page_id', pageId)
      .single();
    
    if (findError || !space) {
      console.log(`Space with Notion ID ${pageId} not found, may have been already deleted`);
      return;
    }
    
    // Marcamos como archivado en lugar de eliminar (para mantener historial)
    const { error: updateError } = await supabase
      .from('spaces')
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq('notion_page_id', pageId);
    
    if (updateError) {
      console.error('Error archiving space from deleted page:', updateError);
      throw updateError;
    }
    
    console.log(`✅ Space "${space.name}" archived from deleted Notion page`);
  } catch (error) {
    console.error('Error handling page deleted:', error);
    throw error;
  }
}

export default router;

