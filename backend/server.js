require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
const cors = require("cors");

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey_change";
const UPLOAD_DIR = path.join(__dirname, "uploads");

// ensure uploads folder exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`);
  }
});
const upload = multer({ storage });

const app = express();
app.use(express.json());
app.use(cors());
app.use("/uploads", express.static(UPLOAD_DIR));

const DB_PATH = path.join(__dirname, "db.sqlite");
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("SQLite error:", err);
  else console.log("SQLite connected:", DB_PATH);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'student',
      approved INTEGER DEFAULT 0,
      created_at INTEGER
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      otp TEXT,
      expires_at INTEGER
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      photo TEXT,
      posted_by TEXT,
      created_at INTEGER
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      name TEXT,
      description TEXT,
      photo TEXT,
      posted_by TEXT,
      created_at INTEGER
    )
  `);

  const adminEmail = process.env.ADMIN_EMAIL || "kshitiz.mandola.cseds.2024@miet.ac.in";
  const adminPassword = process.env.ADMIN_PASSWORD || "12345678";

  const existing = await get("SELECT * FROM users WHERE email = ?", [adminEmail]);

  if (!existing) {
    const hashed = await bcrypt.hash(adminPassword, 10);
    await run(
      "INSERT INTO users (email, password, role, approved, created_at) VALUES (?,?,?,?,?)",
      [adminEmail, hashed, "admin", 1, Date.now()]
    );
    console.log("✅ Admin seeded:", adminEmail);
  } else {
    console.log("✅ Admin exists:", adminEmail);
  }

  // Seed Demo Student
  const demoStudentEmail = "student@demo.com";
  const demoStudentPassword = "password";
  const existingStudent = await get("SELECT * FROM users WHERE email = ?", [demoStudentEmail]);
  if (!existingStudent) {
    const hashed = await bcrypt.hash(demoStudentPassword, 10);
    await run(
      "INSERT INTO users (email, password, role, approved, created_at) VALUES (?,?,?,?,?)",
      [demoStudentEmail, hashed, "student", 1, Date.now()]
    );
    console.log("✅ Demo Student seeded:", demoStudentEmail);
  }
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ success:false, message: "Missing Authorization header" });

    const token = header.split(" ")[1];
    const data = jwt.verify(token, JWT_SECRET);

    const dbUser = await get("SELECT * FROM users WHERE id = ?", [data.id]);
    if (!dbUser) return res.status(401).json({ success:false, message: "User not found" });

    req.user = { ...data, approved: !!dbUser.approved };
    next();
  } catch {
    return res.status(401).json({ success:false, message: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success:false, message: "Admin only" });
  }
  next();
}

app.get("/", (req, res) => {
  res.json({ success:true, message:"Campus Hub Backend Running ✅" });
});

app.post("/api/student/register", async (req, res) => {
  const { email, password } = req.body;
  const exists = await get("SELECT * FROM users WHERE email=?", [email]);
  if (exists) return res.status(400).json({ success:false, message:"Email exists" });

  const hash = await bcrypt.hash(password, 10);
  await run("INSERT INTO users (email,password,role,approved,created_at) VALUES (?,?,?,?,?)",
    [email, hash, "student", 0, Date.now()]
  );

  res.json({ success:true, message:"Registered. Wait for admin approval." });
});

app.post("/api/student/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await get("SELECT * FROM users WHERE email=?", [email]);

  if (!user || !user.approved || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ success:false, message:"Invalid login or unapproved account" });

  res.json({ success:true, token: signToken(user), user: { email: user.email, role: user.role } });
});

app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await get("SELECT * FROM users WHERE email=?", [email]);

  if (!user || user.role!=="admin" || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ success:false, message:"Invalid admin login" });

  res.json({ success:true, token: signToken(user), user: { email: user.email, role: user.role } });
});

app.get("/api/admin/pending", authMiddleware, adminOnly, async (req, res) => {
  const rows = await all("SELECT * FROM users WHERE approved=0 AND role='student'");
  res.json({ success:true, pending: rows });
});

app.post("/api/admin/approve", authMiddleware, adminOnly, async (req, res) => {
  const { email } = req.body;
  await run("UPDATE users SET approved=1 WHERE email=?", [email]);
  res.json({ success:true, message:"Student approved" });
});

app.post("/api/event/upload", authMiddleware, adminOnly, upload.single("photo"), async (req, res) => {
  const photo = req.file ? `/uploads/${req.file.filename}` : "";
  await run(
    "INSERT INTO events (title,description,photo,posted_by,created_at) VALUES (?,?,?,?,?)",
    [req.body.title, req.body.description, photo, req.user.email, Date.now()]
  );
  res.json({ success:true, message:"Event uploaded" });
});

app.get("/api/events/all", async (req, res) => {
  const rows = await all("SELECT * FROM events ORDER BY id DESC");
  res.json(rows);
});

app.post("/api/upload/item", authMiddleware, upload.single("photo"), async (req, res) => {
  const photo = req.file ? `/uploads/${req.file.filename}` : "";
  await run(
    "INSERT INTO items (type,name,description,photo,posted_by,created_at) VALUES (?,?,?,?,?,?)",
    [req.body.type || "lost", req.body.title, req.body.description, photo, req.user.email, Date.now()]
  );
  res.json({ success:true, message:"Item posted" });
});

app.get("/api/items/all", async (req, res) => {
  const rows = await all("SELECT * FROM items ORDER BY id DESC");
  res.json(rows);
});

app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.post("/api/otp/send", async (req, res) => {
  const { email } = req.body;
  const user = await get("SELECT * FROM users WHERE email=?", [email]);
  if (!user) return res.status(404).json({ success:false, message:"Email not registered!" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await run("INSERT INTO otps (email, otp, expires_at) VALUES (?,?,?)", [email, otp, Date.now() + 15 * 60 * 1000]);

  // Simulate OTP for now (no SMTP setup required)
  console.log(`[SIMULATED EMAIL] OTP for ${email} is ${otp}`);

  res.json({ success:true, message:"OTP sent (Prototype)!", prototypeOTP: otp });
});

app.post("/api/otp/reset", async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const user = await get("SELECT * FROM users WHERE email=?", [email]);
  if (!user) return res.status(404).json({ success:false, message:"Email not registered!" });

  const otpRecord = await get("SELECT * FROM otps WHERE email=? AND otp=? AND expires_at > ? ORDER BY id DESC LIMIT 1", [email, otp, Date.now()]);
  if (!otpRecord) return res.status(400).json({ success:false, message:"Invalid or expired OTP!" });

  const hash = await bcrypt.hash(newPassword, 10);
  await run("UPDATE users SET password=? WHERE email=?", [hash, email]);
  
  // Clear used OTP
  await run("DELETE FROM otps WHERE email=?", [email]);
  
  res.json({ success:true, message:"Password updated successfully!" });
});


initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });
});
