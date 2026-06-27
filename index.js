const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');
const { saveContactLog } = require('./integration');
const { getProfessionals, getAvailableTimes, createAppointment, getDentistSlots } = require('./clinicorp-api');
const fs = require('fs');
const path = require('path');

// Carrega o catálogo de serviços, promoções e profissionais
const catalogoPath = path.join(__dirname, 'catalogo.json');
let catalogo = { promocoes: [], servicos: [], profissionais: {} };
try {
    catalogo = JSON.parse(fs.readFileSync(catalogoPath, 'utf8'));
} catch (e) {
    console.error('[ERRO] Falha ao carregar catalogo.json', e);
}

// ---------------------------------------------------------
// 0. Memória de Conversa (Estado)
// ---------------------------------------------------------
const userStates = {};

// ---------------------------------------------------------
// 1. Configuração do Bot do WhatsApp
// ---------------------------------------------------------
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    },
    pairWithPhoneNumber: {
        phoneNumber: '5598984633233' // Número da Clínica com +55 (Brasil)
    }
});

client.on('qr', (qr) => {
    console.log('Gerando código de pareamento, aguarde um instante...');
});

// Evento exclusivo para Código de Pareamento
let isBotReady = false;

client.on('code', (code) => {
    console.log('\n=========================================');
    console.log('🤖 CÓDIGO DE CONEXÃO DO ROBÔ POMUS:');
    console.log(`         >>> ${code} <<<         `);
    console.log('=========================================\n');
    console.log('Vá no seu WhatsApp > Aparelhos Conectados > Conectar com Número de Telefone');
    console.log('E digite esse código exatamente como está acima!\n');
});

client.on('ready', () => {
    isBotReady = true;
    console.log('\n=========================================');
    console.log('✅ ROBÔ POMUS CONECTADO E PRONTO PARA TRABALHAR!');
    console.log('=========================================\n');
});

// Conjunto para rastrear mensagens enviadas pelo próprio robô e não confundi-las com mensagens humanas
const botSentMessages = new Set();

// Função auxiliar para o bot enviar mensagens sem se silenciar
async function botSendMessage(to, content, options = {}) {
    try {
        let number = to.replace('@c.us', '').replace('@g.us', '');
        if (!userStates[number]) userStates[number] = {};
        userStates[number].isBotSending = true; // SINALIZA QUE O BOT ESTÁ ENVIANDO

        const sentMsg = await client.sendMessage(to, content, options);
        
        // Remove a flag após 3 segundos para garantir que o evento message_create passe
        setTimeout(() => {
            if (userStates[number]) userStates[number].isBotSending = false;
        }, 3000);

        return sentMsg;
    } catch (e) {
        console.error('[ERROR] Falha ao enviar mensagem pelo bot:', e);
    }
}

