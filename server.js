const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

app.use(express.json());
app.use(cors());

const db = new sqlite3.Database('./users.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ime TEXT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      telefon TEXT,
      lokacija TEXT,
      nise TEXT,          -- JSON string za array
      opis TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Greška pri kreiranju tabele:', err.message);
    else console.log('Tabela users spremna');
  });
});

const JWT_SECRET = 'tvoj-tajni-kljuc-123456789-promeni-ovo-u-produkciji'; // ← OBAVEZNO PROMENI OVO U NEKI DUŽI RANDOM STRING

app.post('/register', async (req, res) => {
  console.log('Primljen POST /register:', req.body); // vidi se u Render Logs

  const { ime, email, lozinka, telefon, lokacija, nise, opis } = req.body;

  if (!ime || !email || !lozinka || !telefon || !lokacija) {
    return res.status(400).json({ error: 'Sva obavezna polja moraju biti popunjena' });
  }

  if (lozinka.length < 6) {
    return res.status(400).json({ error: 'Lozinka mora imati najmanje 6 karaktera' });
  }

  try {
    const hashedPassword = await bcrypt.hash(lozinka, 10);

    db.run(
      `INSERT INTO users (ime, email, password, telefon, lokacija, nise, opis)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ime,
        email,
        hashedPassword,
        telefon,
        lokacija,
        JSON.stringify(nise || []), // čuva array kao string
        opis || null
      ],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'Email već postoji' });
          }
          console.error('Greška pri insertu:', err.message);
          return res.status(500).json({ error: 'Greška na serveru' });
        }

        const token = jwt.sign(
          { userId: this.lastID, email },
          JWT_SECRET,
          { expiresIn: '30d' }
        );

        res.status(201).json({
          message: 'Registracija uspešna',
          token,
          user: { id: this.lastID, ime, email }
        });
      }
    );
  } catch (err) {
    console.error('Greška u registraciji:', err);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

// Dodaj test rutu da vidiš da server odgovara
app.get('/test', (req, res) => {
  res.send('Backend radi! Trenutno vreme: ' + new Date().toISOString());
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server radi na portu ${port}`);
});
