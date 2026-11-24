const API_URL = 'https://script.google.com/macros/s/AKfycbx1TPhqlrdP9oy_U3DMkATqExfwEXfdP_ane6o2_EvFkp7dc5jI6HJFRKbnYq_Ty-gC/exec';

let idToken = sessionStorage.getItem('psaac_id_token') || null;
let allEvents = [];
let dbLists = {};
let calendar = null;
let currentExportMode = 'FDS';

// ================= INICIALIZAÇÃO & LOGIN =================
window.addEventListener('DOMContentLoaded', () => {
  if (idToken) {
    iniciarSessaoApp();
  }
});

function handleCredentialResponse(response) {
  idToken = response.credential;
  sessionStorage.setItem('psaac_id_token', idToken);
  iniciarSessaoApp();
}

function terminarSessao() {
  sessionStorage.removeItem('psaac_id_token');
  idToken = null;
  location.reload();
}

async function apiRequest(payload) {
  payload.token = idToken;
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

async function iniciarSessaoApp() {
  const errBox = document.getElementById('loginError');
  errBox.classList.add('hidden');

  try {
    const data = await apiRequest({ action: 'getData' });
    if (data.status !== 'success') {
      sessionStorage.removeItem('psaac_id_token');
      errBox.textContent = data.message || 'Utilizador não autorizado.';
      errBox.classList.remove('hidden');
      return;
    }

    document.getElementById('userEmailDisplay').textContent = data.user;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appContainer').classList.remove('hidden');

    allEvents = data.events || [];
    dbLists = data.lists || {};

    preencherListasInterface();
    inicializarCalendario();
  } catch (err) {
    errBox.textContent = 'Erro de ligação ao servidor: ' + err.message;
    errBox.classList.remove('hidden');
  }
}

async function carregarDados() {
  mostrarToast('A sincronizar com Google Sheets...');
  const data = await apiRequest({ action: 'getData' });
  if (data.status === 'success') {
    allEvents = data.events || [];
    dbLists = data.lists || {};
    aplicarFiltrosCalendario();
    mostrarToast('Dados atualizados!');
  } else {
    mostrarToast('Erro: ' + data.message);
  }
}

// ================= PREENCHER LISTAS & FILTROS =================
function preencherListasInterface() {
  // Selects do Formulário de Evento
  popularSelect('evTipo', dbLists['Tipo de Evento'] || []);
  popularSelect('evPoliciamento', dbLists['Pedido Policiamento'] || ['NA', 'Sim', 'Não'], 'NA');
  popularSelect('evEstado', dbLists['Estado de Evento'] || ['Planeado', 'Confirmado', 'Adiado', 'Cancelado'], 'Planeado');
  popularSelect('evNotificado', dbLists['Notificado'] || ['NA', 'Sim', 'Não'], 'NA');

  // Datalists
  popularDataList('dlEscaloes', dbLists['Escalões'] || []);
  popularDataList('dlLocais', dbLists['Local'] || []);
  popularDataList('dlCompeticoes', dbLists['Competição'] || []);
  popularDataList('dlEmailPedido', dbLists['Email Pedido'] || []);
  popularDataList('dlEmailConfirmacao', dbLists['Email Confirmação'] || []);

  // Filtros do Topo
  popularSelect('filtroEscalao', dbLists['Escalões'] || [], '', 'Todos os Escalões');
  popularSelect('filtroLocal', dbLists['Local'] || [], '', 'Todos os Locais');
  popularSelect('filtroTipo', dbLists['Tipo de Evento'] || [], '', 'Todos os Tipos');

  // Chips dos Modais de Recorrência e Exportação
  renderizarChips('recEscaloesBox', dbLists['Escalões'] || [], false, atualizarPrevisaoRecorrencia);
  renderizarChips('expEscaloesBox', dbLists['Escalões'] || [], true);
  renderizarChips('expTiposBox', dbLists['Tipo de Evento'] || [], true);
}

function popularSelect(id, items, defaultVal = '', firstOptionLabel = null) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  if (firstOptionLabel !== null) {
    el.add(new Option(firstOptionLabel, ''));
  }
  items.forEach(item => el.add(new Option(item, item)));
  if (defaultVal) el.value = defaultVal;
}

function popularDataList(id, items) {
  const dl = document.getElementById(id);
  dl.innerHTML = '';
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item;
    dl.appendChild(opt);
  });
}

