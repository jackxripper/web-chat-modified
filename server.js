require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');

app.use(helmet());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: 'Too many requests from this IP'
});
app.use(limiter);

const html = path.join(__dirname, '/html');
app.use(express.static(html));
app.use('/static', express.static(path.join(__dirname, 'static')));

const port = process.argv[2] || 8090;
const http = require("http").Server(app);

const maxHttpBufferSizeInMb = parseInt(process.env.MAX_HTTP_BUFFER_SIZE_MB || '1');
const io = require("socket.io")(http, {
  maxHttpBufferSize: maxHttpBufferSizeInMb * 1024 * 1024,
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ["http://localhost:3000"],
    methods: ["GET", "POST"]
  }
});

const config = {
  maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH || '500'),
  maxNickLength: parseInt(process.env.MAX_NICK_LENGTH || '20'),
  cacheSize: parseInt(process.env.CACHE_SIZE || '100'),
  typingTimeout: parseInt(process.env.TYPING_TIMEOUT || '5000'),
  messageRateLimit: parseInt(process.env.MESSAGE_RATE_LIMIT || '10'), // messages per minute
};

let messageCache = [];
let users = new Map(); 
let userIps = new Map(); 
let msg_id = 1;

function sanitizeHtml(str) {
  return str.replace(/[<>]/g, '');
}

function isValidNick(nick) {
  if (!nick || typeof nick !== 'string') return false;
  nick = nick.trim();
  if (nick.length === 0 || nick.length > config.maxNickLength) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(nick)) return false; 
  return true;
}

function isValidMessage(message) {
  if (!message || typeof message !== 'string') return false;
  return message.trim().length > 0 && message.length <= config.maxMessageLength;
}

function checkRateLimit(nick) {
  const user = users.get(nick);
  if (!user) return false;
  
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  
  if (!user.messageHistory) {
    user.messageHistory = [];
  }
  
  user.messageHistory = user.messageHistory.filter(time => time > oneMinuteAgo);
  
  return user.messageHistory.length < config.messageRateLimit;
}

