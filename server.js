const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

// RUČNI CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());

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
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS proizvodi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      naziv TEXT,
      opis TEXT,
      cena NUMBER,
      kolicina NUMBER,
      glavnaNisa TEXT,
      podnisa TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS objave (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      tekst TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);
});

const JWT_SECRET = 'promeni-ovo-u-dug-random-string-za-produkciju-2026';

// TEST RUTA
app.get('/test', (req, res) => {
  res.send('Backend radi! Trenutno vreme: ' + new Date().toISOString());
});

// REGISTRACIJA
app.post('/register', async (req, res) => {
  const { ime, email, lozinka, telefon, lokacija, nise, opis } = req.body;

  if (!ime || !email || !lozinka || !telefon || !lokacija) {
    return res.status(400).json({ error: 'Sva obavezna polja moraju biti popunjena' });
  }

  try {
    const hashedPassword = await bcrypt.hash(lozinka, 10);

    db.run(
      `INSERT INTO users (ime, email, password, telefon, lokacija, nise, opis)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ime, email, hashedPassword, telefon, lokacija, JSON.stringify(nise || []), opis || null],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'Email već postoji' });
          }
          return res.status(500).json({ error: 'Greška na serveru' });
        }

        const token = jwt.sign({ userId: this.lastID, email }, JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({
          message: 'Registracija uspešna',
          token,
          user: { id: this.lastID, ime, email }
        });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

// LOGIN
app.post('/login', async (req, res) => {
  const { email, lozinka } = req.body;

  if (!email || !lozinka) return res.status(400).json({ error: 'Email i lozinka su obavezni' });

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Pogrešan email ili lozinka' });

    const isMatch = await bcrypt.compare(lozinka, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Pogrešan email ili lozinka' });

    const token = jwt.sign({ userId: user.id, email }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      message: 'Prijava uspešna',
      token,
      user: {
        id: user.id,
        ime: user.ime,
        email: user.email,
        telefon: user.telefon,
        lokacija: user.lokacija,
        opis: user.opis,
        nise: user.nise ? JSON.parse(user.nise) : []
      }
    });
  });
});

// GET PROFILE - podržava i tuđi profil preko ?userId=
app.get('/profile', (req, res) => {
  const { userId } = req.query;                    // <--- uzimamo userId iz query parametra
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // Ako postoji userId u URL-u, prikaži taj profil (javni pristup)
  if (userId) {
    db.get('SELECT id, ime, email, telefon, lokacija, opis, nise, created_at as registeredAt FROM users WHERE id = ?', 
      [userId], (err, user) => {
        if (err) {
          return res.status(500).json({ error: 'Greška na serveru' });
        }
        if (!user) {
          return res.status(404).json({ error: 'Korisnik nije pronađen' });
        }

        res.json({
          ime: user.ime,
          email: user.email,
          telefon: user.telefon,
          lokacija: user.lokacija,
          opis: user.opis || '',
          nise: user.nise ? JSON.parse(user.nise) : [],
          registeredAt: user.registeredAt
        });
      });
    return;
  }

  // Ako nema userId u URL-u, prikaži profil ulogovanog korisnika (kao ranije)
  if (!token) {
    return res.status(401).json({ error: 'Niste ulogovani' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    db.get('SELECT * FROM users WHERE id = ?', [decoded.userId], (err, user) => {
      if (err || !user) {
        return res.status(404).json({ error: 'Korisnik nije pronađen' });
      }

      res.json({
        ime: user.ime,
        email: user.email,
        telefon: user.telefon,
        lokacija: user.lokacija,
        opis: user.opis || '',
        nise: user.nise ? JSON.parse(user.nise) : [],
        registeredAt: user.created_at
      });
    });
  } catch (err) {
    res.status(401).json({ error: 'Nevažeći token' });
  }
});

// OBJAVI NOVOST
app.post('/objavi-novost', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Nevažeći token' });
  }

  const { tekst } = req.body;

  if (!tekst || tekst.trim() === '') return res.status(400).json({ error: 'Tekst objave ne može biti prazan' });

  db.run(
    `INSERT INTO objave (userId, tekst) VALUES (?, ?)`,
    [decoded.userId, tekst.trim()],
    function (err) {
      if (err) return res.status(500).json({ error: 'Greška na serveru' });
      res.json({ message: 'Objava uspešno dodata!', objavaId: this.lastID });
    }
  );
});

// MOJE OBJAVE
app.get('/moje-objave', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Nevažeći token' });
  }

  db.all(
    `SELECT id, tekst, created_at 
     FROM objave 
     WHERE userId = ? 
     ORDER BY created_at DESC`,
    [decoded.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Greška na serveru' });
      res.json(rows);
    }
  );
});

// SVI PRODAVCi
app.get('/svi-prodavci', (req, res) => {
  console.log('Pozvana ruta /svi-prodavci – učitavanje svih korisnika');

  db.all(
    `SELECT id, ime, opis, slika, lokacija, nise 
     FROM users 
     ORDER BY ime ASC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('SQL greška u /svi-prodavci:', err.message);
        return res.status(500).json({ error: 'Greška u bazi: ' + err.message });
      }

      console.log('Pronađeno korisnika:', rows.length);

      const prodavci = rows.map(row => {
        let niseParsed = [];
        try {
          niseParsed = row.nise ? JSON.parse(row.nise) : [];
        } catch (parseErr) {
          console.error('Greška pri parsiranju niša za korisnika', row.id, parseErr);
        }

        return {
          id: row.id,
          ime: row.ime || 'Bez imena',
          opis: row.opis || 'Porodična proizvodnja svežih domaćih proizvoda.',
          slika: row.slika || 'https://via.placeholder.com/400x220?text=' + encodeURIComponent(row.ime || 'Prodavac'),
          lokacija: row.lokacija || 'Lokacija nije navedena',
          nise: niseParsed
        };
      });

      res.json(prodavci);
    }
  );
});