function renderizarChips(containerId, items, checkedByDefault, onChangeCallback = null) {
  const box = document.getElementById(containerId);
  box.innerHTML = '';
  items.forEach(item => {
    const label = document.createElement('label');
    label.className = 'chip-item' + (checkedByDefault ? ' active' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = item;
    cb.checked = checkedByDefault;
    cb.onchange = () => {
      label.classList.toggle('active', cb.checked);
      if (onChangeCallback) onChangeCallback();
    };
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + item));
    box.appendChild(label);
  });
}

function toggleChips(boxId, state) {
  document.querySelectorAll(`#${boxId} input[type="checkbox"]`).forEach(cb => {
    cb.checked = state;
    cb.parentElement.classList.toggle('active', state);
  });
  if (boxId === 'recEscaloesBox') atualizarPrevisaoRecorrencia();
}

// ================= FULLCALENDAR =================
function inicializarCalendario() {
  const calendarEl = document.getElementById('calendar');
  calendar = new FullCalendar.Calendar(calendarEl, {
    locale: 'pt',
    initialView: 'timeGridWeek',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay'
    },
    slotMinTime: '08:00:00',
    slotMaxTime: '24:00:00',
    allDaySlot: false,
    editable: true,
    selectable: true,
    nowIndicator: true,
    height: '100%',
    events: mapearEventosParaCalendario(allEvents),

    // Clicar num espaço vazio para criar evento
    select: (info) => {
      const dataStr = info.startStr.slice(0, 10);
      const hIni = info.startStr.includes('T') ? info.startStr.slice(11, 16) : '19:00';
      const hFim = info.endStr.includes('T') ? info.endStr.slice(11, 16) : '20:30';
      abrirModalNovoEvento(dataStr, hIni, hFim);
      calendar.unselect();
    },

    // Clicar num cartão existente
    eventClick: (info) => {
      const ev = info.event.extendedProps.raw;
      abrirModalEditarEvento(ev);
    },

    // Arrastar cartão (Drag & Drop)
    eventDrop: async (info) => {
      await atualizarHorarioViaDrag(info);
    },

    // Redimensionar duração (Resize)
    eventResize: async (info) => {
      await atualizarHorarioViaDrag(info);
    }
  });

  calendar.render();
}

function obterCorEvento(ev) {
  const estado = (ev.estado || '').toLowerCase();
  const tipo = (ev.tipo || '').toLowerCase();
  if (estado.includes('cancelado') || estado.includes('adiado')) return '#d93025';
  if (tipo.includes('jogo') || tipo.includes('torneio')) return '#188038';
  if (estado.includes('confirmado')) return '#1a73e8';
  return '#0284c7';
}

function mapearEventosParaCalendario(lista) {
  return lista
    .filter(ev => ev.data)
    .map(ev => {
      const hIni = ev.horaInicio || '09:00';
      const hFim = ev.horaFim || somarUmaHora(hIni);
      const confronto = (ev.visitado && ev.visitante) ? `${ev.visitado} vs ${ev.visitante}` : (ev.observacao || ev.tipo);
      const titulo = `${ev.escalao} • ${confronto}${ev.local ? ' (' + ev.local + ')' : ''}`;

      return {
        id: ev.id,
        title: titulo,
        start: `${ev.data}T${hIni}:00`,
        end: `${ev.data}T${hFim}:00`,
        backgroundColor: obterCorEvento(ev),
        extendedProps: { raw: ev }
      };
    });
}

function somarUmaHora(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const novaH = Math.min(h + 1, 23).toString().padStart(2, '0');
  return `${novaH}:${String(m || 0).padStart(2, '0')}`;
}

function aplicarFiltrosCalendario() {
  const fEsc = document.getElementById('filtroEscalao').value.toLowerCase();
  const fLoc = document.getElementById('filtroLocal').value.toLowerCase();
  const fTip = document.getElementById('filtroTipo').value.toLowerCase();

  const filtrados = allEvents.filter(ev => {
    if (fEsc && !(ev.escalao || '').toLowerCase().includes(fEsc)) return false;
    if (fLoc && (ev.local || '').toLowerCase() !== fLoc) return false;
    if (fTip && (ev.tipo || '').toLowerCase() !== fTip) return false;
    return true;
  });

  calendar.removeAllEvents();
  calendar.addEventSource(mapearEventosParaCalendario(filtrados));
}

