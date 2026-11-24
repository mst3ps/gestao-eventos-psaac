const API_URL = 'https://script.google.com/macros/s/AKfycbx1TPhqlrdP9oy_U3DMkATqExfwEXfdP_ane6o2_EvFkp7dc5jI6HJFRKbnYq_Ty-gC/exec';

let idToken = sessionStorage.getItem('psaac_id_token') || null;
let allEvents = [];
let dbLists = {};
let colorRules = { escaloes: {}, tipos: {} };
let calendar = null;
let currentExportMode = 'FDS';

let selectedEscaloes = [];
let selectedTipos = [];

const TAG_COLORS = [
  { bg: '#fef08a', text: '#854d0e' },
  { bg: '#bbf7d0', text: '#166534' },
  { bg: '#bfdbfe', text: '#1e40af' },
  { bg: '#fecaca', text: '#991b1b' },
  { bg: '#e9d5ff', text: '#6b21a8' },
  { bg: '#fed7aa', text: '#9a3412' },
  { bg: '#fbcfe8', text: '#9d174d' },
  { bg: '#99f6e4', text: '#115e59' }
];

function obterEstiloTag(texto) {
  const regra = colorRules.escaloes?.[texto];
  if (regra && regra.tag) {
    return { bg: regra.tag, text: calcularCorTextoContraste(regra.tag) };
  }
  if (texto === 'Direção') return { bg: '#f3e8ff', text: '#6b21a8' };
  if (texto === 'Outros Assuntos') return { bg: '#ffedd5', text: '#9a3412' };
  if (!texto) return { bg: '#f1f5f9', text: '#334155' };

  let hash = 0;
  for (let i = 0; i < texto.length; i++) hash = texto.charCodeAt(i) + ((hash << 5) - hash);
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

function calcularCorTextoContraste(hex) {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminancia > 0.62 ? '#1e293b' : '#ffffff';
}

// ================= INICIALIZAÇÃO & LOGIN =================
window.addEventListener('DOMContentLoaded', () => {
  if (idToken) iniciarSessaoApp();

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.multi-dropdown')) {
      document.querySelectorAll('.multi-menu').forEach(m => m.classList.add('hidden'));
      document.querySelectorAll('.multi-dropdown').forEach(d => d.classList.remove('open'));
    }
  });
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
    colorRules = data.colorRules || { escaloes: {}, tipos: {} };

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
    colorRules = data.colorRules || { escaloes: {}, tipos: {} };
    aplicarFiltrosCalendario();
    mostrarToast('Dados atualizados!');
  } else {
    mostrarToast('Erro: ' + data.message);
  }
}

// ================= LISTAS & MULTI-FILTROS =================
function preencherListasInterface() {
  const tipos = dbLists['Tipo de Evento'] || [];
  const escaloesBase = dbLists['Escalões'] || [];
  const escaloesCompletos = [...escaloesBase, 'Direção', 'Outros Assuntos'];

  popularSelect('evTipo', tipos);
  popularSelect('evPoliciamento', dbLists['Pedido Policiamento'] || ['NA', 'Sim', 'Não'], 'NA');
  popularSelect('evEstado', dbLists['Estado de Evento'] || ['Planeado', 'Confirmado', 'Adiado', 'Cancelado'], 'Planeado');
  popularSelect('evNotificado', dbLists['Notificado'] || ['NA', 'Sim', 'Não'], 'NA');

  popularDataList('dlEscaloes', escaloesBase);
  popularDataList('dlLocais', dbLists['Local'] || []);
  popularDataList('dlCompeticoes', dbLists['Competição'] || []);
  popularDataList('dlEmailPedido', dbLists['Email Pedido'] || []);
  popularDataList('dlEmailConfirmacao', dbLists['Email Confirmação'] || []);

  construirMultiSelect('menuFiltroEscaloes', escaloesCompletos, 'ESCALAO');
  construirMultiSelect('menuFiltroTipos', tipos, 'TIPO');

  renderizarChips('recEscaloesChips', escaloesBase, false, atualizarPrevisaoRec);
  renderizarChips('expEscaloesBox', escaloesBase, true);
  renderizarChips('expTiposBox', tipos, true);
}

