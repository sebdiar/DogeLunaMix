import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dogeub-secret-key-change-in-production';

export const authenticate = async (req, res, next) => {
  try {
    console.log(`[AUTH] ${req.method} ${req.path}`);
    let token = null;
    
    // Try Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
    
    // Fallback to cookie
    if (!token && req.cookies && req.cookies.dogeub_token) {
      token = req.cookies.dogeub_token;
    }
    
    if (!token) {
      console.log('[AUTH] No token provided');
      return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
      console.log(`[AUTH] ✅ Authenticated user: ${req.userId}`);
      next();
    } catch (err) {
      console.log('[AUTH] Invalid token:', err.message);
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    console.error('[AUTH] Middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

export const generateToken = (user) => {
  return jwt.sign(
    { userId: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

export { JWT_SECRET };


















