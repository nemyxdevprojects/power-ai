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

const messagesFile = path.join(__dirname, "messages.json");

let conversations = {};
if (fs.existsSync(messagesFile)) {
  conversations = JSON.parse(fs.readFileSync(messagesFile, "utf8"));
} else {
  fs.writeFileSync(messagesFile, JSON.stringify({}));
}

const server = app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });

let admins = [];

wss.on("connection", (socket, req) => {
  const url = req.url;

  if (url === "/admin") {
    admins.push(socket);
    socket.send(JSON.stringify({ type: "init", conversations }));

    socket.on("message", msg => {
      const data = JSON.parse(msg);
      if (data.type === "reply") {
        const { userId, text } = data;
        const message = { sender: "admin", text, timestamp: Date.now() };
        if (!conversations[userId]) conversations[userId] = [];
        conversations[userId].push(message);
        fs.writeFileSync(messagesFile, JSON.stringify(conversations, null, 2));

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
    const userId = uuidv4();
    socket.userId = userId;
    if (!conversations[userId]) conversations[userId] = [];

    socket.send(JSON.stringify({ type: "init", userId, messages: conversations[userId] }));

    socket.on("message", msg => {
      const data = JSON.parse(msg);
      const message = { sender: "user", text: data.text, timestamp: Date.now() };
      conversations[userId].push(message);
      fs.writeFileSync(messagesFile, JSON.stringify(conversations, null, 2));

      admins.forEach(admin => {
        if (admin.readyState === 1) {
          admin.send(JSON.stringify({ type: "new_message", userId, message }));
        }
      });
    });
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
