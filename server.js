require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');

const html = path.join(__dirname, '/html');
app.use(express.static(html)); // Serve static files from the 'html' directory
app.use('/static', express.static(path.join(__dirname, 'static'))); // Serve static files from the 'static' directory

const port = process.argv[2] || 8090;
const http = require("http").Server(app);

const maxHttpBufferSizeInMb = parseInt(process.env.MAX_HTTP_BUFFER_SIZE_MB || '1');
const io = require("socket.io")(http, {
  maxHttpBufferSize: maxHttpBufferSizeInMb * 1024 * 1024,
});
let messageCache = [];
let cache_size = process.env.CACHE_SIZE ?? 0;

app.use(express.json()); // Handle JSON requests
const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

http.listen(port, function(){
    console.log("Starting server on port %s", port);
});

const users = [];
let msg_id = 1;
const userIps = []; // Array to store usernames and IPs

io.sockets.on("connection", function(socket){
    console.log("New connection!");

    var nick = null;

    // Save user's IP address
    const ipAddress = socket.request.connection.remoteAddress;

    socket.on("login", function(data){
        // Security checks
        data.nick = data.nick.trim();

        // If is empty
        if(data.nick == ""){
            socket.emit("force-login", "Nick can't be empty.");
            nick = null;
            return;
        }

        // If is already in
        if(users.indexOf(data.nick) != -1){
            socket.emit("force-login", "This nick is already in chat.");
            nick = null;
            return;
        }

        // Save nick and associate with IP
        nick = data.nick;
        users.push(data.nick);
        userIps.push({ username: nick, ip: ipAddress });

        console.log("User %s joined.", nick.replace(/(<([^>]+)>)/ig, ""));
        socket.join("main");

        // Tell everyone, that user joined
        io.to("main").emit("ue", {
            "nick": nick
        });

        // Tell this user who is already in
        socket.emit("start", {
            "users": users
        });

        // Send the message cache to the new user
        console.log(`going to send cache to ${nick}`);
        socket.emit("previous-msg", {
            "msgs": messageCache
        });
    });

    socket.on("send-msg", function(data){
        // If is logged in
        if(nick == null){
            socket.emit("force-login", "You need to be logged in to send message.");
            return;
        }

        const msg = {
            "f": nick,
            "m": data.m,
            "id": "msg_" + (msg_id++)
        }

        messageCache.push(msg);
        if(messageCache.length > cache_size){
            messageCache.shift(); // Remove the oldest message
        }

        // Send everyone message
        io.to("main").emit("new-msg", msg);

        console.log("User %s sent message.", nick.replace(/(<([^>]+)>)/ig, ""));
    });

    socket.on("typing", function(typing){
        // Only logged in users
        if(nick != null){
            socket.broadcast.to("main").emit("typing", {
                status: typing,
                nick: nick
            });

            console.log("%s %s typing.", nick.replace(/(<([^>]+)>)/ig, ""), typing ? "is" : "is not");
        }
    });

    socket.on("disconnect", function(){
        console.log("Got disconnect!");

        if(nick != null){
            // Remove user from users
            users.splice(users.indexOf(nick), 1);

            // Remove the IP association
            const index = userIps.findIndex(user => user.username === nick);
            if (index !== -1) {
                userIps.splice(index, 1);
            }

            // Tell everyone user left
            io.to("main").emit("ul", {
                "nick": nick
            });

            console.log("User %s left.", nick.replace(/(<([^>]+)>)/ig, ""));
            socket.leave("main");
            nick = null;
        }
    });
});
