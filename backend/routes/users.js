import express from 'express';
import supabase from '../config/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// Get all users (for creating DMs)
router.get('/', async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, name, created_at')
      .neq('id', req.userId)
      .order('name', { ascending: true });
    
    if (error) {
      console.error('Error fetching users:', error);
      return res.status(500).json({ error: 'Failed to fetch users' });
    }
    
    res.json({ users: users || [] });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Search users by name or email
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ users: [] });
    }
    
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, name')
      .neq('id', req.userId)
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(10);
    
    if (error) {
      console.error('Error searching users:', error);
      return res.status(500).json({ error: 'Search failed' });
    }
    
    res.json({ users: users || [] });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get Supabase public credentials for frontend Realtime
router.get('/supabase-config', async (req, res) => {
  try {
    // Return public credentials (safe to expose to frontend)
    // Try SUPABASE_ANON_KEY first, then SUPABASE_KEY as fallback
    // SUPABASE_KEY should be the anon/public key (not service_role key)
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    let supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim();
    
    // Fallback to SUPABASE_KEY if SUPABASE_ANON_KEY is not set
    // This assumes SUPABASE_KEY is the anon key (public key)
    if (!supabaseAnonKey) {
      supabaseAnonKey = process.env.SUPABASE_KEY?.trim();
    }
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Missing Supabase config for frontend:', {
        url: supabaseUrl ? 'SET' : 'MISSING',
        anonKey: supabaseAnonKey ? 'SET' : 'MISSING'
      });
      return res.status(500).json({ error: 'Supabase configuration missing' });
    }
    
    res.json({
      url: supabaseUrl,
      anonKey: supabaseAnonKey
    });
  } catch (error) {
    console.error('Get Supabase config error:', error);
    res.status(500).json({ error: 'Failed to get Supabase config' });
  }
});

// Get user preferences (for tabs in "More" dropdown)
router.get('/preferences', async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('metadata')
      .eq('id', req.userId)
      .single();
    
    if (error) {
      console.error('Error fetching user preferences:', error);
      return res.status(500).json({ error: 'Failed to fetch preferences' });
    }
    
    const metadata = user?.metadata || {};
    const preferences = {
      desktop_more_tab_ids: metadata.desktop_more_tab_ids || [],
      mobile_more_tab_ids: metadata.mobile_more_tab_ids || []
    };
    
    res.json({ preferences });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

// Update user preferences
router.put('/preferences', async (req, res) => {
  try {
    const { desktop_more_tab_ids, mobile_more_tab_ids } = req.body;
    
    // Get current metadata
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('metadata')
      .eq('id', req.userId)
      .single();
    
    if (fetchError) {
      console.error('Error fetching user for preferences update:', fetchError);
      return res.status(500).json({ error: 'Failed to update preferences' });
    }
    
    const currentMetadata = user?.metadata || {};
    const updatedMetadata = {
      ...currentMetadata,
      ...(desktop_more_tab_ids !== undefined && { desktop_more_tab_ids }),
      ...(mobile_more_tab_ids !== undefined && { mobile_more_tab_ids })
    };
    
    const { error: updateError } = await supabase
      .from('users')
      .update({ metadata: updatedMetadata })
      .eq('id', req.userId);
    
    if (updateError) {
      console.error('Error updating user preferences:', updateError);
      return res.status(500).json({ error: 'Failed to update preferences' });
    }
    
    res.json({ 
      preferences: {
        desktop_more_tab_ids: updatedMetadata.desktop_more_tab_ids || [],
        mobile_more_tab_ids: updatedMetadata.mobile_more_tab_ids || []
      }
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

export default router;

