const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

// middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

// Fichier pour stocker les messages
const messagesFile = path.join(__dirname, "messages.json");

// Charger les messages existants
let messages = [];
if (fs.existsSync(messagesFile)) {
  messages = JSON.parse(fs.readFileSync(messagesFile, "utf8"));
}

// Créer un serveur HTTP
const server = app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});

// WebSocket pour la communication temps réel
const wss = new WebSocketServer({ server });
let adminSocket = null;

wss.on("connection", (socket, req) => {
  const url = req.url;
  if (url === "/admin") {
    console.log("Admin connecté");
    adminSocket = socket;
    socket.on("message", msg => {
      const data = JSON.parse(msg);
      if (data.type === "reply") {
        const reply = { sender: "admin", text: data.text, timestamp: Date.now() };
        messages.push(reply);
        fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));
        if (clientSocket) clientSocket.send(JSON.stringify(reply));
      }
    });
  } else {
    console.log("Client connecté");
    clientSocket = socket;
    socket.on("message", msg => {
      const data = JSON.parse(msg);
      const message = { sender: "user", text: data.text, timestamp: Date.now() };
      messages.push(message);
      fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));
      if (adminSocket) adminSocket.send(JSON.stringify(message));
    });
  }
});

let clientSocket = null;

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});
