const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

// ----- CONFIG ADMIN -----
const ADMIN_PASSWORD = "aydminAI2013"; // <= mot de passe stocké ici (serveur)
const adminTokens = new Map(); // token -> expiry (ms) (en mémoire)
const ADMIN_TOKEN_TTL = 1000 * 60 * 60 * 6; // 6 heures

// ----- STORAGE -----
const messagesFile = path.join(__dirname, "messages.json");
let conversations = {};
if (fs.existsSync(messagesFile)) {
  try {
    conversations = JSON.parse(fs.readFileSync(messagesFile, "utf8") || "{}");
  } catch (e) {
    conversations = {};
  }
} else {
  fs.writeFileSync(messagesFile, JSON.stringify({}));
}

// ----- HTTP SERVER -----
const server = app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});

// ----- utilitaires cookies -----
function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").map(c => c.trim()).filter(Boolean).reduce((acc, cur) => {
    const [k, v] = cur.split("=");
    acc[k] = decodeURIComponent(v);
    return acc;
  }, {});
}

function setAdminCookie(res, token) {
  // HttpOnly cookie, path=/, secure flag only if behind https (Render uses https)
  // On Render (https) Secure is ok; for local testing over http it may be ignored but cookie still set.
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  // Expires header
  const expires = new Date(Date.now() + ADMIN_TOKEN_TTL).toUTCString();
  res.setHeader("Set-Cookie", `admin_token=${token}; HttpOnly; Path=/; Expires=${expires}${secure}`);
}

// ----- Admin login endpoints -----
// Serve the login page at GET /admin (static file admin_login.html)
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin_login.html"));
});

// Login POST: receive { password }
app.post("/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const token = uuidv4();
    const expiry = Date.now() + ADMIN_TOKEN_TTL;
    adminTokens.set(token, expiry);
    setAdminCookie(res, token);
    return res.json({ ok: true });
  } else {
    return res.status(401).json({ ok: false, error: "Mot de passe incorrect" });
  }
});

// Protected admin panel: serve admin_panel.html only if cookie valid
app.get("/admin_panel.html", (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies["admin_token"];
  if (token && adminTokens.has(token)) {
    const expiry = adminTokens.get(token);
    if (Date.now() < expiry) {
      // refresh expiry (sliding)
      adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL);
      return res.sendFile(path.join(__dirname, "admin_panel.html"));
    } else {
      adminTokens.delete(token);
    }
  }
  // not authorized -> redirect to login
  return res.redirect("/admin");
});

// Optional: logout endpoint
app.post("/admin/logout", (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies["admin_token"];
  if (token) adminTokens.delete(token);
  // Clear cookie
  res.setHeader("Set-Cookie", `admin_token=; HttpOnly; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
  return res.json({ ok: true });
});

// ----- WEBSOCKET (inchangé / multi-utilisateurs) -----
const wss = new WebSocketServer({ server });

let admins = [];

wss.on("connection", (socket, req) => {
  const url = req.url;

  if (url === "/admin") {
    admins.push(socket);
    // envoyer l'historique complet
    socket.send(JSON.stringify({ type: "init", conversations }));

    socket.on("message", msg => {
      let data;
      try { data = JSON.parse(msg); } catch (e) { return; }
      if (data.type === "reply") {
        const { userId, text } = data;
        const message = { sender: "admin", text, timestamp: Date.now() };
        if (!conversations[userId]) conversations[userId] = [];
        conversations[userId].push(message);
        fs.writeFileSync(messagesFile, JSON.stringify(conversations, null, 2));

        // envoyer aux clients visiteurs correspondant
        wss.clients.forEach(client => {
          if (client.userId === userId && client.readyState === 1) {
            client.send(JSON.stringify(message));
          }
        });
      }
    });

    socket.on("close", () => {
      admins = admins.filter(a => a !== socket);
    });

  } else {
    // visiteur (nouvelle conversation)
    const userId = uuidv4();
    socket.userId = userId;
    if (!conversations[userId]) conversations[userId] = [];

    // envoi init avec ID et historique (vide normalement)
    socket.send(JSON.stringify({ type: "init", userId, messages: conversations[userId] }));

    socket.on("message", msg => {
      let data;
      try { data = JSON.parse(msg); } catch (e) { return; }
      const message = { sender: "user", text: data.text, timestamp: Date.now() };
      conversations[userId].push(message);
      fs.writeFileSync(messagesFile, JSON.stringify(conversations, null, 2));

      // prévenir tous les admins connectés
      admins.forEach(admin => {
        if (admin.readyState === 1) {
          admin.send(JSON.stringify({ type: "new_message", userId, message }));
        }
      });
    });
  }
});

// Serve root and fallback
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

// garbage collector simple pour tokens expirés (toutes les heures)
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of adminTokens.entries()) {
    if (exp < now) adminTokens.delete(t);
  }
}, 1000 * 60 * 60);
