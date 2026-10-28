const cookieParser = require('cookie-parser');require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/attempts', require('./routes/attempts'));
app.use('/api/battles', require('./routes/battles'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/instructor', require('./routes/instructor'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/revision', require('./routes/revision'));

// Serve the frontend (folder is a sibling of backend)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Unknown API paths return JSON instead of HTML
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Open the app at the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});