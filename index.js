const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();

const logHistory = [];
const originalLog = console.log;
const originalError = console.error;
console.log = function(...args) {
    logHistory.push(new Date().toISOString() + ' LOG: ' + args.join(' '));
    if(logHistory.length > 50) logHistory.shift();
    originalLog.apply(console, args);
};
console.error = function(...args) {
    logHistory.push(new Date().toISOString() + ' ERROR: ' + args.join(' '));
    if(logHistory.length > 50) logHistory.shift();
    originalError.apply(console, args);
};

app.get('/logs', (req, res) => {
    res.json(logHistory);
});

let currentQR = '';
let isBotReady = false;
let client;

// Conjunto para rastrear mensagens
const botSentMessages = new Set();
const userStates = {};

mongoose.connect('mongodb+srv://pomus:Pomus2026@pomus.7qtxdzo.mongodb.net/whatsapp_bot?retryWrites=true&w=majority&appName=Pomus')
  .then(() => {
    console.log('[DB] Conectado ao MongoDB com sucesso!');
    
    client = new Client({
        authStrategy: new RemoteAuth({ store: new MongoStore({ mongoose: mongoose }), backupSyncIntervalMs: 300000 }),
        puppeteer: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--single-process',
                '--no-zygote'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        }
    });

    client.on('qr', (qr) => {
        currentQR = qr;
        console.log('\n=========================================');
        console.log('📱 ESCANEIE ESTE QR CODE PARA CONECTAR O ROBÔ:');
        console.log('=========================================\n');
        qrcode.generate(qr, {small: true});
    });

    client.on('remote_session_saved', () => {
        console.log('[DB] Sessão salva eternamente no MongoDB!');
    });

    client.on('ready', () => {
        isBotReady = true;
        console.log('\n=========================================');
        console.log('✅ ROBÔ POMUS CONECTADO E PRONTO PARA TRABALHAR!');
        console.log('=========================================\n');
    });

    client.on('message_create', async (message) => {
        if (message.fromMe) return;
        
        const chat = await message.getChat();
        if (chat.isGroup) return;

        const senderId = message.from;
        const msgText = message.body.toLowerCase();

        if (!userStates[senderId]) {
            userStates[senderId] = { step: 0 };
        }
        const state = userStates[senderId];

        if (state.step === 0) {
            const welcomeMsg = `Olá! Sou o assistente virtual do Instituto Pomus. Como posso ajudar você hoje?\n\nResponda com o número da opção desejada:\n1️⃣ Agendar uma consulta\n2️⃣ Saber mais sobre nossos tratamentos\n3️⃣ Falar com um humano`;
            botSentMessages.add(welcomeMsg);
            await client.sendMessage(senderId, welcomeMsg);
            state.step = 1;
        } else if (state.step === 1) {
            if (msgText === '1') {
                const response = `Ótimo! Para agendamentos, por favor clique no link abaixo para acessar nossa agenda online:\n👉 https://instituto-pomus.netlify.app/agendamento`;
                botSentMessages.add(response);
                await client.sendMessage(senderId, response);
                delete userStates[senderId];
            } else if (msgText === '2') {
                const response = `Oferecemos diversos tratamentos avançados. Acesse nosso site para ver a lista completa:\n👉 https://instituto-pomus.netlify.app/tratamentos`;
                botSentMessages.add(response);
                await client.sendMessage(senderId, response);
                delete userStates[senderId];
            } else if (msgText === '3') {
                const response = `Entendi! Vou transferir você para um de nossos especialistas. Aguarde um instante, por favor. 👨‍⚕️👩‍⚕️`;
                botSentMessages.add(response);
                await client.sendMessage(senderId, response);
                delete userStates[senderId];
            } else {
                const response = `Por favor, responda apenas com 1, 2 ou 3.\n\n1️⃣ Agendar uma consulta\n2️⃣ Saber mais sobre nossos tratamentos\n3️⃣ Falar com um humano`;
                botSentMessages.add(response);
                await client.sendMessage(senderId, response);
            }
        }
    });

    client.initialize().catch(err => console.error('PUPPETEER CRASHED:', err));

}).catch(err => console.error('MONGO CRASHED:', err));


app.get('/debug', (req, res) => {
    res.json({
        isReady: isBotReady,
        users: userStates
    });
});

app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`
            <html>
            <head>
                <meta http-equiv="refresh" content="20">
            </head>
            <body style="display:flex; justify-content:center; align-items:center; height:100vh; background-color:#f0f0f0;">
                <div style="text-align:center; background:white; padding:40px; border-radius:20px; box-shadow:0 10px 30px rgba(0,0,0,0.1);">
                    <h1 style="font-family:sans-serif; color:#333;">Escaneie o QR Code</h1>
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(currentQR)}" style="width:400px; height:400px;" />
                    <p style="font-family:sans-serif; color:#666; font-size: 16px; margin-top: 20px;">A página atualiza sozinha a cada 20s para o código nunca vencer!</p>
                </div>
            </body>
            </html>
        `);
    } else if (isBotReady) {
        res.send('<h1 style="font-family:sans-serif; text-align:center; margin-top:20%;">O Robô já está conectado! ✅</h1>');
    } else {
        res.send('<h1 style="font-family:sans-serif; text-align:center; margin-top:20%;">Aguarde... conectando ao servidor! (Essa página atualiza sozinha)</h1><script>setTimeout(() => location.reload(), 5000);</script>');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Express] Servidor online na porta ${PORT}`);
});
