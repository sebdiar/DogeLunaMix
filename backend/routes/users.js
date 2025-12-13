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

export default router;

