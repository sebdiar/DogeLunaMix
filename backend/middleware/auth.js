import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dogeub-secret-key-change-in-production';

export const authenticate = async (req, res, next) => {
  try {
    console.log(`[AUTH] ${req.method} ${req.path}`);
    console.log(`[AUTH] Headers:`, {
      authorization: req.headers.authorization ? 'present' : 'missing',
      cookie: req.headers.cookie ? req.headers.cookie.substring(0, 100) : 'missing',
      cookies_parsed: req.cookies ? Object.keys(req.cookies) : 'none'
    });
    
    let token = null;
    
    // Try Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
      console.log('[AUTH] Token from Authorization header');
    }
    
    // Fallback to cookie
    if (!token && req.cookies && req.cookies.dogeub_token) {
      token = req.cookies.dogeub_token;
      console.log('[AUTH] Token from cookie (parsed)');
    } else if (!token && req.headers.cookie) {
      // Try to extract from raw cookie header as fallback
      const cookieMatch = req.headers.cookie.match(/dogeub_token=([^;]+)/);
      if (cookieMatch) {
        token = cookieMatch[1];
        console.log('[AUTH] Token from cookie (raw header)');
      }
    }
    
    if (!token) {
      console.log('[AUTH] ❌ No token provided');
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


















