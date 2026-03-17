// Inicializar ícones Lucide
lucide.createIcons();

// --- Variáveis Globais de Estado ---
let isRunning = false;
let leadsList = [];      // Lista completa de leads da planilha
let processedCount = 0;  // Quantos já foram enviados/falharam
let imageBase64 = null;  // Foto armazenada em base64

// --- Elementos do DOM ---
const webhookInput = document.getElementById('webhookUrl');
const delayMinInput = document.getElementById('delayMin');
const delayMaxInput = document.getElementById('delayMax');
const tagsInput = document.getElementById('globalTags');
const campaignNameInput = document.getElementById('campaignName');
const historyContainer = document.getElementById('campaignHistory');
const msgTemplateInput = document.getElementById('messageTemplate');

const excelInput = document.getElementById('excelInput');
const fileStatus = document.getElementById('fileStatus');
const totalLeadsCountEl = document.getElementById('totalLeadsCount');

const imageInput = document.getElementById('imageInput');
const imageUploadArea = document.getElementById('imageUploadArea');
const imagePreview = document.getElementById('imagePreview');
const removeImageBtn = document.getElementById('removeImageBtn');

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const clearBtn = document.getElementById('clearBtn');

// Colunas do Kanban (onde os cards caem)
const colQueue = document.getElementById('col-queue').querySelector('.kanban-cards');
const colProcessing = document.getElementById('col-processing').querySelector('.kanban-cards');
const colSent = document.getElementById('col-sent').querySelector('.kanban-cards');
const colError = document.getElementById('col-error').querySelector('.kanban-cards');

const countQueue = document.getElementById('count-queue');
const countProcessing = document.getElementById('count-processing');
const countSent = document.getElementById('count-sent');
const countError = document.getElementById('count-error');


// --- Lógica de Upload de Imagem ---
imageUploadArea.addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (evt) {
            imageBase64 = evt.target.result;
            imagePreview.querySelector('img').src = imageBase64;
            imagePreview.classList.remove('hidden');
            imageUploadArea.classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }
});

removeImageBtn.addEventListener('click', () => {
    imageBase64 = null;
    imageInput.value = '';
    imagePreview.classList.add('hidden');
    imageUploadArea.classList.remove('hidden');
});

// --- Lógica de Upload de Planilha (SheetJS) ---
excelInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileStatus.textContent = file.name;

    const reader = new FileReader();
    reader.onload = function (evt) {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Converte a planilha para Array de Objetos JSON
        leadsList = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        totalLeadsCountEl.textContent = leadsList.length;

        renderLeadsQueue();
        checkReadyState();
    };
    reader.readAsBinaryString(file);
});

// --- Lógica de Renderização do Kanban (Fase 3) ---
function renderLeadsQueue() {
    colQueue.innerHTML = '';

    leadsList.forEach((lead, index) => {
        // Tenta encontrar colunas padrões de Telefone e Nome
        // Array de keys (colunas da planilha original em string array)
        const keys = Object.keys(lead);

        // Match heurístico para telefone e nome
        const phoneKey = keys.find(k => k.toLowerCase().includes('telefone') || k.toLowerCase().includes('phone') || k.toLowerCase().includes('celular') || k.toLowerCase().includes('numero')) || keys[1];
        const nameKey = keys.find(k => k.toLowerCase().includes('nome') || k.toLowerCase().includes('name')) || keys[0];

        const phone = lead[phoneKey] || 'Sem número';
        const name = lead[nameKey] || 'Sem nome';

        // Criar elemento do card
        const card = document.createElement('div');
        card.className = 'lead-card';
        card.draggable = true;
        card.dataset.id = index; // Identificador único referenciando o index no array

        card.innerHTML = `
            <div class="card-header">
                <span class="card-title" title="${name}">${name}</span>
            </div>
            <div class="card-phone">${phone}</div>
            <div class="card-tags"></div>
        `;

        // Adiciona eventos de drag
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);

        colQueue.appendChild(card);
    });

    updateTags(); // Aplica tags pendentes
    updateCounters();
}

