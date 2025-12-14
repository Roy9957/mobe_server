require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://fish-ac9ba-default-rtdb.asia-southeast1.firebasedatabase.app"
});


const db = admin.database();

const app = express();
const PORT = process.env.PORT || 3000;

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

    await db.ref('links/' + linkId).set({
      id: linkId,
      created: createdAt.toISOString(),
      expires: expiresAt.toISOString(),
      clicks: 0,
      uniqueClicks: 0,
      clickers: [],
      campaign
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

// 🟢 TRACK LINK
app.get('/track/:linkId', async (req, res) => {
  try {
    const { linkId } = req.params;
    const { campaign } = req.query;
    const linkRef = db.ref('links/' + linkId);
    const snapshot = await linkRef.get();

    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'Invalid tracking link' });
    }

    const linkData = snapshot.val();
    if (new Date() > new Date(linkData.expires)) {
      return res.status(410).json({ error: 'Tracking link has expired' });
    }

    const clientId = req.ip + req.headers['user-agent'];
    let uniqueClicks = linkData.uniqueClicks;
    let clickers = linkData.clickers || [];

    if (!clickers.includes(clientId)) {
      uniqueClicks++;
      clickers.push(clientId);
    }

    await linkRef.update({
      clicks: linkData.clicks + 1,
      uniqueClicks,
      clickers,
      campaign: campaign || linkData.campaign,
      lastAccessed: new Date().toISOString()
    });

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
    const linkRef = db.ref('links/' + linkId);
    const snapshot = await linkRef.get();

    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'Link not found' });
    }

    const linkData = snapshot.val();
    const timeRemaining = Math.max(0, new Date(linkData.expires) - new Date());

    res.json({
      id: linkData.id,
      clicks: linkData.clicks,
      uniqueClicks: linkData.uniqueClicks,
      created: linkData.created,
      expires: linkData.expires,
      isActive: new Date() < new Date(linkData.expires),
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

// 🟢 GET ALL LINKS
app.get('/api/links', async (req, res) => {
  try {
    const snapshot = await db.ref('links').get();
    const allLinks = snapshot.exists() ? Object.values(snapshot.val()) : [];

    const links = allLinks.map(link => ({
      id: link.id,
      created: link.created,
      expires: link.expires,
      clicks: link.clicks,
      uniqueClicks: link.uniqueClicks,
      campaign: link.campaign,
      isActive: new Date() < new Date(link.expires)
    }));

    res.json({
      count: links.length,
      active: links.filter(link => link.isActive).length,
      links
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
