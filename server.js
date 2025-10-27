const fs = require('fs');
const path = require('path');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Fichier pour sauvegarder les messages
const messagesFile = path.join(__dirname, 'messages.json');
let conversations = {};
if(fs.existsSync(messagesFile)) {
    conversations = JSON.parse(fs.readFileSync(messagesFile));
}

// Admin login
const ADMIN_PASSWORD = "aydminAI2013";

app.post('/admin/login', (req,res)=>{
    if(req.body.password === ADMIN_PASSWORD) res.sendStatus(200);
    else res.sendStatus(403);
});

const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

let admins = [];

wss.on('connection', (socket, req)=>{
    const url = req.url;

    if(url === '/admin'){
        // Admin WS
        admins.push(socket);
        const dataToSend = {};
        Object.keys(conversations).forEach(uid=>{
            dataToSend[uid] = {
                messages: conversations[uid].messages||[],
                name: conversations[uid].name||"Sans Nom"
            };
        });
        socket.send(JSON.stringify({type:'init', conversations:dataToSend}));

        socket.on('message', msg=>{
            let data;
            try{ data = JSON.parse(msg); }catch(e){ return; }

            if(data.type==='reply'){
                const { userId, text } = data;
                const message = { sender:'admin', text, timestamp:Date.now() };
                if(!conversations[userId]) conversations[userId]={messages:[], name:"Sans Nom"};
                conversations[userId].messages.push(message);
                fs.writeFileSync(messagesFile, JSON.stringify(conversations,null,2));

                // Envoyer au client
                wss.clients.forEach(c=>{
                    if(c.userId === userId && c.readyState===1){
                        c.send(JSON.stringify(message));
                    }
                });
            }

            if(data.type==='delete_session'){
                const { userId } = data;
                if(conversations[userId]){
                    delete conversations[userId];
                    fs.writeFileSync(messagesFile, JSON.stringify(conversations,null,2));
                    // prévenir tous les admins
                    admins.forEach(a=>{ if(a.readyState===1) a.send(JSON.stringify({type:'delete_session', userId})); });
                    // prévenir le client supprimé
                    wss.clients.forEach(c=>{
                        if(c.userId===userId && c.readyState===1){
                            c.send(JSON.stringify({type:'session_deleted'}));
                            c.close();
                        }
                    });
                }
            }
        });

        socket.on('close',()=>{ admins = admins.filter(a=>a!==socket); });

    } else {
        // Visiteur WS
        const userId = uuidv4();
        socket.userId = userId;

        if(!conversations[userId]) conversations[userId] = { messages: [], name:"Sans Nom" };

        socket.send(JSON.stringify({type:'init', userId, messages: conversations[userId].messages}));

        socket.on('message', msg=>{
            let data;
            try{ data = JSON.parse(msg); }catch(e){return;}

            if(data.type==='set_name'){
                if(!conversations[userId]) conversations[userId]={messages:[], name:data.name};
                else conversations[userId].name = data.name;
                fs.writeFileSync(messagesFile, JSON.stringify(conversations,null,2));
            }

            if(data.type==='user_message'){
                const message = { sender:'user', text:data.text, timestamp:Date.now() };
                if(!conversations[userId]) conversations[userId]={messages:[], name:"Sans Nom"};
                conversations[userId].messages.push(message);
                fs.writeFileSync(messagesFile, JSON.stringify(conversations,null,2));

                // prévenir tous les admins
                admins.forEach(a=>{
                    if(a.readyState===1){
                        a.send(JSON.stringify({type:'new_message', userId, message}));
                    }
                });
            }
        });
    }
});

server.listen(process.env.PORT||3000, ()=>console.log('Server running'));
