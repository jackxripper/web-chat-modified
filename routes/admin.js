const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const ADMIN_PASSWORD = '192.168.1.2'; // Set your password here
const SECRET_KEY = process.env.SECRET_KEY || 'your_secret_key'; // Set your secret key here

let bannedUsers = []; // Array to store banned usernames
let userIps = []; // Array to store usernames and IPs

// Endpoint to handle login
router.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        const token = jwt.sign({}, SECRET_KEY, { expiresIn: '1h' });
        res.json({ success: true, token: token });
    } else {
        res.json({ success: false });
    }
});

// Middleware to verify token
function verifyToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(403).send('Forbidden');
    }

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) {
            return res.status(403).send('Forbidden');
        }
        next();
    });
}

// Endpoint to get usernames and IPs
router.get('/users', verifyToken, (req, res) => {
    res.json(userIps);
});

// Endpoint to ban a username
router.post('/ban', verifyToken, (req, res) => {
    const username = req.body.username;
    if (username) {
        bannedUsers.push(username);
        console.log(`Banned user: ${username}`);
        res.status(200).send('User banned');
    } else {
        res.status(400).send('Invalid username');
    }
});

module.exports = router;