function updateCounters() {
    countQueue.textContent = colQueue.children.length;
    countProcessing.textContent = colProcessing.children.length;
    countSent.textContent = colSent.children.length;
    countError.textContent = colError.children.length;
}

function checkReadyState() {
    if (leadsList.length > 0 && webhookInput.value.trim() !== '') {
        startBtn.disabled = false;
    } else {
        startBtn.disabled = true;
    }
}

// Revalida botão de start quando webhook muda
webhookInput.addEventListener('input', checkReadyState);

// Aplica as tags globais a todos os cards na fila de espera
tagsInput.addEventListener('input', updateTags);

function updateTags() {
    const rawTags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t);
    const tagsHtml = rawTags.map(t => `<span class="tag">${t}</span>`).join('');

    document.querySelectorAll('.lead-card').forEach(card => {
        const tagsContainer = card.querySelector('.card-tags');
        if (tagsContainer) {
            tagsContainer.innerHTML = tagsHtml;
        }
    });
}

// --- Lógica de Drag and Drop (Fase 3) ---
let draggedCard = null;

function handleDragStart(e) {
    if (isRunning) { e.preventDefault(); return; } // Previne drag enquanto roda
    draggedCard = this;
    setTimeout(() => this.style.display = 'none', 0);
}

function handleDragEnd(e) {
    this.style.display = 'block';
    draggedCard = null;
    updateCounters();
}

const containers = document.querySelectorAll('.ds-container');
containers.forEach(container => {
    container.addEventListener('dragover', e => {
        e.preventDefault();
    });
    container.addEventListener('drop', function (e) {
        e.preventDefault();
        if (draggedCard) {
            this.appendChild(draggedCard);
        }
        updateCounters();
    });
});

// --- Lógica de Disparo (Fase 4) ---
let isPaused = false;

startBtn.addEventListener('click', async () => {
    if (isRunning) return;

    // Configurações de UI
    isRunning = true;
    isPaused = false;
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    excelInput.disabled = true;

    const webhook = webhookInput.value.trim();

    // Função recursiva/loop assíncrono para processar a fila
    await processQueue(webhook);
});

pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    if (isPaused) {
        pauseBtn.innerHTML = '<i data-lucide="play"></i> Continuar';
        pauseBtn.classList.replace('btn-secondary', 'btn-primary');
    } else {
        pauseBtn.innerHTML = '<i data-lucide="pause"></i> Pausar';
        pauseBtn.classList.replace('btn-primary', 'btn-secondary');
    }
    lucide.createIcons();
});

clearBtn.addEventListener('click', () => {
    if (isRunning) {
        if (!confirm("O envio está em andamento. Tem certeza que deseja limpar a fila?")) return;
    }

    // Reseta tudo
    leadsList = [];
    isRunning = false;
    isPaused = false;
    imageBase64 = null;

    colQueue.innerHTML = '';
    colProcessing.innerHTML = '';
    colSent.innerHTML = '';
    colError.innerHTML = '';

    fileStatus.textContent = 'Aguardando arquivo...';
    excelInput.value = '';
    totalLeadsCountEl.textContent = '0';

    imageInput.value = '';
    imagePreview.classList.add('hidden');
    imageUploadArea.classList.remove('hidden');

    checkReadyState();
    updateCounters();

    startBtn.disabled = true;
    pauseBtn.disabled = true;
    excelInput.disabled = false;

    pauseBtn.innerHTML = '<i data-lucide="pause"></i> Pausar';
    pauseBtn.classList.replace('btn-primary', 'btn-secondary');
    lucide.createIcons();
});