// DODAJ PROIZVOD
// === DODAJ NOVI PROIZVOD ===
app.post('/dodaj-proizvod', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Nevažeći token' });
  }

  const { naziv, cena, kolicina, glavnaNisa, podnisa, opis } = req.body;

  if (!naziv || !cena || !kolicina || !glavnaNisa) {
    return res.status(400).json({ error: 'Obavezna polja nisu popunjena' });
  }

  db.run(
    `INSERT INTO proizvodi (userId, naziv, opis, cena, kolicina, glavnaNisa, podnisa)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [decoded.userId, naziv, opis || null, cena, kolicina, glavnaNisa, podnisa || null],
    function(err) {
      if (err) return res.status(500).json({ error: 'Greška pri dodavanju proizvoda' });
      
      res.status(201).json({
        message: 'Proizvod uspešno izložen na pijac!',
        proizvodId: this.lastID
      });
    }
  );
});
// === GET PROIZVODI PO GLAVNOJ NIŠI I PODNIŠI ===
app.get('/proizvodi', (req, res) => {
  const { glavnaNisa, podnisa } = req.query;

  let sql = `
    SELECT p.*, u.ime as prodavacIme, u.lokacija as prodavacLokacija 
    FROM proizvodi p 
    JOIN users u ON p.userId = u.id 
    WHERE 1=1
  `;
  const params = [];

  if (glavnaNisa) {
    sql += ` AND p.glavnaNisa = ?`;
    params.push(glavnaNisa);
  }
  if (podnisa) {
    sql += ` AND p.podnisa = ?`;
    params.push(podnisa);
  }

  sql += ` ORDER BY p.created_at DESC`;

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Greška pri učitavanju proizvoda" });
    }
    res.json(rows);
  });
});
// === DELETE PROIZVOD - samo vlasnik može da obriše ===
app.delete('/proizvod/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Niste ulogovani' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Nevažeći token' });
  }

  const proizvodId = req.params.id;

  // Proveravamo da li proizvod pripada ovom korisniku
  db.get('SELECT userId FROM proizvodi WHERE id = ?', [proizvodId], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Greška na serveru' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Proizvod nije pronađen' });
    }
    if (row.userId !== decoded.userId) {
      return res.status(403).json({ error: 'Nemate dozvolu da obrišete ovaj proizvod' });
    }

    // Brišemo proizvod
    db.run('DELETE FROM proizvodi WHERE id = ?', [proizvodId], function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Greška pri brisanju proizvoda' });
      }

      res.json({ message: 'Proizvod uspešno obrisan' });
    });
  });
});
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server startovan na portu ${port}`);
});