async function atualizarHorarioViaDrag(info) {
  const ev = { ...info.event.extendedProps.raw };
  const start = info.event.start;
  const end = info.event.end || new Date(start.getTime() + 3600000);

  ev.data = formatarDataLocal(start);
  ev.horaInicio = formatarHoraLocal(start);
  ev.horaFim = formatarHoraLocal(end);

  mostrarToast('A guardar novo horário...');
  const resp = await apiRequest({ action: 'saveEvent', event: ev });

  if (resp.status === 'success') {
    const idx = allEvents.findIndex(item => item.id === ev.id);
    if (idx !== -1) allEvents[idx] = resp.event;
    info.event.setExtendedProp('raw', resp.event);
    mostrarToast('Horário atualizado no Sheets!');
  } else {
    info.revert();
    mostrarToast('Erro ao guardar: ' + resp.message);
  }
}

function formatarDataLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatarHoraLocal(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ================= MODAL EVENTO (CRIAR / EDITAR) =================
function abrirModalNovoEvento(data = '', horaInicio = '19:00', horaFim = '20:30') {
  document.getElementById('modalEventoTitulo').textContent = '➕ Novo Evento';
  document.getElementById('formEvento').reset();
  document.getElementById('evId').value = '';
  document.getElementById('evData').value = data || formatarDataLocal(new Date());
  document.getElementById('evHoraInicio').value = horaInicio;
  document.getElementById('evHoraFim').value = horaFim;
  document.getElementById('evVisitado').value = 'PSAAC';
  document.getElementById('evPoliciamento').value = 'NA';
  document.getElementById('evEstado').value = 'Planeado';
  document.getElementById('evNotificado').value = 'NA';
  document.getElementById('evMetaInfo').textContent = '';
  document.getElementById('btnApagarEvento').classList.add('hidden');
  document.getElementById('modalEvento').classList.remove('hidden');
}

function abrirModalEditarEvento(ev) {
  document.getElementById('modalEventoTitulo').textContent = '✏️ Editar Evento';
  document.getElementById('evId').value = ev.id || '';
  document.getElementById('evTipo').value = ev.tipo || '';
  document.getElementById('evEscalao').value = ev.escalao || '';
  document.getElementById('evEstado').value = ev.estado || 'Planeado';
  document.getElementById('evData').value = ev.data || '';
  document.getElementById('evHoraInicio').value = ev.horaInicio || '';
  document.getElementById('evHoraFim').value = ev.horaFim || '';
  document.getElementById('evLocal').value = ev.local || '';
  document.getElementById('evCompeticao').value = ev.competicao || '';
  document.getElementById('evJornada').value = ev.jornada || '';
  document.getElementById('evCodigoJogo').value = ev.codigoJogo || '';
  document.getElementById('evVisitado').value = ev.visitado || '';
  document.getElementById('evVisitante').value = ev.visitante || '';
  document.getElementById('evPoliciamento').value = ev.policiamento || 'NA';
  document.getElementById('evNotificado').value = ev.notificado || 'NA';
  document.getElementById('evEmailPedido').value = ev.emailPedido || '';
  document.getElementById('evEmailConfirmacao').value = ev.emailConfirmacao || '';
  document.getElementById('evObservacao').value = ev.observacao || '';
  document.getElementById('evMetaInfo').textContent = ev.ultimaModificacao ? `Última modificação: ${ev.ultimaModificacao}` : '';

  document.getElementById('btnApagarEvento').classList.remove('hidden');
  document.getElementById('modalEvento').classList.remove('hidden');
}

document.getElementById('formEvento').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btnGuardarEvento');
  btn.disabled = true;
  btn.textContent = 'A guardar...';

  const evObj = {
    id: document.getElementById('evId').value,
    tipo: document.getElementById('evTipo').value,
    escalao: document.getElementById('evEscalao').value,
    estado: document.getElementById('evEstado').value,
    data: document.getElementById('evData').value,
    horaInicio: document.getElementById('evHoraInicio').value,
    horaFim: document.getElementById('evHoraFim').value,
    local: document.getElementById('evLocal').value,
    competicao: document.getElementById('evCompeticao').value,
    jornada: document.getElementById('evJornada').value,
    codigoJogo: document.getElementById('evCodigoJogo').value,
    visitado: document.getElementById('evVisitado').value,
    visitante: document.getElementById('evVisitante').value,
    policiamento: document.getElementById('evPoliciamento').value,
    notificado: document.getElementById('evNotificado').value,
    emailPedido: document.getElementById('evEmailPedido').value,
    emailConfirmacao: document.getElementById('evEmailConfirmacao').value,
    observacao: document.getElementById('evObservacao').value
  };

  const resp = await apiRequest({ action: 'saveEvent', event: evObj });
  btn.disabled = false;
  btn.textContent = 'Guardar Alterações';

  if (resp.status === 'success') {
    const idx = allEvents.findIndex(item => item.id === resp.event.id);
    if (idx !== -1) allEvents[idx] = resp.event;
    else allEvents.push(resp.event);

    aplicarFiltrosCalendario();
    fecharModal('modalEvento');
    mostrarToast('Evento guardado com sucesso!');
  } else {
    alert('Erro ao guardar: ' + resp.message);
  }
});