async function processQueue(webhook) {
    while (isRunning) {
        // Pausado? Aguarda 1 segundo e checa novamente
        if (isPaused) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        // Pega os elementos que estão fisicamente na coluna "Fila de Espera" (Top to down)
        const queueCards = Array.from(colQueue.children);
        if (queueCards.length === 0) {
            // Terminou a fila
            isRunning = false;
            startBtn.disabled = false;
            pauseBtn.disabled = true;
            excelInput.disabled = false;
            alert("Disparos finalizados!");
            break;
        }

        const currentCard = queueCards[0];
        const leadIndex = currentCard.dataset.id;
        const leadData = leadsList[leadIndex];

        // Move visualmente para "Processando"
        colProcessing.appendChild(currentCard);
        updateCounters();

        // Monta e processa mensagem
        let finalMessage = msgTemplateInput.value;
        const keys = Object.keys(leadData);

        keys.forEach(key => {
            const regex = new RegExp(`{{${key}}}`, 'gi');
            finalMessage = finalMessage.replace(regex, leadData[key]);
        });

        const tags = Array.from(currentCard.querySelectorAll('.tag')).map(t => t.textContent);

        // Try e catch fetch
        try {
            const payload = {
                campaignName: campaignNameInput.value,
                lead: leadData,
                message: finalMessage,
                tags: tags,
                image: imageBase64
            };

            const response = await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                colSent.appendChild(currentCard);
            } else {
                colError.appendChild(currentCard);
            }
        } catch (error) {
            console.error(error);
            colError.appendChild(currentCard);
        }

        updateCounters();

        // Se for o último card, salva no histórico
        if (colQueue.children.length === 0) {
            saveCampaignToHistory();
        }

        // Aguarda delay aleatório
        if (colQueue.children.length > 0 && isRunning) {
            const min = parseInt(delayMinInput.value) || 5;
            const max = parseInt(delayMaxInput.value) || 15;
            const randomDelay = Math.floor(Math.random() * (max - min + 1) + min) * 1000;

            console.log(`Aguardando ${randomDelay / 1000} segundos para o próximo envio...`);
            await new Promise(r => setTimeout(r, randomDelay));
        }
    }
}

// --- Lógica de Persistência e Histórico ---

function saveCampaignToHistory() {
    const history = JSON.parse(localStorage.getItem('zaprocket_history') || '[]');
    const newEntry = {
        name: campaignNameInput.value || 'Sem Nome',
        sent: parseInt(countSent.textContent),
        errors: parseInt(countError.textContent),
        date: new Date().toLocaleString('pt-BR')
    };

    history.unshift(newEntry); // Adiciona no início
    localStorage.setItem('zaprocket_history', JSON.stringify(history.slice(0, 5))); // Mantém os 5 últimos
    renderHistory();
}

function renderHistory() {
    const history = JSON.parse(localStorage.getItem('zaprocket_history') || '[]');
    if (history.length === 0) return;

    historyContainer.innerHTML = '';
    history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
            <div class="history-item-header">
                <span>${item.name}</span>
            </div>
            <div class="history-item-stats">
                <span class="text-success"><i data-lucide="check-circle-2" style="width:12px;height:12px"></i> ${item.sent}</span>
                <span class="text-danger"><i data-lucide="x-circle" style="width:12px;height:12px"></i> ${item.errors}</span>
            </div>
            <span class="history-item-date">${item.date}</span>
        `;
        historyContainer.appendChild(div);
    });
    lucide.createIcons();
}

function saveConfigs() {
    const configs = {
        webhook: webhookInput.value,
        delayMin: delayMinInput.value,
        delayMax: delayMaxInput.value,
        tags: tagsInput.value,
        template: msgTemplateInput.value
    };
    localStorage.setItem('zaprocket_configs', JSON.stringify(configs));
}

function loadConfigs() {
    const configs = JSON.parse(localStorage.getItem('zaprocket_configs'));
    if (configs) {
        webhookInput.value = configs.webhook || '';
        delayMinInput.value = configs.delayMin || '5';
        delayMaxInput.value = configs.delayMax || '15';
        tagsInput.value = configs.tags || '';
        msgTemplateInput.value = configs.template || '';
    }
    renderHistory();
}

// Event Listeners para salvar automaticamente
[webhookInput, delayMinInput, delayMaxInput, tagsInput, msgTemplateInput].forEach(el => {
    el.addEventListener('input', saveConfigs);
});

// Inicializar
loadConfigs();
console.log("Sistema Completo Inicializado.");
