const fs = require('fs');
const path = require('path');

// Caminho do arquivo onde salvaremos os dados (como uma base de dados simples)
const dbPath = path.join(__dirname, 'contatos.json');

/**
 * Função para salvar as interações dos contatos
 * @param {string} number Número de telefone do contato
 * @param {string} name Nome do contato (pushname)
 * @param {string} message Mensagem enviada
 */
function saveContactLog(number, name, message) {
    let data = [];

    // Tenta ler o arquivo existente
    if (fs.existsSync(dbPath)) {
        try {
            const fileContent = fs.readFileSync(dbPath, 'utf8');
            data = JSON.parse(fileContent);
        } catch (error) {
            console.error('Erro ao ler o banco de dados:', error);
        }
    }

    // Adiciona o novo log
    data.push({
        timestamp: new Date().toISOString(),
        number: number,
        name: name || 'Desconhecido',
        lastMessage: message
    });

    // Salva de volta no arquivo
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
    saveContactLog
};