async function confirmarApagarEvento() {
  const id = document.getElementById('evId').value;
  if (!id || !confirm('Tens a certeza que queres apagar este evento do Google Sheets?')) return;

  mostrarToast('A apagar evento...');
  const resp = await apiRequest({ action: 'deleteEvent', id: id });
  if (resp.status === 'success') {
    allEvents = allEvents.filter(item => item.id !== id);
    aplicarFiltrosCalendario();
    fecharModal('modalEvento');
    mostrarToast('Evento apagado.');
  } else {
    alert('Erro ao apagar: ' + resp.message);
  }
}

// ================= MODAL RECORRÊNCIA =================
function abrirModalRecorrencia() {
  const hoje = new Date();
  const fim = new Date();
  fim.setDate(hoje.getDate() + 28);
  document.getElementById('recDataInicio').value = formatarDataLocal(hoje);
  document.getElementById('recDataFim').value = formatarDataLocal(fim);
  atualizarPrevisaoRecorrencia();
  document.getElementById('modalRecorrencia').classList.remove('hidden');
}

function toggleDiaRec(btn) {
  btn.classList.toggle('active');
  atualizarPrevisaoRecorrencia();
}

function atualizarPrevisaoRecorrencia() {
  const iniStr = document.getElementById('recDataInicio').value;
  const fimStr = document.getElementById('recDataFim').value;
  const dias = Array.from(document.querySelectorAll('.dia-pill.active')).map(b => Number(b.dataset.dia));
  const escaloes = Array.from(document.querySelectorAll('#recEscaloesBox input:checked')).map(c => c.value);
  const separado = document.getElementById('recModo').value === 'separados';
  const box = document.getElementById('recResumo');

  if (!iniStr || !fimStr || dias.length === 0 || escaloes.length === 0) {
    box.textContent = 'Selecione escalão(ões), datas e dias da semana.';
    return;
  }

  let cur = new Date(iniStr + 'T00:00:00');
  const end = new Date(fimStr + 'T00:00:00');
  let count = 0;
  while (cur <= end) {
    if (dias.includes(cur.getDay())) count++;
    cur.setDate(cur.getDate() + 1);
  }
  const total = separado ? count * escaloes.length : count;
  box.textContent = `Serão criados ${total} registos de treino na folha.`;
}

document.getElementById('formRecorrencia').addEventListener('submit', async (e) => {
  e.preventDefault();
  const escaloes = Array.from(document.querySelectorAll('#recEscaloesBox input:checked')).map(c => c.value);
  const diasSemana = Array.from(document.querySelectorAll('.dia-pill.active')).map(b => b.dataset.dia);

  if (escaloes.length === 0 || diasSemana.length === 0) {
    alert('Selecione pelo menos um escalão e um dia da semana.');
    return;
  }

  const btn = document.getElementById('btnGerarRec');
  btn.disabled = true;
  btn.textContent = 'A gerar em lote...';

  const config = {
    escaloes,
    modoSeparado: document.getElementById('recModo').value === 'separados',
    tipo: document.getElementById('recTipo').value,
    local: document.getElementById('recLocal').value,
    horaInicio: document.getElementById('recHoraInicio').value,
    horaFim: document.getElementById('recHoraFim').value,
    diasSemana,
    dataInicio: document.getElementById('recDataInicio').value,
    dataFim: document.getElementById('recDataFim').value,
    observacao: document.getElementById('recObs').value
  };

  const resp = await apiRequest({ action: 'generateRecurring', config });
  btn.disabled = false;
  btn.textContent = 'Gerar em Lote';

  if (resp.status === 'success') {
    fecharModal('modalRecorrencia');
    mostrarToast(`${resp.result.total} treinos criados! A atualizar calendário...`);
    await carregarDados();
  } else {
    alert(resp.result?.mensagem || resp.message);
  }
});