// Lógica de Autoatendimento (Menu e Fluxo de Agendamento)
client.on('message_create', async msg => {
    const chat = await msg.getChat();
    // Se for mensagem em grupo ou de status, ignoramos totalmente
    if (chat.isGroup || msg.from === 'status@broadcast' || msg.to === 'status@broadcast') {
        return;
    }

    // Extrai o número de telefone de forma segura sem usar getContact() (que causa bug em linked devices)
    let number = '';
    if (msg.fromMe) {
        number = msg.to ? msg.to.replace('@c.us', '').replace('@g.us', '') : '';
    } else {
        number = msg.from ? msg.from.replace('@c.us', '').replace('@g.us', '') : '';
    }

    // Se a clínica enviou mensagem para alguém (msg.fromMe == true), 
    // colocamos o estado em "HUMANO" para o robô não sequestrar a conversa quando o cliente responder.
    if (msg.fromMe && msg.to !== msg.from) {
        // Verifica se essa mensagem foi enviada pelo próprio script (Bot)
        if (userStates[number] && userStates[number].isBotSending) {
            return; // Foi o robô que enviou, então não muda o status para HUMANO
        }

        // Foi um humano usando o WhatsApp da clínica! Silencia o robô.
        if (!userStates[number]) userStates[number] = {};
        userStates[number].step = 'HUMANO';
        userStates[number].lastMessageTimestamp = Date.now();
        return;
    }

    // Ignora mensagens antigas/não lidas (REMOVIDO: Problemas de fuso/sincronia do relógio da Render)
    const tempoAtual = Math.floor(Date.now() / 1000);
    // if (msg.timestamp < tempoAtual - 60) {
    //     return; 
    // }

    // =========================================================
    // 🛑 MODO DE TESTE (TRAVA DE SEGURANÇA)
    // =========================================================
    const NUMEROS_TESTE = ['84585451', '267572234682509']; // Seu número final e também o ID que o WhatsApp gerou
    

    
    console.log(`[DEBUG] Mensagem recebida de: ${number}`);
    
    // Verifica se o número de quem enviou termina com algum dos números de teste (para salvar áudios)
    const isTestNumber = NUMEROS_TESTE.length === 0 || NUMEROS_TESTE.some(num => number.endsWith(num));
    
    // A TRAVA FOI REMOVIDA DAQUI PARA LIBERAR O PÚBLICO! 🎉

    const textoRaw = msg.body || '';
    const texto = textoRaw.toLowerCase().trim();
    
    const pushname = msg._data?.notifyName || '';

    console.log(`[DEBUG] Mensagem recebida de ${number}: "${textoRaw}"`);

    // =========================================================
    // SALVADOR MÁGICO DE ÁUDIO (Para o dono do bot)
    // =========================================================
    if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt' || msg.type === 'voice') && isTestNumber) {
        console.log("[DEBUG] Baixando o áudio que você encaminhou...");
        try {
            const media = await msg.downloadMedia();
            if (media) {
                const audioBuffer = Buffer.from(media.data, 'base64');
                fs.writeFileSync(path.join(__dirname, 'boas_vindas.ogg'), audioBuffer);
                console.log("[SUCESSO] Áudio salvo como boas_vindas.ogg!");
                await botSendMessage(msg.from, "✅ *Áudio de boas vindas salvo com sucesso!* 🎙️\n\nEu já baixei o áudio do seu celular e guardei na minha pasta. A partir de agora, toda cliente nova vai receber ele! (Para testar, lembre de mandar 'cancelar' e depois um 'Oi' de novo).");
                return; // Para o fluxo aqui e não faz mais nada
            }
        } catch (e) {
            console.error("[ERROR] Falha ao salvar áudio:", e);
            await botSendMessage(msg.from, "❌ Falha ao tentar salvar o áudio.");
            return;
        }
    }

    // Salva o contato de quem mandou mensagem
    try {
        saveContactLog(number, pushname, msg.body);
    } catch (e) {
        console.error("Erro ao salvar log", e);
    }

    // Se o usuário quiser cancelar o fluxo a qualquer momento
    if (texto === 'cancelar' || texto === 'sair') {
        delete userStates[number];
        try {
            console.log(`[DEBUG] Enviando mensagem de cancelamento para ${msg.from}`);
            await botSendMessage(msg.from, 'Atendimento cancelado! ☺️ Se precisar de algo, é só mandar "Oi".');
        } catch (e) {
            console.error('[ERROR] Falha ao enviar cancelamento:', e);
        }
        return;
    }

    // Inicializa o estado do usuário ou reseta se tiver passado mais de 3 dias sem falar
    let isFirstMessage = false;
    if (!userStates[number] || (Date.now() - (userStates[number].lastMessageTimestamp || 0) > 3 * 24 * 60 * 60 * 1000)) {
        isFirstMessage = true;
    }
    let state = isFirstMessage ? { step: 'IDLE' } : userStates[number];
    state.lastMessageTimestamp = Date.now();
    userStates[number] = state;

    // Se a conversa já foi iniciada ou assumida por um humano, o robô fica calado
    if (state.step === 'HUMANO') {
        return;
    } // Salva na memória que ele já passou por aqui

    if (state.step === 'IDLE') {
        // Resposta Inicial / Menu Principal
        const saudacao = `Olá ${pushname ? pushname + ', ' : ''}seja bem-vinda(o) ao Instituto Pomus 💙🍎☺️\n\nEstamos aqui para ajudá-la(o) a alcançar seus objetivos de saúde, beleza e bem-estar. Tudo foi pensado para trazer pra você a melhor experiência de cuidados 🌷\n\nComo podemos te ajudar hoje? Digite o número da opção desejada:\n\n1️⃣ - Novo Agendamento & Avaliação\n2️⃣ - Reagendamento ou Cancelamento\n3️⃣ - Promoções do Mês ✨\n4️⃣ - Nosso Site e Valores 💻\n5️⃣ - Nossa Localização\n6️⃣ - Falar com uma Especialista`;
        
        try {
            if (texto === '1' || texto === '1.' || texto === '1-' || texto.includes('agendamento')) {
                userStates[number] = { step: 'AGENDAMENTO_CATEGORIA', lastMessageTimestamp: Date.now() };
                const categoriasUnicas = [...new Set(catalogo.servicos.map(s => s.categoria))];
                userStates[number].categoriasDisponiveis = categoriasUnicas;
                
                let categoriasLista = categoriasUnicas.map((c, idx) => `${idx + 1}️⃣ - ${c}`).join('\n');
                await botSendMessage(msg.from, `🗓️ *Agendamentos*\n\nQue maravilha! Vamos agendar o seu momento de cuidado. 💙\n\nQual *categoria* de procedimento você deseja realizar hoje? Digite o *número* da opção:\n\n${categoriasLista}`);
            }
            else if (texto === '2' || texto === '2.' || texto === '2-' || texto.includes('reagendar') || texto.includes('cancelar')) {
                await botSendMessage(msg.from, `📅 *Reagendamento ou Cancelamento*\n\nCom certeza! Estou transferindo o seu contato para a nossa equipe gerenciar a sua agenda.\n\nPor favor, aguarde um momento que uma de nossas especialistas já vai te dar atenção especial 🌷💙`);
            }
            else if (texto === '3' || texto === '3.' || texto === '3-' || texto.includes('promo')) {
                userStates[number] = { step: 'PROMOCOES_CATEGORIA', lastMessageTimestamp: Date.now() };
                await botSendMessage(msg.from, `🎁 *Promoções Ativas no Pomus*\n\nVocê deseja saber sobre qual destas opções? Digite o *número*:\n\n1️⃣ - Harmonização Facial, Corporal e Íntima\n2️⃣ - Serviços de SPA`);
            }
            else if (texto === '4' || texto === '4.' || texto === '4-' || texto.includes('site') || texto.includes('valor')) {
                await botSendMessage(msg.from, `💻 *Nosso Site Oficial*\n\nPara conhecer todos os nossos serviços, ver a tabela completa de valores e explorar o universo Pomus, acesse o nosso site:\n\n👉 www.institutopomus.com.br\n\nSe quiser agendar algo que viu por lá, é só digitar *1*!`);
            }
            else if (texto === '5' || texto === '5.' || texto === '5-' || texto.includes('localização') || texto.includes('localizacao') || texto.includes('endereço')) {
                await botSendMessage(msg.from, `📍 *Nossa Localização*\n\nSerá um prazer receber você no nosso espaço! 🍎\n\nEstamos localizados na Avenida Daniel de Lá Touche, n° 06 Cohama.\nPonto de Referência: Papelaria Bagatela Cohama.\n\nUse o link do Google Maps para facilitar a chegada:\nhttps://maps.google.com/?q=-2.506290,-44.241158\n\nChegue com 10 minutos de antecedência para aproveitar nosso delicioso café ☕️ ou chazinho 🫖!`);
            }
            else if (texto === '6' || texto === '6.' || texto === '6-' || texto.includes('atendente') || texto.includes('falar')) {
                await botSendMessage(msg.from, `👩‍⚕️ *Atendimento Humanizado*\n\nCom certeza! Estou transferindo o seu contato para a nossa equipe. \n\nPor favor, aguarde um momento que uma de nossas especialistas já vai te dar atenção especial 🌷💙`);
            }
            else {
                // Se o cliente não escolheu opção do menu, manda o menu na PRIMEIRA mensagem
                if (isFirstMessage) {
                    // Tenta encontrar e enviar o áudio gravado primeiro
                    const extensoes = ['mp3', 'ogg', 'mp4', 'm4a', 'wav', 'aac'];
                    let audioPath = null;
                    for (let ext of extensoes) {
                        const p = path.join(__dirname, `boas_vindas.${ext}`);
                        if (fs.existsSync(p)) {
                            audioPath = p;
                            break;
                        }
                    }
                    
                    if (audioPath) {
                        try {
                            const media = MessageMedia.fromFilePath(audioPath);
                            // Enviando como áudio normal (já que é ogg nativo do zap, ele se comporta bem)
                            await botSendMessage(msg.from, media);
                        } catch (e) {
                            console.error('[ERROR] Falha ao enviar áudio de boas vindas:', e);
                        }
                    }

                    // Envia o menu em texto logo em seguida
                    await botSendMessage(msg.from, saudacao);
                }
            }
        } catch (e) {
            console.error('[ERROR] Falha ao enviar mensagem IDLE:', e);
        }
    }
    else if (state.step === 'PROMOCOES_CATEGORIA') {
        let promocoesTexto = "";
        try {
            if (texto === '1' || texto === '1.' || texto.includes('facial') || texto.includes('injet')) {
                promocoesTexto = fs.readFileSync(path.join(__dirname, 'promocoes_harmonizacao.txt'), 'utf8');
            } else if (texto === '2' || texto === '2.' || texto.includes('spa') || texto.includes('massagem')) {
                promocoesTexto = fs.readFileSync(path.join(__dirname, 'promocoes_spa.txt'), 'utf8');
            } else {
                await botSendMessage(msg.from, `Por favor, selecione uma opção válida:\n1️⃣ - Harmonização Facial, Corporal e Íntima\n2️⃣ - Serviços de SPA`);
                return;
            }
        } catch (e) {
            promocoesTexto = "Desculpe, não conseguimos carregar as promoções no momento.";
        }
        
        // Retorna ao estado IDLE para permitir novo fluxo
        userStates[number] = { step: 'IDLE', lastMessageTimestamp: Date.now() };
        await botSendMessage(msg.from, `🎁 *Promoções Ativas no Pomus*\n\n${promocoesTexto}\n\nPara agendar, digite *1*. Se precisar falar com a gente, digite *6*.`);
    }
    else if (state.step === 'AGENDAMENTO_CATEGORIA') {
        const indiceCat = parseInt(texto) - 1;
        const categoriasUnicas = userStates[number].categoriasDisponiveis || [...new Set(catalogo.servicos.map(s => s.categoria))];
        const categoriaSelecionada = categoriasUnicas[indiceCat];

        if (!categoriaSelecionada) {
            let categoriasLista = categoriasUnicas.map((c, idx) => `${idx + 1}️⃣ - ${c}`).join('\n');
            await botSendMessage(msg.from, `Por favor, selecione um número válido:\n\n${categoriasLista}`);
            return;
        }

        const servicosFiltrados = catalogo.servicos.filter(s => s.categoria === categoriaSelecionada);
        
        userStates[number].opcoesServicos = servicosFiltrados;
        userStates[number].step = 'AGENDAMENTO_PROCEDIMENTO';
        
        let servicosLista = servicosFiltrados.map((s, index) => `${index + 1}️⃣ - ${s.nome}`).join('\n');
        await botSendMessage(msg.from, `Excelente escolha! 🌷\n\nEstes são os nossos procedimentos de *${categoriaSelecionada}*.\nQual deles você deseja agendar? Digite o *número* da opção:\n\n${servicosLista}`);
    }
    else if (state.step === 'AGENDAMENTO_PROCEDIMENTO') {
        const indiceServico = parseInt(texto) - 1;
        const opcoes = userStates[number].opcoesServicos || catalogo.servicos;
        let servicoEscolhido = opcoes[indiceServico];

        // Se o cliente não digitou número ou digitou um número fora da lista
        if (!servicoEscolhido) {
            servicoEscolhido = {
                nome: msg.body,
                profissionaisAutorizados: Object.keys(catalogo.profissionais) // Considera todos
            };
        }

        userStates[number].procedimento = servicoEscolhido.nome;
        userStates[number].preco = servicoEscolhido.preco || "Sob consulta";
        userStates[number].profissionaisAutorizados = servicoEscolhido.profissionaisAutorizados;
        userStates[number].step = 'AGENDAMENTO_PROFISSAO';
        
        let profLista = servicoEscolhido.profissionaisAutorizados.map((idProf, index) => {
            return `${index + 1}️⃣ ${catalogo.profissionais[idProf]}`;
        }).join('\n');
        
        const count = servicoEscolhido.profissionaisAutorizados.length;
        profLista += `\n${count + 1}️⃣ Primeira disponível`;

        await botSendMessage(msg.from, `Certo! Você quer realizar: *${servicoEscolhido.nome}* 🌷\n\nCom qual especialista você gostaria de ser atendida(o)?\n\n${profLista}\n\nDigite o número ou o nome da profissional:`);
    }
    else if (state.step === 'AGENDAMENTO_PROFISSAO') {
        const autorizados = userStates[number].profissionaisAutorizados || ["4511118962720769"];
        let profIndex = parseInt(texto) - 1;
        let idProf = autorizados[0]; // fallback
        
        if (profIndex >= 0 && profIndex < autorizados.length) {
            idProf = autorizados[profIndex];
        }
        
        userStates[number].idProfissionalSelecionado = idProf;

        // Buscar horários REAIS disponíveis para amanhã
        await botSendMessage(msg.from, `Buscando horários disponíveis na agenda... ⏳`);
        
        const d = new Date();
        d.setDate(d.getDate() + 1); // Amanhã
        const dateStr = d.toISOString().split('T')[0];
        
        const slots = await getDentistSlots(idProf, dateStr);
        
        // Pega os 2 primeiros horários únicos disponíveis, ou cai para fallback
        const uniqueSlots = [...new Set(slots)].slice(0, 2);
        
        let msgHorarios = `Para esse procedimento, tenho os seguintes horários disponíveis para amanhã:\n\n`;
        let opcoes = [];
        
        if (uniqueSlots.length > 0) {
            uniqueSlots.forEach((slot, i) => {
                msgHorarios += `${i + 1}️⃣ ${slot}h\n`;
                opcoes.push(slot);
            });
        } else {
            msgHorarios += `1️⃣ 10:00h\n2️⃣ 15:30h\n`; // Fallback simulado
            opcoes = ["10:00", "15:30"];
        }
        
        msgHorarios += `\nQual você prefere? (Digite o número da opção)`;

        userStates[number].opcoesHorario = opcoes;
        userStates[number].step = 'AGENDAMENTO_HORARIO';

        await botSendMessage(msg.from, msgHorarios);
    }
    else if (state.step === 'AGENDAMENTO_HORARIO') {
        let hIndex = parseInt(texto) - 1;
        const opcoes = userStates[number].opcoesHorario || ["10:00", "15:30"];
        
        let h = opcoes[0]; // Default fallback
        if (hIndex >= 0 && hIndex < opcoes.length) {
            h = opcoes[hIndex];
        } else if (texto.includes(opcoes[0])) {
            h = opcoes[0];
        } else if (opcoes.length > 1 && texto.includes(opcoes[1])) {
            h = opcoes[1];
        }
        
        userStates[number].horario = h;
        userStates[number].step = 'AGENDAMENTO_CONFIRMACAO';
        
        await botSendMessage(msg.from, `Quase lá! 🍎\n\nPara eu registrar a sua reserva, por favor me informe apenas o seu *NOME COMPLETO*:`);
    } 
    else if (state.step === 'AGENDAMENTO_CONFIRMACAO') {
        const dadosPaciente = texto;
        userStates[number].nomePaciente = dadosPaciente;
        userStates[number].step = 'AGENDAMENTO_CPF';

        await botSendMessage(msg.from, `Perfeito, ${dadosPaciente}! 🌷\n\nAgora, por favor, digite o seu *CPF* (apenas números) para registrarmos na ficha da clínica:`);
    }
    else if (state.step === 'AGENDAMENTO_CPF') {
        const cpfPaciente = texto.replace(/\D/g, ''); // Extrai apenas números
        
        if (cpfPaciente.length !== 11) {
            await botSendMessage(msg.from, `❌ CPF inválido. Por favor, digite os 11 números do seu CPF corretamente:`);
            return;
        }

        userStates[number].cpfPaciente = cpfPaciente;
        userStates[number].step = 'AGENDAMENTO_FINALIZAR';
        
        await botSendMessage(msg.from, `Processando o seu agendamento no Clinicorp... ⏳`);

        const telefoneWhatsApp = number.replace('@c.us', ''); 

        // Calculando data de amanhã
        const d = new Date();
        d.setDate(d.getDate() + 1);
        const dateISO = d.toISOString();

        // Calculando toTime (adicionando 1 hora)
        const fromT = userStates[number].horario || "10:00";
        const fromT_split = fromT.split(':');
        let toH = parseInt(fromT_split[0]) + 1;
        const toT = `${toH.toString().padStart(2, '0')}:${fromT_split[1] || '00'}`;

        // Preparando os dados para o Clinicorp
        const payload = {
            Clinic_BusinessId: 4822629786583041, // ID Oficial da Clínica
            Dentist_PersonId: userStates[number].idProfissionalSelecionado || 4511118962720769, 
            CodeLink: 738997, // ID de Integração Oficial!
            PatientName: userStates[number].nomePaciente,
            MobilePhone: telefoneWhatsApp, // Telefone pego pelo WhatsApp
            OtherDocumentId: userStates[number].cpfPaciente, // CPF de verdade
            SchedulingReason: userStates[number].procedimento,
            fromTime: fromT,
            toTime: toT, // Duração de 1 hora
            date: dateISO, 
            IsOnlineScheduling: true
        };

        try {
            console.log("[DEBUG] Enviando para o Clinicorp:", payload);
            const resposta = await createAppointment(payload);
            console.log("[DEBUG] Resposta Clinicorp:", resposta);

            await botSendMessage(msg.from, `✅ *Agendamento Reservado!* 🎉\n\nProcedimento: *${userStates[number].procedimento}*\nValor: *${userStates[number].preco}*\n\nO seu horário foi salvo na agenda da clínica e o seu número (${telefoneWhatsApp}) foi vinculado à ficha! 💙\n\nPara concluirmos a sua reserva, como você prefere realizar o pagamento?\n\n1️⃣ PIX\n2️⃣ Cartão de Crédito\n\n(Digite o número da opção)`);
        } catch (error) {
            console.error('[CLINICORP API ERROR - CREATE]', error);
            await botSendMessage(msg.from, `✅ *(Simulação)* Agendamento Reservado! 🎉\n\nProcedimento: *${userStates[number].procedimento}*\nValor: *${userStates[number].preco}*\n\nPara concluirmos a sua reserva, como você prefere realizar o pagamento?\n\n1️⃣ PIX\n2️⃣ Cartão de Crédito\n\n(Digite o número da opção)`);
        }
        
        userStates[number].step = 'AGENDAMENTO_PAGAMENTO';
    }
    else if (state.step === 'AGENDAMENTO_PAGAMENTO') {
        if (texto === '1' || texto.includes('pix')) {
            await botSendMessage(msg.from, `Excelente! Você escolheu *PIX*. 💳\n\nAqui está a nossa Chave PIX (Celular):\n\n*98984633233*\n\n_(Dica: É só copiar o número acima)_\n\nEstou transferindo o seu atendimento agora mesmo para a nossa secretária. Você pode enviar o comprovante diretamente por aqui para ela confirmar de vez o seu horário!\n\nAguarde um minutinho que a equipe humana já vai te dar atenção especial 🌷💙`);
        } else {
            await botSendMessage(msg.from, `Excelente! Você escolheu *Cartão de Crédito*. 💳\n\nEstou transferindo o seu atendimento agora mesmo para a nossa secretária. Ela vai te enviar o link de pagamento seguro para confirmar de vez o seu horário!\n\nAguarde um minutinho que a equipe humana já vai te dar atenção especial 🌷💙`);
        }
        
        // Limpa o estado da memória
        delete userStates[number];
    }
});

client.initialize();

// ---------------------------------------------------------
// 2. Configuração da API (Servidor de Notificações)
// ---------------------------------------------------------
const app = express();
app.use(express.json());
app.use(cors());

// Rota para outros sistemas enviarem mensagens pelo WhatsApp
app.post('/send-message', async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({ error: 'Número e mensagem são obrigatórios.' });
    }

    try {
        // O whatsapp-web.js exige que o número termine com @c.us (ex: 5511999999999@c.us)
        const chatId = `${number}@c.us`;
        await botSendMessage(chatId, message);
        console.log(`✅ Mensagem enviada para ${number}`);
        res.status(200).json({ success: true, message: 'Mensagem enviada com sucesso!' });
    } catch (error) {
        console.error('Erro ao enviar mensagem via API:', error);
        res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor de API (Notificações) rodando na porta ${PORT}`);
    console.log(`Você pode enviar requisições POST para http://localhost:${PORT}/send-message`);
});
app.get('/debug', (req, res) => {
    res.json({
        isReady: isBotReady,
        users: userStates
    });
});

module.exports = { app };
// Forcing restart
