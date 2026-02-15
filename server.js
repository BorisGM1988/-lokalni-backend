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
      nise TEXT,
      opis TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Greška pri kreiranju tabele:', err.message);
    else console.log('Tabela users kreirana ili postoji');
  });
});

const JWT_SECRET = 'promeni-ovo-u-dug-random-string-za-produkciju-2026'; // OBAVEZNO PROMENI OVO!

// TEST RUTA – da vidiš da server živi
app.get('/test', (req, res) => {
  res.send('Backend radi! Trenutno vreme: ' + new Date().toISOString());
});

// JEDINA ruta za registraciju
app.post('/register', async (req, res) => {
  console.log('Primljen POST /register zahtev:', req.body); // vidi se u Render Logs-u!

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
        JSON.stringify(nise || []), // array kao string
        opis || null
      ],
      function (err) {
        if (err) {
          console.error('Greška pri insertu:', err.message);
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'Email već postoji' });
          }
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
    console.error('Greška u registraciji:', err.message);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server startovan na portu ${port}`);
});