function toggleDropdown(ddId) {
  const dd = document.getElementById(ddId);
  const menu = dd.querySelector('.multi-menu');
  const isHidden = menu.classList.contains('hidden');

  document.querySelectorAll('.multi-menu').forEach(m => m.classList.add('hidden'));
  document.querySelectorAll('.multi-dropdown').forEach(d => d.classList.remove('open'));

  if (isHidden) {
    menu.classList.remove('hidden');
    dd.classList.add('open');
  }
}

function construirMultiSelect(menuId, items, filterType) {
  const menu = document.getElementById(menuId);
  menu.innerHTML = `
    <div class="multi-menu-actions">
      <button type="button" class="btn-mini" onclick="limparMultiFiltro('${filterType}')">Mostrar Todos</button>
    </div>
  `;

  items.forEach(item => {
    const label = document.createElement('label');
    label.className = 'multi-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = item;
    cb.onchange = () => atualizarEstadoMultiFiltro(filterType);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(item));
    menu.appendChild(label);
  });
}

function limparMultiFiltro(filterType) {
  const menuId = filterType === 'ESCALAO' ? 'menuFiltroEscaloes' : 'menuFiltroTipos';
  document.querySelectorAll(`#${menuId} input[type="checkbox"]`).forEach(cb => cb.checked = false);
  atualizarEstadoMultiFiltro(filterType);
}

function atualizarEstadoMultiFiltro(filterType) {
  if (filterType === 'ESCALAO') {
    selectedEscaloes = Array.from(document.querySelectorAll('#menuFiltroEscaloes input:checked')).map(c => c.value);
    const lbl = document.getElementById('lblFiltroEscaloes');
    lbl.textContent = selectedEscaloes.length === 0 ? 'Todos os Escalões' : selectedEscaloes.join(', ');
  } else {
    selectedTipos = Array.from(document.querySelectorAll('#menuFiltroTipos input:checked')).map(c => c.value);
    const lbl = document.getElementById('lblFiltroTipos');
    lbl.textContent = selectedTipos.length === 0 ? 'Todos os Tipos' : selectedTipos.join(', ');
  }
  aplicarFiltrosCalendario();
}

function popularSelect(id, items, defaultVal = '') {
  const el = document.getElementById(id);
  el.innerHTML = '';
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
  if (boxId === 'recEscaloesChips') atualizarPrevisaoRec();
}

// ================= SELETOR DE CORES =================
function selecionarCor(btnEl) {
  document.querySelectorAll('#evColorPalette .color-swatch').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');
  document.getElementById('evCor').value = btnEl.dataset.color || '';
}

function aplicarCorNaPaleta(colorVal) {
  document.getElementById('evCor').value = colorVal || '';
  const swatches = document.querySelectorAll('#evColorPalette .color-swatch');
  let matched = false;
  swatches.forEach(b => {
    if ((b.dataset.color || '') === (colorVal || '')) {
      b.classList.add('active');
      matched = true;
    } else {
      b.classList.remove('active');
    }
  });
  if (!matched && swatches[0]) swatches[0].classList.add('active');
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
    events: mapearEventosFiltrados(),

    eventContent: (arg) => {
      const ev = arg.event.extendedProps.raw;
      const tagLabel = ev.escalao || ev.tipo;
      const tagStyle = obterEstiloTag(tagLabel);

      let mainTitle = '';
      if (ev.source === 'DESPORTO') {
        mainTitle = (ev.visitado && ev.visitante) ? `${ev.visitado} vs ${ev.visitante}` : (ev.observacao || ev.tipo);
      } else {
        mainTitle = ev.observacao || ev.tipo;
      }

      const container = document.createElement('div');
      container.className = 'fc-custom-card';
      container.innerHTML = `
        <div class="fc-card-top">
          <span class="fc-tag-badge" style="background:${tagStyle.bg}; color:${tagStyle.text};">${tagLabel}</span>
          <span class="fc-card-time">${arg.timeText}</span>
        </div>
        <div class="fc-card-title">${mainTitle}</div>
        ${ev.local ? `<div class="fc-card-loc">📍 ${ev.local}</div>` : ''}
      `;
      return { domNodes: [container] };
    },

    select: (info) => {
      const dataStr = info.startStr.slice(0, 10);
      const hIni = info.startStr.includes('T') ? info.startStr.slice(11, 16) : '19:00';
      const hFim = info.endStr.includes('T') ? info.endStr.slice(11, 16) : '20:30';
      abrirModalNovoEvento(dataStr, hIni, hFim);
      calendar.unselect();
    },

    eventClick: (info) => {
      abrirModalEditarEvento(info.event.extendedProps.raw);
    },

    eventDrop: async (info) => {
      await atualizarHorarioViaDrag(info);
    },

    eventResize: async (info) => {
      await atualizarHorarioViaDrag(info);
    }
  });

  calendar.render();
}