function logUserAction(action, nick, ip, extra = '') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${action}: ${sanitizeHtml(nick)} (${ip}) ${extra}`);
}

app.use(express.json());

const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

http.listen(port, function(){
    console.log(`Server starting on port ${port}`);
    console.log(`Configuration: ${JSON.stringify(config, null, 2)}`);
});

// Socket connection handling
io.sockets.on("connection", function(socket){
    console.log("New connection from", socket.request.connection.remoteAddress);

    let nick = null;
    const ipAddress = socket.request.connection.remoteAddress;
    let typingTimer = null;

    const currentConnections = userIps.get(ipAddress) || new Set();
    if (currentConnections.size >= 3) { // Max 3 connections per IP
        socket.emit("error", "Too many connections from this IP address");
        socket.disconnect();
        return;
    }

    socket.on("login", function(data){
        try {
            if (!data || !data.nick) {
                socket.emit("force-login", "Invalid login data.");
                return;
            }

            const requestedNick = data.nick.trim();

            if (!isValidNick(requestedNick)) {
                socket.emit("force-login", "Invalid nickname. Use only letters, numbers, underscore, and dash (max 20 chars).");
                return;
            }

            if (users.has(requestedNick)) {
                socket.emit("force-login", "This nickname is already in use.");
                return;
            }

            if (nick) {
                handleDisconnect();
            }

            nick = requestedNick;
            users.set(nick, {
                socket: socket,
                ip: ipAddress,
                joinTime: Date.now(),
                messageHistory: [],
                isTyping: false
            });
          
            if (!userIps.has(ipAddress)) {
                userIps.set(ipAddress, new Set());
            }
            userIps.get(ipAddress).add(nick);

            logUserAction("JOIN", nick, ipAddress);
            
            socket.join("main");

            
            io.to("main").emit("user-joined", {
                nick: nick,
                timestamp: Date.now()
            });

            
            socket.emit("login-success", {
                users: Array.from(users.keys()),
                serverTime: Date.now()
            });

            
            if (messageCache.length > 0) {
                socket.emit("previous-messages", {
                    messages: messageCache
                });
            }

        } catch (error) {
            console.error("Login error:", error);
            socket.emit("error", "Login failed. Please try again.");
        }
    });

    socket.on("send-message", function(data){
        try {
            if (!nick) {
                socket.emit("error", "You must be logged in to send messages.");
                return;
            }

            if (!data || !isValidMessage(data.message)) {
                socket.emit("error", "Invalid message format or length.");
                return;
            }

            if (!checkRateLimit(nick)) {
                socket.emit("error", "You're sending messages too quickly. Please slow down.");
                return;
            }

            const sanitizedMessage = sanitizeHtml(data.message.trim());
            
            const messageObj = {
                id: "msg_" + (msg_id++),
                from: nick,
                message: sanitizedMessage,
                timestamp: Date.now()
            };


            const user = users.get(nick);
            user.messageHistory.push(Date.now());

            
            messageCache.push(messageObj);
            if (messageCache.length > config.cacheSize) {
                messageCache.shift();
            }

            
            io.to("main").emit("new-message", messageObj);

            logUserAction("MESSAGE", nick, ipAddress, `"${sanitizedMessage.substring(0, 50)}${sanitizedMessage.length > 50 ? '...' : ''}"`);

        } catch (error) {
            console.error("Send message error:", error);
            socket.emit("error", "Failed to send message.");
        }
    });

    socket.on("typing", function(data){
        try {
            if (!nick) return;

            const isTyping = Boolean(data && data.typing);
            const user = users.get(nick);
            
            if (user && user.isTyping !== isTyping) {
                user.isTyping = isTyping;
                
                socket.broadcast.to("main").emit("user-typing", {
                    nick: nick,
                    typing: isTyping,
                    timestamp: Date.now()
                });

                
                if (typingTimer) {
                    clearTimeout(typingTimer);
                }

                
                if (isTyping) {
                    typingTimer = setTimeout(() => {
                        if (users.has(nick)) {
                            users.get(nick).isTyping = false;
                            socket.broadcast.to("main").emit("user-typing", {
                                nick: nick,
                                typing: false,
                                timestamp: Date.now()
                            });
                        }
                    }, config.typingTimeout);
                }
            }
        } catch (error) {
            console.error("Typing error:", error);
        }
    });

    socket.on("disconnect", function(){
        handleDisconnect();
    });

    socket.on("error", function(error) {
        console.error("Socket error for", nick || "unknown", ":", error);
    });

    function handleDisconnect() {
        try {
            if (nick) {
                logUserAction("LEAVE", nick, ipAddress);

                // Remove from users
                users.delete(nick);

                // Remove from IP tracking
                const ipSet = userIps.get(ipAddress);
                if (ipSet) {
                    ipSet.delete(nick);
                    if (ipSet.size === 0) {
                        userIps.delete(ipAddress);
                    }
                }

                // Clear typing timer
                if (typingTimer) {
                    clearTimeout(typingTimer);
                }

                // Notify others
                io.to("main").emit("user-left", {
                    nick: nick,
                    timestamp: Date.now()
                });

                socket.leave("main");
                nick = null;
            }
        } catch (error) {
            console.error("Disconnect handling error:", error);
        }
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    
    // Notify all users
    io.emit('server-shutdown', { message: 'Server is shutting down' });
    
    // Close server
    http.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Periodic cleanup (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    const oldMessageCount = messageCache.length;
    
    // Clean up old rate limit data
    for (const [nick, user] of users.entries()) {
        if (user.messageHistory) {
            user.messageHistory = user.messageHistory.filter(time => time > now - 60000);
        }
    }
    
    console.log(`Cleanup completed. Message cache: ${messageCache.length}/${config.cacheSize} messages`);
}, 5 * 60 * 1000);
