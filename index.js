const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = 3000;

// In-memory storage with auto-cleanup
const links = new Map();

// Cleanup expired links every hour
setInterval(() => {
  const now = new Date();
  for (const [linkId, linkData] of links) {
    if (now > linkData.expires) {
      links.delete(linkId);
    }
  }
  console.log(`Cleaned up expired links. Current links: ${links.size}`);
}, 60 * 60 * 1000); // Every hour

// Middleware
app.use(express.json());

// Enhanced CORS Configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Generate a new tracking link with enhanced features
app.post('/api/links', (req, res) => {
  try {
    const { expiresInHours = 24, campaign = 'default' } = req.body;
    
    // Validate input
    if (isNaN(expiresInHours) || expiresInHours < 1) {
      return res.status(400).json({ error: 'expiresInHours must be a number greater than 0' });
    }

    const linkId = uuidv4().split('-')[0];
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + parseInt(expiresInHours));
    
    links.set(linkId, {
      id: linkId,
      created: new Date(),
      expires: expiresAt,
      clicks: 0,
      uniqueClicks: 0,
      clickers: new Set(),
      campaign,
      lastAccessed: null
    });
    
    res.json({
      url: `${req.protocol}://${req.get('host')}/track/${linkId}?campaign=${campaign}`,
      id: linkId,
      expires: expiresAt.toISOString(),
      campaign,
      info: 'Share this link to track clicks'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Enhanced tracking with campaign support
app.get('/track/:linkId', (req, res) => {
  try {
    const { linkId } = req.params;
    const { campaign } = req.query;
    const linkData = links.get(linkId);
    
    if (!linkData) {
      return res.status(404).json({ error: 'Invalid tracking link' });
    }
    
    if (new Date() > linkData.expires) {
      return res.status(410).json({ error: 'Tracking link has expired' });
    }
    
    const clientId = req.ip + req.headers['user-agent'];
    
    // Update stats
    linkData.clicks++;
    linkData.lastAccessed = new Date();
    if (!linkData.clickers.has(clientId)) {
      linkData.uniqueClicks++;
      linkData.clickers.add(clientId);
    }
    
    // Update campaign if provided
    if (campaign) {
      linkData.campaign = campaign;
    }
    
    res.redirect('https://share-bug2.onrender.com');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Enhanced stats endpoint
app.get('/api/links/:linkId', (req, res) => {
  try {
    const { linkId } = req.params;
    const linkData = links.get(linkId);
    
    if (!linkData) {
      return res.status(404).json({ error: 'Link not found' });
    }
    
    const timeRemaining = Math.max(0, linkData.expires - new Date());
    
    res.json({
      id: linkData.id,
      clicks: linkData.clicks,
      uniqueClicks: linkData.uniqueClicks,
      created: linkData.created,
      expires: linkData.expires,
      isActive: new Date() < linkData.expires,
      campaign: linkData.campaign,
      lastAccessed: linkData.lastAccessed,
      timeRemaining: `${Math.floor(timeRemaining / (1000 * 60 * 60))} hours ${Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))} minutes`,
      clickThroughRate: linkData.clicks > 0 ? (linkData.uniqueClicks / linkData.clicks * 100).toFixed(2) + '%' : '0%'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New endpoint: Get all links (for dashboard)
app.get('/api/links', (req, res) => {
  try {
    const allLinks = Array.from(links.values()).map(link => ({
      id: link.id,
      created: link.created,
      expires: link.expires,
      clicks: link.clicks,
      uniqueClicks: link.uniqueClicks,
      campaign: link.campaign,
      isActive: new Date() < link.expires
    }));
    
    res.json({
      count: allLinks.length,
      active: allLinks.filter(link => link.isActive).length,
      links: allLinks
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

