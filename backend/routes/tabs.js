import express from 'express';
import supabase from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// Get personal tabs (bookmarks without space)
router.get('/', async (req, res) => {
  try {
    const { data: tabs, error } = await supabase
      .from('tabs')
      .select('*')
      .eq('user_id', req.userId)
      .is('space_id', null)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('Error fetching tabs:', error);
      return res.status(500).json({ error: 'Failed to fetch tabs' });
    }
    
    res.json({ tabs: tabs || [] });
  } catch (error) {
    console.error('Get tabs error:', error);
    res.status(500).json({ error: 'Failed to get tabs' });
  }
});

// Create tab
router.post('/', async (req, res) => {
  try {
    const { title, url, favicon, space_id, cookie_container_id, parent_id, position, avatar_emoji, avatar_color, avatar_photo, type } = req.body;
    
    if (!title || !url) {
      return res.status(400).json({ error: 'Title and URL required' });
    }
    
    // If space_id provided, verify access
    if (space_id) {
      const { data: space } = await supabase
        .from('spaces')
        .select('id, user_id')
        .eq('id', space_id)
        .single();
      
      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }
      
      if (space.user_id !== req.userId) {
        return res.status(403).json({ error: 'Not authorized to add tabs to this space' });
      }
    }
    
    // Build insert object, only including fields that exist
    const insertData = {
      user_id: req.userId,
      space_id: space_id || null,
      title,
      url,
      bookmark_url: url,
      favicon: favicon || null,
      cookie_container_id: cookie_container_id || 'default',
      parent_id: parent_id || null,
      position: position !== undefined ? position : 0,
      is_expanded: true,
      avatar_emoji: avatar_emoji || null,
      avatar_color: avatar_color !== undefined ? avatar_color : null,
      avatar_photo: avatar_photo || null
    };
    
    // Only add type if it's provided and column exists (graceful degradation)
    if (type) {
      insertData.type = type;
    }
    
    const { data: tab, error } = await supabase
      .from('tabs')
      .insert(insertData)
      .select('*')
      .single();
    
    if (error) {
      console.error('Error creating tab:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      // If error is about missing column 'type', try without it
      if (error.message && error.message.includes('column "type"') && type) {
        console.log('Retrying without type field...');
        delete insertData.type;
        const { data: retryTab, error: retryError } = await supabase
          .from('tabs')
          .insert(insertData)
          .select('*')
          .single();
        
        if (retryError) {
          return res.status(500).json({ error: 'Failed to create tab', details: retryError.message || retryError });
        }
        return res.json({ tab: retryTab });
      }
      return res.status(500).json({ error: 'Failed to create tab', details: error.message || error });
    }
    
    res.json({ tab });
  } catch (error) {
    console.error('Create tab error:', error);
    res.status(500).json({ error: 'Failed to create tab' });
  }
});

// Update tab
router.put('/:id', async (req, res) => {
  try {
    const { title, url, favicon, cookie_container_id, parent_id, position, is_expanded, avatar_emoji, avatar_color, avatar_photo } = req.body;
    
    const { data: existing } = await supabase
      .from('tabs')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();
    
    if (!existing) {
      return res.status(404).json({ error: 'Tab not found' });
    }
    
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (url !== undefined) updates.url = url;
    if (favicon !== undefined) updates.favicon = favicon;
    if (cookie_container_id !== undefined) updates.cookie_container_id = cookie_container_id;
    if (parent_id !== undefined) updates.parent_id = parent_id;
    if (position !== undefined) updates.position = position;
    if (is_expanded !== undefined) updates.is_expanded = is_expanded;
    if (avatar_emoji !== undefined) updates.avatar_emoji = avatar_emoji;
    if (avatar_color !== undefined) updates.avatar_color = avatar_color;
    if (avatar_photo !== undefined) updates.avatar_photo = avatar_photo;
    
    const { data: tab, error } = await supabase
      .from('tabs')
      .update(updates)
      .eq('id', req.params.id)
      .select('*')
      .single();
    
    if (error) {
      console.error('Error updating tab:', error);
      return res.status(500).json({ error: 'Failed to update tab' });
    }
    
    res.json({ tab });
  } catch (error) {
    console.error('Update tab error:', error);
    res.status(500).json({ error: 'Failed to update tab' });
  }
});

// Delete tab
router.delete('/:id', async (req, res) => {
  try {
    const { data: existing } = await supabase
      .from('tabs')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();
    
    if (!existing) {
      return res.status(404).json({ error: 'Tab not found' });
    }
    
    const { error } = await supabase
      .from('tabs')
      .delete()
      .eq('id', req.params.id);
    
    if (error) {
      console.error('Error deleting tab:', error);
      return res.status(500).json({ error: 'Failed to delete tab' });
    }
    
    res.json({ message: 'Tab deleted' });
  } catch (error) {
    console.error('Delete tab error:', error);
    res.status(500).json({ error: 'Failed to delete tab' });
  }
});

// Reorder tabs (batch update positions)
router.post('/reorder', async (req, res) => {
  try {
    const { updates } = req.body;
    
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'Updates must be an array' });
    }
    
    for (const update of updates) {
      await supabase
        .from('tabs')
        .update({ 
          parent_id: update.parent_id, 
          position: update.position 
        })
        .eq('id', update.id)
        .eq('user_id', req.userId);
    }
    
    res.json({ message: 'Tabs reordered' });
  } catch (error) {
    console.error('Reorder tabs error:', error);
    res.status(500).json({ error: 'Failed to reorder tabs' });
  }
});

export default router;

