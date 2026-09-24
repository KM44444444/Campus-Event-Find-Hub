// server.js
// Combined backend for Campus Event & Find Hub
// Node.js + Express + SQLite + JWT + bcrypt + multer + nodemailer

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

// ---------- CONFIG ----------
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey_change";
const UPLOAD_DIR = path.join(__dirname, "uploads");
const OTP_EXPIRY_SECONDS = parseInt(process.env.OTP_EXPIRY_SECONDS || "900", 10);

// ensure uploads folder exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- MULTER FIX ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`);
  }
});
const upload = multer({ storage });

// ---------- NODEMAILER ----------
const demoMode = !process.env.SMTP_USER || !process.env.SMTP_PASS;

let transporterOptions = {
  host: process.env.SMTP_HOST || "demo.smtp.host",
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || "demo_user",
    pass: process.env.SMTP_PASS || "demo_pass123"
  }
};

// Use nodemailer's default transport fallback in demo mode
const transporter = demoMode
  ? { sendMail: () => Promise.resolve({ rejected: [], rejected: [], pending: [], response: "demo-mode" }) }
  : nodemailer.createTransport(transporterOptions);

// ---------- APP ----------
const app = express();
app.use(express.json());
app.use(cors());
app.use("/uploads", express.static(UPLOAD_DIR));

// ---------- DB ----------
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

// ---------- DB INIT ----------
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
}

// ---------- AUTH HELPERS ----------
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

// ---------- ROUTES ----------
app.get("/", (req, res) => {
  res.json({ success:true, message:"Campus Hub Backend Running ✅" });
});

// ✅ Student Register
app.post("/api/student/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success:false, message:"Email and password are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ success:false, message:"Password must be at least 6 characters" });
  }

  const exists = await get("SELECT * FROM users WHERE email=?", [email]);
  if (exists) return res.status(400).json({ success:false, message:"Email exists" });

  const hash = await bcrypt.hash(password, 10);
  await run("INSERT INTO users (email,password,role,approved,created_at) VALUES (?,?,?,?,?)",
    [email, hash, "student", 0, Date.now()]
  );

  res.json({ success:true, message:"Registered. Wait for admin approval." });
});

// ✅ Student Login
app.post("/api/student/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await get("SELECT * FROM users WHERE email=?", [email]);

  if (!user || !user.approved || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ success:false, message:"Invalid login" });

  res.json({ success:true, token: signToken(user) });
});

// ✅ Admin Login
app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await get("SELECT * FROM users WHERE email=?", [email]);

  if (!user || user.role!=="admin" || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ success:false, message:"Invalid admin login" });

  res.json({ success:true, token: signToken(user) });
});

// ✅ Admin Pending Students
app.get("/api/admin/pending", authMiddleware, adminOnly, async (req, res) => {
  const rows = await all("SELECT * FROM users WHERE approved=0 AND role='student'");
  res.json({ success:true, pending: rows });
});

// ✅ Admin Approve
app.post("/api/admin/approve", authMiddleware, adminOnly, async (req, res) => {
  const { email } = req.body;
  await run("UPDATE users SET approved=1 WHERE email=?", [email]);
  res.json({ success:true, message:"Student approved" });
});

// ✅ Upload Event
app.post("/api/event/upload", authMiddleware, adminOnly, upload.single("photo"), async (req, res) => {
  if (!req.body.title || !req.body.description) {
    return res.status(400).json({ success:false, message:"Title and description are required" });
  }
  const photo = req.file ? `/uploads/${req.file.filename}` : "";
  await run(
    "INSERT INTO events (title,description,photo,posted_by,created_at) VALUES (?,?,?,?,?)",
    [req.body.title, req.body.description, photo, req.user.email, Date.now()]
  );
  res.json({ success:true, message:"Event uploaded" });
});

// ✅ Get Events
app.get("/api/events/all", async (req, res) => {
  const rows = await all("SELECT * FROM events ORDER BY id DESC");
  res.json(rows);
});

// ✅ Upload Lost
app.post("/api/upload/lost", authMiddleware, upload.single("photo"), async (req, res) => {
  if (!req.body.name || !req.body.description) {
    return res.status(400).json({ success:false, message:"Item name and description are required" });
  }
  const photo = req.file ? `/uploads/${req.file.filename}` : "";
  await run(
    "INSERT INTO items (type,name,description,photo,posted_by,created_at) VALUES (?,?,?,?,?,?)",
    ["lost", req.body.name, req.body.description, photo, req.user.email, Date.now()]
  );
  res.json({ success:true, message:"Lost item posted" });
});

// ✅ Upload Found
app.post("/api/upload/found", authMiddleware, upload.single("photo"), async (req, res) => {
  if (!req.body.name || !req.body.description) {
    return res.status(400).json({ success:false, message:"Item name and description are required" });
  }
  const photo = req.file ? `/uploads/${req.file.filename}` : "";
  await run(
    "INSERT INTO items (type,name,description,photo,posted_by,created_at) VALUES (?,?,?,?,?,?)",
    ["found", req.body.name, req.body.description, photo, req.user.email, Date.now()]
  );
  res.json({ success:true, message:"Found item posted" });
});

// ✅ Get All Items
app.get("/api/items/all", async (req, res) => {
  const rows = await all("SELECT * FROM items ORDER BY id DESC");
  res.json(rows);
});

// ✅ Request OTP (forgot password)
app.post("/api/otp/request", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ success:false, message:"Email required" });

  const user = await get("SELECT * FROM users WHERE email=?", [email]);
  if (!user) return res.status(404).json({ success:false, message:"Email not registered" });

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + OTP_EXPIRY_SECONDS * 1000;
  await run("INSERT INTO otps (email, otp, expires_at) VALUES (?,?,?)", [email, otp, expiresAt]);

  try {
    await transporter.sendMail({
      from: demoMode ? "Campus Hub <demo@campushub.local>" : process.env.SMTP_USER,
      to: email,
      subject: "Campus Hub - Password Reset OTP",
      text: `Your OTP is ${otp}. It expires in ${Math.round(OTP_EXPIRY_SECONDS / 60)} minutes.`
    });
  } catch (err) {
    console.error("Email send failed, OTP still valid:", err.message);
  }

  res.json({ success:true, message:"OTP sent (check email, or server console if SMTP is not configured)" });
});

// ✅ Reset Password with OTP
app.post("/api/otp/reset", async (req, res) => {
  const { email, otp, newPassword } = req.body || {};
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ success:false, message:"Email, OTP and new password are required" });
  }

  const row = await get(
    "SELECT * FROM otps WHERE email=? ORDER BY id DESC LIMIT 1",
    [email]
  );
  if (!row) return res.status(400).json({ success:false, message:"No OTP found for this email" });
  if (row.expires_at < Date.now()) return res.status(400).json({ success:false, message:"OTP expired" });

  // In demo mode, accept any OTP; in production, verify the OTP matches
  const isDemoMode = !process.env.SMTP_USER || !process.env.SMTP_PASS;
  if (!isDemoMode && row.otp !== otp) return res.status(400).json({ success:false, message:"Invalid OTP" });

  const hash = await bcrypt.hash(newPassword, 10);
  await run("UPDATE users SET password=? WHERE email=?", [hash, email]);
  await run("DELETE FROM otps WHERE email=?", [email]);

  res.json({ success:true, message:"Password updated. Please log in." });
});

// ✅ START SERVER
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });
});