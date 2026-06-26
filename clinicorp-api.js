const username = 'institutopomus';
const token = '08e0cb66-7fd9-4cca-8d0b-d2c6d07aa350';
const baseURL = 'https://api.clinicorp.com/rest/v1';

const getHeaders = () => {
    return {
        'Authorization': 'Basic ' + Buffer.from(username + ':' + token).toString('base64'),
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
};

// 1. Listar Profissionais
async function getProfessionals() {
    try {
        const response = await fetch(`${baseURL}/professional/list_all_professionals`, {
            method: 'GET',
            headers: getHeaders()
        });
        if (!response.ok) throw new Error('Falha ao buscar profissionais');
        return await response.json();
    } catch (error) {
        console.error('Erro na API getProfessionals:', error);
        return [];
    }
}

// 2. Buscar Horários Disponíveis
async function getAvailableTimes(dateStr, codeLink, subscriberId) {
    // dateStr no formato YYYY-MM-DD
    try {
        const url = new URL(`${baseURL}/appointment/get_avaliable_times_calendar`);
        url.searchParams.append('subscriber_id', subscriberId || 'institutopomus');
        url.searchParams.append('date', dateStr);
        url.searchParams.append('code_link', codeLink || '738997'); // Oficial

        const response = await fetch(url, {
            method: 'GET',
            headers: getHeaders()
        });
        if (!response.ok) throw new Error('Falha ao buscar horários vagos');
        return await response.json();
    } catch (error) {
        console.error('Erro na API getAvailableTimes:', error);
        return [];
    }
}

// Retorna apenas os horários de um profissional específico
async function getDentistSlots(dentistId, dateStr, codeLink = '738997') {
    const allSlots = await getAvailableTimes(dateStr, codeLink, 'institutopomus');
    if (!allSlots || !Array.isArray(allSlots)) return [];
    
    // Filtra pelo ProfessionalId e mapeia apenas as strings de horário "HH:MM"
    return allSlots
        .filter(slot => slot.ProfessionalId == dentistId)
        .map(slot => slot.From);
}

// 3. Criar Solicitação de Agendamento
async function createAppointment(data) {
    try {
        const response = await fetch(`${baseURL}/appointment/create_online_scheduling`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Falha ao criar agendamento');
        return await response.json();
    } catch (error) {
        console.error('Erro na API createAppointment:', error);
        return null;
    }
}

module.exports = {
    getProfessionals,
    getAvailableTimes,
    getDentistSlots,
    createAppointment
};