function obterCorCartao(ev) {
  // 1. Prioridade: Cor manual definida no cartão
  if (ev.cor) return ev.cor;

  // 2. Predefinição por Escalão / Categoria (ex: Direção, Outros Assuntos, Sub-15...)
  const regraEsc = colorRules.escaloes?.[ev.escalao];
  if (regraEsc && regraEsc.card) return regraEsc.card;

  // 3. Predefinição por Tipo de Evento
  const regraTipo = colorRules.tipos?.[ev.tipo];
  if (regraTipo && regraTipo.card) return regraTipo.card;

  // 4. Fallback padrão
  if (ev.source === 'DIRECAO') return '#8e24aa';
  if (ev.source === 'OUTROS') return '#e67c73';

  const estado = (ev.estado || '').toLowerCase();
  const tipo = (ev.tipo || '').toLowerCase();
  if (estado.includes('cancelado') || estado.includes('adiado')) return '#d50000';
  if (tipo.includes('jogo') || tipo.includes('torneio')) return '#0b8043';
  return '#1a73e8';
}

function mapearEventosFiltrados() {
  return allEvents
    .filter(ev => {
      if (!ev.data) return false;

      if (selectedEscaloes.length > 0) {
        const escEv = (ev.escalao || '').toLowerCase();
        const matchEsc = selectedEscaloes.some(sel => escEv.includes(sel.toLowerCase()));
        if (!matchEsc) return false;
      }

      if (selectedTipos.length > 0) {
        const tipoEv = (ev.tipo || '').toLowerCase();
        const matchTipo = selectedTipos.some(sel => tipoEv === sel.toLowerCase());
        if (!matchTipo) return false;
      }

      return true;
    })
    .map(ev => {
      const hIni = ev.horaInicio || '09:00';
      const hFim = ev.horaFim || somarUmaHora(hIni);
      const bg = obterCorCartao(ev);

      return {
        id: ev.id,
        title: ev.escalao,
        start: `${ev.data}T${hIni}:00`,
        end: `${ev.data}T${hFim}:00`,
        backgroundColor: bg,
        textColor: calcularCorTextoContraste(bg),
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
  if (!calendar) return;
  calendar.removeAllEvents();
  calendar.addEventSource(mapearEventosFiltrados());
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

// ================= MODAL UNIFICADO (+ NOVO EVENTO & EDITAR) =================
function mudarDestinoEvento(source) {
  document.getElementById('evSource').value = source;
  document.querySelectorAll('.source-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.src === source);
  });

  const isDesporto = source === 'DESPORTO';
  document.querySelectorAll('.field-desporto').forEach(el => el.classList.toggle('hidden', !isDesporto));
  document.getElementById('secDesporto').classList.toggle('hidden', !isDesporto);

  const escInput = document.getElementById('evEscalao');
  if (source === 'DIRECAO') {
    escInput.value = 'Direção';
    escInput.readOnly = true;
  } else if (source === 'OUTROS') {
    escInput.value = 'Outros Assuntos';
    escInput.readOnly = true;
  } else {
    if (escInput.value === 'Direção' || escInput.value === 'Outros Assuntos') escInput.value = '';
    escInput.readOnly = false;
  }

  atualizarPrevisaoRec();
}

function abrirModalNovoEvento(data = '', horaInicio = '19:00', horaFim = '20:30') {
  document.getElementById('modalEventoTitulo').textContent = '+ Novo Evento';
  document.getElementById('formEvento').reset();
  document.getElementById('evId').value = '';
  document.getElementById('sourceSelectorBox').classList.remove('hidden');
  mudarDestinoEvento('DESPORTO');

  const hojeStr = data || formatarDataLocal(new Date());
  document.getElementById('evData').value = hojeStr;
  document.getElementById('evHoraInicio').value = horaInicio;
  document.getElementById('evHoraFim').value = horaFim;
  document.getElementById('evVisitado').value = 'PSAAC';
  document.getElementById('evPoliciamento').value = 'NA';
  document.getElementById('evEstado').value = 'Planeado';
  document.getElementById('evNotificado').value = 'NA';
  aplicarCorNaPaleta('');

  document.getElementById('boxRecorrenciaIntegrada').classList.remove('hidden');
  document.getElementById('chkRepetirEvento').checked = false;
  document.getElementById('painelRecorrencia').classList.add('hidden');
  const daqui4Sem = new Date(hojeStr + 'T00:00:00');
  daqui4Sem.setDate(daqui4Sem.getDate() + 28);
  document.getElementById('recDataFim').value = formatarDataLocal(daqui4Sem);

  document.getElementById('evMetaInfo').textContent = '';
  document.getElementById('btnApagarEvento').classList.add('hidden');
  document.getElementById('modalEvento').classList.remove('hidden');
}

function abrirModalEditarEvento(ev) {
  document.getElementById('modalEventoTitulo').textContent = '✏️ Editar Evento';
  document.getElementById('formEvento').reset();
  document.getElementById('evId').value = ev.id || '';
  document.getElementById('sourceSelectorBox').classList.add('hidden');
  document.getElementById('boxRecorrenciaIntegrada').classList.add('hidden');

  const src = ev.source || 'DESPORTO';
  mudarDestinoEvento(src);

  document.getElementById('evTipo').value = ev.tipo || '';
  document.getElementById('evEscalao').value = ev.escalao || '';
  document.getElementById('evData').value = ev.data || '';
  document.getElementById('evHoraInicio').value = ev.horaInicio || '';
  document.getElementById('evHoraFim').value = ev.horaFim || '';
  document.getElementById('evLocal').value = ev.local || '';
  document.getElementById('evObservacao').value = ev.observacao || '';
  aplicarCorNaPaleta(ev.cor || '');

  if (src === 'DESPORTO') {
    document.getElementById('evEstado').value = ev.estado || 'Planeado';
    document.getElementById('evCompeticao').value = ev.competicao || '';
    document.getElementById('evJornada').value = ev.jornada || '';
    document.getElementById('evCodigoJogo').value = ev.codigoJogo || '';
    document.getElementById('evVisitado').value = ev.visitado || '';
    document.getElementById('evVisitante').value = ev.visitante || '';
    document.getElementById('evPoliciamento').value = ev.policiamento || 'NA';
    document.getElementById('evNotificado').value = ev.notificado || 'NA';
    document.getElementById('evEmailPedido').value = ev.emailPedido || '';
    document.getElementById('evEmailConfirmacao').value = ev.emailConfirmacao || '';
  }

  document.getElementById('evMetaInfo').textContent = ev.ultimaModificacao ? `Última modificação: ${ev.ultimaModificacao}` : '';
  document.getElementById('btnApagarEvento').classList.remove('hidden');
  document.getElementById('modalEvento').classList.remove('hidden');
}

// --- RECORRÊNCIA INTEGRADA ---
function togglePainelRecorrencia() {
  const checked = document.getElementById('chkRepetirEvento').checked;
  document.getElementById('painelRecorrencia').classList.toggle('hidden', !checked);
  if (checked) {
    const escAtual = document.getElementById('evEscalao').value.trim();
    if (escAtual) {
      document.querySelectorAll('#recEscaloesChips input').forEach(cb => {
        if (cb.value.toLowerCase() === escAtual.toLowerCase()) {
          cb.checked = true;
          cb.parentElement.classList.add('active');
        }
      });
    }
    atualizarPrevisaoRec();
  }
}

function toggleDiaRec(btn) {
  btn.classList.toggle('active');
  atualizarPrevisaoRec();
}

function atualizarPrevisaoRec() {
  if (!document.getElementById('chkRepetirEvento')?.checked) return;

  const iniStr = document.getElementById('evData').value;
  const fimStr = document.getElementById('recDataFim').value;
  const dias = Array.from(document.querySelectorAll('.dia-pill.active')).map(b => Number(b.dataset.dia));
  const box = document.getElementById('recResumo');

  if (!iniStr || !fimStr || dias.length === 0) {
    box.textContent = 'Defina a data de fim e os dias da semana.';
    return;
  }

  let cur = new Date(iniStr + 'T00:00:00');
  const end = new Date(fimStr + 'T00:00:00');
  let countDias = 0;
  while (cur <= end) {
    if (dias.includes(cur.getDay())) countDias++;
    cur.setDate(cur.getDate() + 1);
  }

  const isDesporto = document.getElementById('evSource').value === 'DESPORTO';
  const escaloes = Array.from(document.querySelectorAll('#recEscaloesChips input:checked')).map(c => c.value);
  const separado = document.getElementById('recModoEscaloes').value === 'separados';

  const total = (isDesporto && separado && escaloes.length > 0) ? countDias * escaloes.length : countDias;
  box.textContent = `Serão criados ${total} registos na folha correspondente.`;
}

document.getElementById('formEvento').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btnGuardarEvento');
  btn.disabled = true;
  btn.textContent = 'A guardar...';

  const src = document.getElementById('evSource').value;
  const evObj = {
    id: document.getElementById('evId').value,
    source: src,
    tipo: document.getElementById('evTipo').value,
    escalao: document.getElementById('evEscalao').value,
    data: document.getElementById('evData').value,
    horaInicio: document.getElementById('evHoraInicio').value,
    horaFim: document.getElementById('evHoraFim').value,
    local: document.getElementById('evLocal').value,
    cor: document.getElementById('evCor').value,
    observacao: document.getElementById('evObservacao').value
  };

  if (src === 'DESPORTO') {
    evObj.estado = document.getElementById('evEstado').value;
    evObj.competicao = document.getElementById('evCompeticao').value;
    evObj.jornada = document.getElementById('evJornada').value;
    evObj.codigoJogo = document.getElementById('evCodigoJogo').value;
    evObj.visitado = document.getElementById('evVisitado').value;
    evObj.visitante = document.getElementById('evVisitante').value;
    evObj.policiamento = document.getElementById('evPoliciamento').value;
    evObj.notificado = document.getElementById('evNotificado').value;
    evObj.emailPedido = document.getElementById('evEmailPedido').value;
    evObj.emailConfirmacao = document.getElementById('evEmailConfirmacao').value;
  }

  const isRecorrente = !evObj.id && document.getElementById('chkRepetirEvento').checked;

  if (isRecorrente) {
    const recurrence = {
      dataFim: document.getElementById('recDataFim').value,
      diasSemana: Array.from(document.querySelectorAll('.dia-pill.active')).map(b => b.dataset.dia),
      escaloes: Array.from(document.querySelectorAll('#recEscaloesChips input:checked')).map(c => c.value),
      modoSeparado: document.getElementById('recModoEscaloes').value === 'separados'
    };
    const resp = await apiRequest({ action: 'saveRecurringBatch', event: evObj, recurrence });
    btn.disabled = false;
    btn.textContent = 'Guardar Evento';

    if (resp.status === 'success') {
      fecharModal('modalEvento');
      mostrarToast(`${resp.result.total} eventos criados! A atualizar...`);
      await carregarDados();
    } else {
      alert(resp.result?.mensagem || resp.message);
    }
  } else {
    const resp = await apiRequest({ action: 'saveEvent', event: evObj });
    btn.disabled = false;
    btn.textContent = 'Guardar Evento';

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
  }
});

async function confirmarApagarEvento() {
  const id = document.getElementById('evId').value;
  const source = document.getElementById('evSource').value;
  if (!id || !confirm('Tens a certeza que queres apagar este registo do Google Sheets?')) return;

  mostrarToast('A apagar...');
  const resp = await apiRequest({ action: 'deleteEvent', id, source });
  if (resp.status === 'success') {
    allEvents = allEvents.filter(item => item.id !== id);
    aplicarFiltrosCalendario();
    fecharModal('modalEvento');
    mostrarToast('Registo apagado.');
  } else {
    alert('Erro ao apagar: ' + resp.message);
  }
}

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
  navigator.clipboard.writeText(txt).then(() => mostrarToast('Texto copiado!'));
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

// ================= MODAL DEFINIÇÕES (PREDEFINIÇÃO DE CORES) =================
function abrirModalDefinicoes() {
  const escaloes = [...(dbLists['Escalões'] || []), 'Direção', 'Outros Assuntos'];
  const tipos = dbLists['Tipo de Evento'] || [];

  const boxEsc = document.getElementById('listaCoresEscaloes');
  boxEsc.innerHTML = '';
  escaloes.forEach(nome => {
    const r = colorRules.escaloes?.[nome] || { card: '', tag: '' };
    const tagPadrao = obterEstiloTag(nome).bg;
    const row = document.createElement('div');
    row.className = 'color-rule-row';
    row.dataset.nome = nome;
    row.innerHTML = `
      <span>${nome}</span>
      <div class="color-input-wrap">
        <input type="color" class="inp-card-color" value="${r.card || '#1a73e8'}" data-active="${r.card ? '1' : '0'}" oninput="ativarCorLinha(this)">
        <span class="color-status-txt">${r.card ? 'Ativa' : 'Auto'}</span>
      </div>
      <div class="color-input-wrap">
        <input type="color" class="inp-tag-color" value="${r.tag || tagPadrao}" data-active="${r.tag ? '1' : '0'}" oninput="ativarCorLinha(this)">
        <span class="color-status-txt">${r.tag ? 'Ativa' : 'Auto'}</span>
      </div>
      <button type="button" class="btn-mini" onclick="limparCorLinha(this)">Auto</button>
    `;
    boxEsc.appendChild(row);
  });

  const boxTipos = document.getElementById('listaCoresTipos');
  boxTipos.innerHTML = '';
  tipos.forEach(nome => {
    const r = colorRules.tipos?.[nome] || { card: '' };
    const row = document.createElement('div');
    row.className = 'color-rule-row';
    row.dataset.nome = nome;
    row.innerHTML = `
      <span>${nome}</span>
      <div class="color-input-wrap">
        <input type="color" class="inp-tipo-color" value="${r.card || '#0b8043'}" data-active="${r.card ? '1' : '0'}" oninput="ativarCorLinha(this)">
        <span class="color-status-txt">${r.card ? 'Ativa' : 'Auto'}</span>
      </div>
      <span></span>
      <button type="button" class="btn-mini" onclick="limparCorLinha(this)">Auto</button>
    `;
    boxTipos.appendChild(row);
  });

  document.getElementById('modalDefinicoes').classList.remove('hidden');
}

function ativarCorLinha(inp) {
  inp.dataset.active = '1';
  inp.nextElementSibling.textContent = 'Ativa';
}

function limparCorLinha(btn) {
  const row = btn.closest('.color-rule-row');
  row.querySelectorAll('input[type="color"]').forEach(inp => {
    inp.dataset.active = '0';
    inp.nextElementSibling.textContent = 'Auto';
  });
}

function reporCoresPadrao() {
  document.querySelectorAll('#modalDefinicoes .color-rule-row').forEach(row => {
    row.querySelectorAll('input[type="color"]').forEach(inp => {
      inp.dataset.active = '0';
      inp.nextElementSibling.textContent = 'Auto';
    });
  });
}

async function guardarDefinicoesCores() {
  const btn = document.getElementById('btnGuardarCores');
  btn.disabled = true;
  btn.textContent = 'A guardar...';

  const novasRegras = { escaloes: {}, tipos: {} };

  document.querySelectorAll('#listaCoresEscaloes .color-rule-row').forEach(row => {
    const nome = row.dataset.nome;
    const inpCard = row.querySelector('.inp-card-color');
    const inpTag = row.querySelector('.inp-tag-color');
    const cardVal = inpCard.dataset.active === '1' ? inpCard.value : '';
    const tagVal = inpTag.dataset.active === '1' ? inpTag.value : '';
    if (cardVal || tagVal) {
      novasRegras.escaloes[nome] = { card: cardVal, tag: tagVal };
    }
  });

  document.querySelectorAll('#listaCoresTipos .color-rule-row').forEach(row => {
    const nome = row.dataset.nome;
    const inpCard = row.querySelector('.inp-tipo-color');
    const cardVal = inpCard.dataset.active === '1' ? inpCard.value : '';
    if (cardVal) {
      novasRegras.tipos[nome] = { card: cardVal };
    }
  });

  const resp = await apiRequest({ action: 'saveColorRules', rules: novasRegras });
  btn.disabled = false;
  btn.textContent = 'Guardar Predefinições';

  if (resp.status === 'success') {
    colorRules = novasRegras;
    aplicarFiltrosCalendario();
    fecharModal('modalDefinicoes');
    mostrarToast('Predefinições de cores guardadas!');
  } else {
    alert('Erro ao guardar cores: ' + resp.message);
  }
}

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