// ================= MODAL EXPORTAÇÃO =================
function abrirModalExportar() {
  const hoje = new Date();
  const diasAteSab = (6 - hoje.getDay() + 7) % 7;
  const sab = new Date(hoje);
  sab.setDate(hoje.getDate() + diasAteSab);
  const dom = new Date(sab);
  dom.setDate(sab.getDate() + 1);

  document.getElementById('expDataInicio').value = formatarDataLocal(sab);
  document.getElementById('expDataFim').value = formatarDataLocal(dom);
  document.getElementById('expResultado').value = '';
  document.getElementById('btnCopiarExport').classList.add('hidden');
  document.getElementById('modalExportar').classList.remove('hidden');
}

function mudarTabExport(mode, btnEl) {
  currentExportMode = mode;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');

  const formatoSel = document.getElementById('expFormato');
  const mandoGrp = document.getElementById('expMandoGroup');
  document.getElementById('btnCopiarExport').classList.add('hidden');
  document.getElementById('expResultado').value = '';

  if (mode === 'FDS') {
    mandoGrp.style.display = 'none';
    document.getElementById('expTitulo').value = '📢 AGENDA DO FIM DE SEMANA ⚽';
    formatoSel.innerHTML = `
      <option value="WHATSAPP">💬 Mensagem WhatsApp</option>
      <option value="1080x1350">🎨 Prompt Gráfico (1080x1350)</option>
      <option value="A4">📄 Prompt Gráfico (A4)</option>
    `;
  } else {
    mandoGrp.style.display = 'block';
    document.getElementById('expTitulo').value = 'Agenda de Jogos e Treinos';
    formatoSel.innerHTML = `
      <option value="WHATSAPP">💬 Mensagem WhatsApp (4 Semanas)</option>
      <option value="PDF">📄 Descarregar PDF A4</option>
    `;
    const hoje = new Date();
    const fim = new Date();
    fim.setDate(hoje.getDate() + 27);
    document.getElementById('expDataInicio').value = formatarDataLocal(hoje);
    document.getElementById('expDataFim').value = formatarDataLocal(fim);
  }
}

async function executarExportacao() {
  const btn = document.getElementById('btnExecutarExport');
  btn.disabled = true;
  btn.textContent = 'A gerar...';

  const config = {
    titulo: document.getElementById('expTitulo').value,
    dataInicio: document.getElementById('expDataInicio').value,
    dataFim: document.getElementById('expDataFim').value,
    escaloes: Array.from(document.querySelectorAll('#expEscaloesBox input:checked')).map(c => c.value),
    tipos: Array.from(document.querySelectorAll('#expTiposBox input:checked')).map(c => c.value)
  };

  if (currentExportMode === 'FDS') {
    config.tipoSaida = document.getElementById('expFormato').value;
    const resp = await apiRequest({ action: 'exportWeekend', config });
    btn.disabled = false;
    btn.textContent = '⚡ Gerar Conteúdo';

    if (resp.status === 'success') {
      document.getElementById('expResultado').value = resp.texto;
      document.getElementById('btnCopiarExport').classList.remove('hidden');
    } else {
      alert(resp.message);
    }
  } else {
    config.tipoExportacao = document.getElementById('expFormato').value;
    config.filtroVisitado = document.getElementById('expMando').value;
    const resp = await apiRequest({ action: 'export4Weeks', config });
    btn.disabled = false;
    btn.textContent = '⚡ Gerar Conteúdo';

    if (resp.status === 'success') {
      if (resp.result.tipo === 'WHATSAPP') {
        document.getElementById('expResultado').value = resp.result.conteudo;
        document.getElementById('btnCopiarExport').classList.remove('hidden');
      } else if (resp.result.tipo === 'PDF') {
        descarregarPdfBase64(resp.result.base64, resp.result.nomeFicheiro);
        document.getElementById('expResultado').value = `✔ PDF "${resp.result.nomeFicheiro}" descarregado com sucesso!`;
      }
    } else {
      alert(resp.result?.mensagem || resp.message);
    }
  }
}

function copiarExportacao() {
  const txt = document.getElementById('expResultado').value;
  navigator.clipboard.writeText(txt).then(() => mostrarToast('Texto copiado para a área de transferência!'));
}

function descarregarPdfBase64(base64, fileName) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
}

// ================= UTILITÁRIOS UI =================
function fecharModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function mostrarToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}