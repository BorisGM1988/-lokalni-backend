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
      email TEXT UNIQUE,
      password TEXT,
      telefon TEXT,
      lokacija TEXT,
      nise TEXT,
      opis TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

const JWT_SECRET = 'tvoj-tajni-kljuc-123456789'; // promeni u produkciji na duži random string

app.post('/register', async (req, res) => {
  const { ime, email, lozinka, telefon, lokacija, nise, opis } = req.body;

  if (!ime || !email || !lozinka || !telefon || !lokacija) {
    return res.status(400).json({ error: 'Sva polja su obavezna' });
  }

  const hashedPassword = await bcrypt.hash(lozinka, 10);

  db.run(
    'INSERT INTO users (ime, email, password, telefon, lokacija, nise, opis) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [ime, email, hashedPassword, telefon, lokacija, JSON.stringify(nise), opis],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Email već postoji' });
        }
        return res.status(500).json({ error: 'Greška na serveru' });
      }

      const token = jwt.sign({ userId: this.lastID, email }, JWT_SECRET, { expiresIn: '30d' });

      res.json({ message: 'Registracija uspešna', token });
    }
  );
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server radi');
});
// Primer rute za registraciju (prilagodi po potrebi)
app.post('/register', async (req, res) => {
  const { email, password, ime, telefon, lokacija } = req.body;

  // Proveri da li su obavezna polja tu
  if (!email || !password) {
    return res.status(400).json({ error: 'Email i lozinka su obavezni' });
  }

  // Hash lozinke (ako koristiš bcrypt)
  const hashedPassword = await bcrypt.hash(password, 10);

  // Sačuvaj u SQLite (prilagodi ako imaš drugačiju logiku)
  db.run(
    `INSERT INTO users (email, password, ime, telefon, lokacija) VALUES (?, ?, ?, ?, ?)`,
    [email, hashedPassword, ime || '', telefon || '', lokacija || ''],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(400).json({ error: 'Email već postoji ili greška pri čuvanju' });
      }
      res.status(201).json({ 
        message: 'Korisnik uspešno registrovan!',
        userId: this.lastID 
      });
    }
  );
});
