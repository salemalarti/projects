const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Dummy data for now (will connect to Supabase later)
const gamesData = [
  { name: 'Brookhaven RP', visits: 82500000000, genre: 'Roleplay', players: 800000, monthlyTrend: 'up' },
  { name: 'Adopt Me', visits: 26700000000, genre: 'Roleplay', players: 400000, monthlyTrend: 'stable' },
  { name: 'Blox Fruits', visits: 40000000000, genre: 'RPG', players: 600000, monthlyTrend: 'up' },
  { name: 'Jujutsu Shenanigans', visits: 15000000000, genre: 'Anime Combat', players: 350000, monthlyTrend: 'up' },
  { name: '99 Nights in Forest', visits: 26000000000, genre: 'Survival', players: 200000, monthlyTrend: 'up' },
  { name: 'Rivals', visits: 12000000000, genre: 'FPS', players: 250000, monthlyTrend: 'stable' },
];

// Routes
app.get('/api/trending-games', (req, res) => {
  // Sort by visits (most popular first)
  const sorted = [...gamesData].sort((a, b) => b.visits - a.visits);
  res.json(sorted);
});

app.get('/api/games-by-genre', (req, res) => {
  // Group games by genre
  const grouped = {};
  gamesData.forEach(game => {
    if (!grouped[game.genre]) {
      grouped[game.genre] = [];
    }
    grouped[game.genre].push(game);
  });
  res.json(grouped);
});

app.get('/api/success-metrics', (req, res) => {
  // Return insights about what makes games succeed
  const metrics = {
    topGenres: ['Roleplay', 'RPG', 'Anime Combat', 'Survival'],
    avgWinningVisits: 30000000000,
    commonMechanics: ['Pet Trading', 'Progression Systems', 'Social Interaction', 'Daily Rewards'],
    monetizationMethods: ['Game Passes', 'In-game Currency', 'Battle Pass', 'Cosmetics'],
  };
  res.json(metrics);
});

app.get('/api/trending-mechanics', (req, res) => {
  const mechanics = [
    { name: 'Idle Loops', growth: '+45%', description: 'Games that let players progress while AFK' },
    { name: 'Cozy Simulators', growth: '+78%', description: 'Low-stress farming/building games' },
    { name: 'Short-Format Games', growth: '+52%', description: '5-10 minute engagement sessions' },
    { name: 'Social Trading', growth: '+35%', description: 'Pet/item trading with friends' },
  ];
  res.json(mechanics);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Open http://localhost:5000 in your browser');
});
