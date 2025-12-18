import express from 'express';
import supabase from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { getTaskDetails } from '../services/notion-tasks.js';
import { getOrCreateChatForSpace } from './chat.js';

const router = express.Router();

// Webhook endpoint debe ser público (sin autenticación) - Notion lo llama directamente
// Las demás rutas requieren autenticación
const authenticateExceptWebhook = (req, res, next) => {
  // Si es el webhook endpoint o el test endpoint, no requiere autenticación
  if ((req.path === '/webhook' || req.path === '/webhook-test') && req.method === 'POST') {
    return next();
  }
  // Para todas las demás rutas, usar autenticación normal
  return authenticate(req, res, next);
};

// Helper: Normalize Notion ID (remove hyphens for comparison)
// Notion IDs can come with or without hyphens depending on context
function normalizeNotionId(id) {
  if (!id) return null;
  return id.replace(/-/g, '').toLowerCase();
}

// Helper: Compare two Notion IDs (handles both formats)
function compareNotionIds(id1, id2) {
  if (!id1 || !id2) return false;
  return normalizeNotionId(id1) === normalizeNotionId(id2);
}

// Test endpoint to verify webhook handler logic (for local testing)
router.post('/webhook-test', async (req, res) => {
  try {
    console.log('🧪 TEST: Simulating webhook event');
    const testEvent = req.body;
    const tasksDatabaseId = process.env.NOTION_TASKS_DATABASE_ID;
    
    console.log('🧪 TEST: Tasks Database ID from env:', tasksDatabaseId);
    console.log('🧪 TEST: Normalized Tasks ID:', tasksDatabaseId ? normalizeNotionId(tasksDatabaseId) : null);
    console.log('🧪 TEST: Test event:', JSON.stringify(testEvent, null, 2));
    
    if (testEvent.parent?.database_id) {
      const receivedId = testEvent.parent.database_id;
      const normalizedReceived = normalizeNotionId(receivedId);
      const normalizedExpected = normalizeNotionId(tasksDatabaseId);
      const matches = compareNotionIds(receivedId, tasksDatabaseId);
      
      console.log('🧪 TEST: Comparison:', {
        received: receivedId,
        receivedNormalized: normalizedReceived,
        expected: tasksDatabaseId,
        expectedNormalized: normalizedExpected,
        matches
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Test completed - check server logs',
      tasksDatabaseId,
      normalizedTasksId: tasksDatabaseId ? normalizeNotionId(tasksDatabaseId) : null
    });
  } catch (error) {
    console.error('🧪 TEST Error:', error);
    res.status(500).json({ error: error.message });
  }
});

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
    // Manejar verificación de webhook (Notion envía un verification_token)
    if (req.body.type === 'webhook.verification' || req.body.verification_token) {
      const { verification_token } = req.body;
      console.log('🔑 Webhook verification token received:', verification_token);
      // Devolver el token de verificación para confirmar la suscripción
      return res.status(200).json({ verification_token });
    }
    
    // Get webhook event data
    const event = req.body;
    const tasksDatabaseId = process.env.NOTION_TASKS_DATABASE_ID;
    const projectsDatabaseId = process.env.NOTION_DATABASE_ID;
    
    // Log webhook event for debugging (FULL event structure)
    console.log('📥 Webhook received - FULL EVENT:', JSON.stringify(event, null, 2));
    console.log('📥 Webhook received - Summary:', {
      type: event.type,
      object: event.object,
      hasData: !!event.data,
      dataKeys: event.data ? Object.keys(event.data) : null,
      dataParentId: event.data?.parent?.database_id,
      dataParentType: event.data?.parent?.type,
      dataId: event.data?.id,
      fullDataParent: event.data?.parent,
      tasksDatabaseId,
      projectsDatabaseId,
      normalizedTasksId: tasksDatabaseId ? normalizeNotionId(tasksDatabaseId) : null,
      normalizedReceivedId: event.data?.parent?.database_id ? normalizeNotionId(event.data.parent.database_id) : null
    });
    
    // Check if this is a task event (from tasks database)
    // Notion webhook structure can be:
    // - { type: 'page.created', object: 'page', data: { id: '...', parent: { database_id: '...' } } }
    // - { type: 'database.updated', object: 'database', data: { id: '...' } } (when database changes)
    // - { type: 'page.created', object: 'page', data: { id: '...', parent: { type: 'database_id', database_id: '...' } } }
    
    // First, try to get the database ID from different possible locations
    let receivedDatabaseId = null;
    let pageId = null;
    
    if (event.data) {
      // For page events: event.data.parent.database_id
      if (event.data.parent?.database_id) {
        receivedDatabaseId = event.data.parent.database_id;
        pageId = event.data.id;
      }
      // For page events: event.data.parent.type === 'database_id' and database_id property
      else if (event.data.parent?.type === 'database_id' && event.data.parent.database_id) {
        receivedDatabaseId = event.data.parent.database_id;
        pageId = event.data.id;
      }
      // For database events: event.data.id might be the database ID
      else if (event.object === 'database' && event.data.id) {
        receivedDatabaseId = event.data.id;
      }
      // Try to get page ID from event.data.id
      if (event.data.id && !pageId) {
        pageId = event.data.id;
      }
    }
    
    console.log('🔍 Event analysis:', {
      eventType: event.type,
      eventObject: event.object,
      receivedDatabaseId,
      pageId,
      dataStructure: event.data ? Object.keys(event.data) : null,
      parentStructure: event.data?.parent ? Object.keys(event.data.parent) : null
    });
    
    // Check if this is a page event from tasks database
    if (tasksDatabaseId && event.type && event.type.startsWith('page.') && event.data && receivedDatabaseId) {
      // Verify the page belongs to tasks database (using normalized comparison)
      if (compareNotionIds(receivedDatabaseId, tasksDatabaseId)) {
        console.log('✅ Task event detected from tasks database');
        console.log('📋 Task details:', {
          taskId: pageId,
          databaseId: receivedDatabaseId,
          eventType: event.type
        });
        // This is a task event
        if (event.type === 'page.created') {
          console.log('📝 Processing task creation:', pageId);
          // Process new task creation asynchronously (don't block webhook response)
          handleTaskCreated(event.data, process.env.NOTION_API_KEY).catch(err => {
            console.error('❌ Error handling task creation:', err);
          });
        }
        // Respond quickly to Notion
        return res.status(200).json({ received: true, type: 'task' });
      } else {
        console.log('⚠️  Event from different database:', {
          received: receivedDatabaseId,
          receivedNormalized: receivedDatabaseId ? normalizeNotionId(receivedDatabaseId) : null,
          expected: tasksDatabaseId,
          expectedNormalized: tasksDatabaseId ? normalizeNotionId(tasksDatabaseId) : null,
          match: receivedDatabaseId ? compareNotionIds(receivedDatabaseId, tasksDatabaseId) : false,
          parentType: event.data?.parent?.type,
          fullParent: event.data?.parent
        });
      }
    }
    
    // Also check for database events that might indicate a task was created
    // Sometimes Notion sends database.updated when a page is added
    if (tasksDatabaseId && event.type && (event.type === 'database.updated' || event.object === 'database') && receivedDatabaseId) {
      if (compareNotionIds(receivedDatabaseId, tasksDatabaseId)) {
        console.log('⚠️  Database event received for tasks database, but we need a page.created event to process tasks');
        console.log('💡 This might indicate a task was created, but we need the page event to get task details');
        return res.status(200).json({ received: true, type: 'database', message: 'Database event received, waiting for page event' });
      }
    }
    
    // Check if this is a project event (from projects database)
    if (projectsDatabaseId && event.object === 'page' && event.data) {
      const pageData = event.data;
      const receivedDatabaseId = pageData.parent?.database_id;
      
      // Verify the page belongs to projects database (using normalized comparison)
      if (receivedDatabaseId && compareNotionIds(receivedDatabaseId, projectsDatabaseId)) {
        // This is a project event - handle as before (currently disabled)
        console.log('⚠️  Project webhook received but IGNORED - projects are only created from the app, not from Notion webhooks');
        return res.status(200).json({ received: true, message: 'Project webhook disabled - projects only created from app' });
      }
    }
    
    // Unknown event type - respond OK anyway
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

// Helper: Manejar creación de task
async function handleTaskCreated(taskData, apiKey) {
  try {
    if (!apiKey) {
      console.error('handleTaskCreated: No API key provided');
      return;
    }

    const taskId = taskData.id;
    console.log('📝 Handling task created:', taskId);

    // Get task details from Notion
    const taskDetails = await getTaskDetails(apiKey, taskId);
    
    console.log('📋 Task details:', {
      title: taskDetails.title,
      projectId: taskDetails.projectId,
      assignee: taskDetails.assignee,
      dueDate: taskDetails.dueDate
    });
    
    if (!taskDetails.projectId) {
      console.log('⚠️  Task has no project relation, skipping');
      return;
    }

    // Find project by notion_page_id
    console.log('🔍 Searching for project with Notion ID:', taskDetails.projectId);
    const { data: project, error: projectError } = await supabase
      .from('spaces')
      .select('id, name, user_id, notion_page_id')
      .eq('notion_page_id', taskDetails.projectId)
      .eq('category', 'project')
      .maybeSingle();

    if (projectError) {
      console.error('❌ Error searching for project:', projectError);
      return;
    }
    
    if (!project) {
      console.log(`⚠️  Project with Notion ID ${taskDetails.projectId} not found in database`);
      // Log all projects to help debug
      const { data: allProjects } = await supabase
        .from('spaces')
        .select('id, name, notion_page_id')
        .eq('category', 'project')
        .limit(10);
      console.log('📊 Available projects:', allProjects?.map(p => ({ name: p.name, notion_page_id: p.notion_page_id })));
      return;
    }
    
    console.log('✅ Found project:', project.name);

    // Get or create chat for the project
    // Use the project owner's user_id
    const chatId = await getOrCreateChatForSpace(project.id, project.user_id);
    
    if (!chatId) {
      console.error('Failed to get or create chat for project:', project.id);
      return;
    }

    // Build message text
    let messageText = `Nueva tarea: ${taskDetails.title}`;
    
    const parts = [];
    if (taskDetails.assignee) {
      parts.push(`Asignado: ${taskDetails.assignee}`);
    }
    if (taskDetails.dueDate) {
      // Format date as DD/MM/YYYY
      const date = new Date(taskDetails.dueDate);
      const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
      parts.push(`Vence: ${formattedDate}`);
    }
    
    if (parts.length > 0) {
      messageText += '\n' + parts.join(' | ');
    }

    // Send system message to chat
    const { error: messageError } = await supabase
      .from('chat_messages')
      .insert({
        chat_id: chatId,
        user_id: null, // null = system message
        message: messageText
      });

    if (messageError) {
      console.error('Error sending task message to chat:', messageError);
      throw messageError;
    }

    console.log(`✅ Task message sent to project "${project.name}" chat`);
  } catch (error) {
    console.error('Error handling task created:', error);
    throw error;
  }
}

export default router;

