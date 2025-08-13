require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// 🟢 CREATE NEW LINK
app.post('/api/links', async (req, res) => {
  try {
    const { expiresInHours = 24, campaign = 'default' } = req.body;
    if (isNaN(expiresInHours) || expiresInHours < 1) {
      return res.status(400).json({ error: 'expiresInHours must be a number greater than 0' });
    }

    const linkId = uuidv4().split('-')[0];
    const createdAt = new Date();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + parseInt(expiresInHours));

    await pool.query(
      `INSERT INTO links (id, created, expires, clicks, unique_clicks, clickers, campaign, last_accessed)
       VALUES ($1, $2, $3, 0, 0, ARRAY[]::TEXT[], $4, NULL)`,
      [linkId, createdAt, expiresAt, campaign]
    );

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

// 🟢 TRACK LINK
app.get('/track/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    const { campaign } = req.query;
    const result = await pool.query(`SELECT * FROM links WHERE id=$1`, [linkId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid tracking link' });
    }

    const linkData = result.rows[0];
    if (new Date() > linkData.expires) {
      return res.status(410).json({ error: 'Tracking link has expired' });
    }

    const clientId = req.ip + req.headers['user-agent'];
    let uniqueClicks = linkData.unique_clicks;
    let clickers = linkData.clickers || [];

    if (!clickers.includes(clientId)) {
      uniqueClicks++;
      clickers.push(clientId);
    }

    await pool.query(
      `UPDATE links 
       SET clicks = clicks + 1,
           unique_clicks = $1,
           clickers = $2,
           campaign = $3,
           last_accessed = $4
       WHERE id=$5`,
      [uniqueClicks, clickers, campaign || linkData.campaign, new Date(), linkId]
    );

    res.redirect('https://share-bug2.onrender.com');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🟢 GET LINK STATS
app.get('/api/links/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    const result = await pool.query(`SELECT * FROM links WHERE id=$1`, [linkId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    const linkData = result.rows[0];
    const timeRemaining = Math.max(0, new Date(linkData.expires) - new Date());

    res.json({
      id: linkData.id,
      clicks: linkData.clicks,
      uniqueClicks: linkData.unique_clicks,
      created: linkData.created,
      expires: linkData.expires,
      isActive: new Date() < new Date(linkData.expires),
      campaign: linkData.campaign,
      lastAccessed: linkData.last_accessed,
      timeRemaining: `${Math.floor(timeRemaining / (1000 * 60 * 60))} hours ${Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))} minutes`,
      clickThroughRate: linkData.clicks > 0 ? (linkData.unique_clicks / linkData.clicks * 100).toFixed(2) + '%' : '0%'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🟢 GET ALL LINKS
app.get('/api/links', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM links`);
    const allLinks = result.rows.map(link => ({
      id: link.id,
      created: link.created,
      expires: link.expires,
      clicks: link.clicks,
      uniqueClicks: link.unique_clicks,
      campaign: link.campaign,
      isActive: new Date() < new Date(link.expires)
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

// START SERVER
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
