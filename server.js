const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("DB Error");
  }
});

app.post('/projects', async (req, res) => {
  try {
      const { title, description, budget, user_id } = req.body;
      
      const result = await pool.query(
          'INSERT INTO projects (title, description, budget, user_id) VALUES ($1, $2, $3, $4) RETURNING *',
          [title, description, budget, user_id]
        );
        
        res.json(result.rows[0]);
    } catch (err) {
    console.error(err);
    res.status(500).send("Error creating project");
}
});

app.get('/projects', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM projects ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching projects");
  }
});

app.listen(5000, () => {
console.log("Server running on port 5000");
});