/* ===========================
   AZM – Workspace 4 (UI-W4)
   Lead-gated calculator UI
   =========================== */

/** ======= CONFIG (baked-in defaults; dev panel can override at runtime) ======= **/
const WS2_PRICE = 'https://script.google.com/macros/s/AKfycbzM2epYNmWxxIP5Sp4Fnl1iz4tCcSf_lCVGb0Hm-0pQBaST8mb8EsQ-jVC6_5WIXZon/exec?action=price';
let   WS3_BASE  = 'https://script.google.com/macros/s/AKfycbxBP3K11wYn-r6_98B3qsJUMI8yj8bKRX8gLFarQ_f5WEvEMSfXHQ9neg4RQJhTlnKv/exec'; // provided
const WS3_UPSERT = () => `${WS3_BASE}?action=upsertLead`;
const WS3_SAVE   = () => `${WS3_BASE}?action=saveQuote`;

/** Debounce interval for auto-pricing */
const REPRICE_DEBOUNCE_MS = 350;

/** Initial ZIP gating value */
const INITIAL_ZIP = '85254';

/** LocalStorage keys */
const LS_TOKEN = 'azm_leadToken';
const LS_EMAIL = 'azm_leadEmail';
const LS_WS3   = 'azm_ws3_base';
const LS_TAX   = 'azm_tax_table';
const LS_HOI   = 'azm_hoi_table';
const LS_DEV   = 'azm_devMode';

/** ======= STATE TAX / HOI TABLES (2023 / 2022) =======
 *  You can override these at runtime from Dev Config panel.
 */
let STATE_TAX_RATE_2023_PCT = {
  AL:0.375, AK:0.875, AZ:0.500, AR:0.500, CA:0.750, CO:0.500, CT:1.500, DE:0.500,
  FL:0.750, GA:0.750, HI:0.375, ID:0.500, IL:1.875, IN:0.750, IA:1.250, KS:1.250,
  KY:0.750, LA:0.500, ME:1.000, MD:0.875, MA:1.000, MI:1.125, MN:1.000, MS:0.625,
  MO:0.875, MT:0.625, NE:1.375, NV:0.500, NH:1.375, NJ:1.750, NM:0.625, NY:1.250,
  NC:0.625, ND:1.000, OH:1.250, OK:0.750, OR:0.750, PA:1.250, RI:1.000, SC:0.500,
  SD:1.000, TN:0.500, TX:1.375, UT:0.500, VT:1.375, VA:0.750, WA:0.750, WV:0.500,
  WI:1.250, WY:0.500, DC:0.625
};

let HOI_2022 = {
  "Alabama":1748,"Alaska":1129,"Arizona":1018,"Arkansas":1740,"California":1492,"Colorado":2079,
  "Connecticut":1814,"Delaware":1103,"District of Columbia":1384,"Florida":2677,"Georgia":1655,
  "Hawaii":1431,"Idaho":1002,"Illinois":1343,"Indiana":1191,"Iowa":1268,"Kansas":1583,"Kentucky":1359,
  "Louisiana":2603,"Maine":1077,"Maryland":1392,"Massachusetts":1871,"Michigan":1056,"Minnesota":1774,
  "Mississippi":1907,"Missouri":1668,"Montana":1639,"Nebraska":1869,"Nevada":948,"New Hampshire":1188,
  "New Jersey":1417,"New Mexico":1322,"New York":1628,"North Carolina":1621,"North Dakota":1325,"Ohio":995,
  "Oklahoma":2268,"Oregon":893,"Pennsylvania":1120,"Rhode Island":2074,"South Carolina":1571,
  "South Dakota":1756,"Tennessee":1492,"Texas":2397,"Utah":937,"Vermont":1109,"Virginia":1332,
  "Washington":1151,"West Virginia":1113,"Wisconsin":957,"Wyoming":1596
};

const HOI_BASE_COVERAGE = 300000;

// Preserve baked-in copies for "Reset Overrides"
const _DEFAULT_TAX_TABLE = JSON.parse(JSON.stringify(STATE_TAX_RATE_2023_PCT));
const _DEFAULT_HOI_TABLE = JSON.parse(JSON.stringify(HOI_2022));
const _DEFAULT_WS3       = WS3_BASE;

/** ======= UTILITIES ======= **/
const $ = (sel) => document.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function formatCurrency(num) {
  if (!isFinite(num)) return '$0';
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function parseCurrency(str) {
  if (!str) return 0;
  return Number(String(str).replace(/[^\d.-]/g, '')) || 0;
}
function formatPercent(num) {
  if (!isFinite(num)) return '0%';
  return `${(Math.round(num * 100) / 100).toString()}%`;
}
function parsePercent(str) {
  if (!str) return 0;
  let v = String(str).replace(/[^\d.-]/g, '');
  return Number(v) || 0;
}
function roundToNearest(value, step) {
  return Math.round(value / step) * step;
}
function mmdd_hhmm(date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
function normalizeZip(zip){
  const digits = String(zip || "").replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : "";
}

/** ======= STATE ======= **/
const state = {
  gated: false,
  leadToken: localStorage.getItem(LS_TOKEN) || null,
  leadEmail: localStorage.getItem(LS_EMAIL) || null,
  devMode: false,
  taxAuto: true,
  insAuto: true,
  inputs: {
    program: 'CONV30',
    txn: 'PURCHASE',
    term: 360,
    propZip: INITIAL_ZIP,
    city: '',
    stateAbbr: '',
    stateName: '',
    value: 500000,
    ltv: 80,
    loan: 400000,
    fico: 740,
    borrowerPts: 0.0,
    taxes: 0,
    ins: 0,
    hoa: 0,
    pmiToggle: true,
    dtiOver45: false,
    twoPlusBorrowers: false,
    financeUfmip: true,
    annualMip: 0.55,
    vaExempt: false,
    vaFirstUse: true,
    dscrRatio: 1.25
  },
  lastQuote: null,
  lastQuotedAt: null,
  zipIsValidNew: false
};

/** ======= ELEMENTS ======= **/
const el = {
  lastQuoted: $('#lastQuoted'),
  statusTop: $('#statusTop'),
  statusBottom: $('#statusBottom'),

  // Dev
  devConfig: $('#devConfig'),
  devModeGroup: $('#devModeGroup'),
  ws3BaseInput: $('#ws3BaseInput'),
  tablesJson: $('#tablesJson'),
  applyConfigBtn: $('#applyConfigBtn'),
  resetConfigBtn: $('#resetConfigBtn'),
  devStatus: $('#devStatus'),

  program: $('#program'),
  txnGroup: $('#txnGroup'),
  termGroup: $('#termGroup'),

  propZip: $('#propZip'),
  cityState: $('#cityState'),
  gateBtn: $('#gateBtn'),
  zipMsg: $('#zipMsg'),

  propValue: $('#propValue'),
  ltvPct: $('#ltvPct'),
  loanAmt: $('#loanAmt'),

  fico: $('#fico'),
  ficoNum: $('#ficoNum'),
  points: $('#points'),
  pointsNum: $('#pointsNum'),

  pmiToggle: $('#pmiToggle'),
  dti45: $('#dti45'),
  twoBorrowers: $('#twoBorrowers'),

  taxes: $('#taxes'),
  ins: $('#ins'),
  hoa: $('#hoa'),
  taxAutoChip: $('#taxAutoChip'),
  insAutoChip: $('#insAutoChip'),

  panelFHA: $('#panelFHA'),
  financeUfmip: $('#financeUfmip'),
  annualMip: $('#annualMip'),

  panelVA: $('#panelVA'),
  vaExempt: $('#vaExempt'),
  vaFirstUse: $('#vaFirstUse'),

  panelDSCR: $('#panelDSCR'),
  dscrRatio: $('#dscrRatio'),

  results: $('#results'),
  saveQuoteBtn: $('#saveQuoteBtn'),

  leadModal: $('#leadModal'),
  leadForm: $('#leadForm'),
  statusLead: $('#statusLead'),
  cancelLead: $('#cancelLead'),
  textUpdates: $('#textUpdates'),

  email: $('#email'),
};

/** ======= ZIP → City/State + Estimation ======= **/
const zipCache = new Map();

async function resolveZip(zip) {
  const z = normalizeZip(zip);
  if (!z) return null;
  if (zipCache.has(z)) return zipCache.get(z);

  try {
    const resp = await fetch(`https://api.zippopotam.us/us/${z}`, { cache: 'no-store' });
    if (!resp.ok) return null;
    const data = await resp.json();
    const place = data?.places?.[0];
    const abbr = place?.['state abbreviation'] || null;
    const state = place?.['state'] || null;
    const city = place?.['place name'] || '';
    if (!abbr || !state) return null;
    const info = { abbr, state, city };
    zipCache.set(z, info);
    return info;
  } catch {
    return null;
  }
}

function estimateAnnualTaxes(value, ratePct){
  const v = Number(value), r = Number(ratePct);
  if (!isFinite(v) || v <= 0 || !isFinite(r) || r <= 0) return 0;
  return v * (r / 100);
}

function computeDefaultHOI(value, stateName){
  const v = Number(value);
  if (!isFinite(v) || v <= 0) return 0;
  const base = HOI_2022[stateName] ?? HOI_2022['Arizona'] ?? 0;
  if (!base) return 0;
  const scaled = base * (v / HOI_BASE_COVERAGE);
  return roundToNearest(scaled, 25);
}

function setZipMsg(type, text){
  if (!el.zipMsg) return;
  if (!text){
    el.zipMsg.style.display = 'none';
    el.zipMsg.textContent = '';
    el.zipMsg.className = 'msg';
    return;
  }
  el.zipMsg.className = 'msg ' + (type === 'warn' ? 'bad' : 'ok');
  el.zipMsg.textContent = text;
  el.zipMsg.style.display = 'block';
}

async function onZipChanged() {
  const zipRaw = el.propZip.value;
  const zip = normalizeZip(zipRaw);
  if (zipRaw !== zip) el.propZip.value = zip; // normalize UI
  const isFive = /^\d{5}$/.test(zip);
  const isChanged = zip !== INITIAL_ZIP;
  state.zipIsValidNew = isFive && isChanged;

  state.inputs.propZip = zip;
  el.propZip.classList.toggle('needs-update', !state.zipIsValidNew);
  el.gateBtn.disabled = !state.zipIsValidNew;

  if (!zip) {
    state.inputs.city = '';
    state.inputs.stateAbbr = 'AZ';
    state.inputs.stateName = 'Arizona';
    el.cityState.textContent = '—';
    setZipMsg('', '');
    applyTaxDefault();
    applyInsDefault();
    return;
  }

  const info = await resolveZip(zip);
  if (!info){
    setZipMsg('warn', 'Could not find Property Zip. Try another ZIP.');
    el.cityState.textContent = '—';
    return;
  }

  state.inputs.city = info.city || '';
  state.inputs.stateAbbr = info.abbr;
  state.inputs.stateName = info.state || '';
  el.cityState.textContent = `${state.inputs.city ? state.inputs.city + ', ' : ''}${state.inputs.stateName}`;
  setZipMsg('ok', el.cityState.textContent);

  applyTaxDefault();
  applyInsDefault();
}

/** ======= Loan Sync (Value/LTV/Loan) ======= **/
function syncFromValue() {
  const value = parseCurrency(el.propValue.value);
  state.inputs.value = value;
  const loan = Math.round(value * (state.inputs.ltv / 100));
  state.inputs.loan = loan;
  el.loanAmt.value = formatCurrency(loan);

  applyTaxDefault();
  applyInsDefault();

  scheduleReprice();
}

function syncFromLtv() {
  const ltv = parsePercent(el.ltvPct.value);
  state.inputs.ltv = ltv;
  const loan = Math.round(state.inputs.value * (ltv / 100));
  state.inputs.loan = loan;
  el.loanAmt.value = formatCurrency(loan);
  scheduleReprice();
}

function syncFromLoan() {
  const loan = parseCurrency(el.loanAmt.value);
  state.inputs.loan = loan;
  const ltv = state.inputs.value > 0 ? (loan / state.inputs.value) * 100 : 0;
  state.inputs.ltv = Math.max(0, Math.min(100, ltv));
  el.ltvPct.value = formatPercent(state.inputs.ltv);
  scheduleReprice();
}

/** ======= Program Panel Visibility ======= **/
function updateProgramPanels() {
  const p = state.inputs.program;
  el.panelFHA.hidden = !(p.startsWith('FHA'));
  el.panelVA.hidden = !(p.startsWith('VA'));
  el.panelDSCR.hidden = !(p.startsWith('DSCR'));
}

/** ======= Lead Gate Modal ======= **/
function openLeadModal() {
  el.leadModal.classList.remove('hidden');
  el.leadModal.setAttribute('aria-hidden', 'false');
}
function closeLeadModal() {
  el.leadModal.classList.add('hidden');
  el.leadModal.setAttribute('aria-hidden', 'true');
}

async function handleLeadSubmit(evt) {
  evt.preventDefault();
  el.statusLead.textContent = '';

  if (!WS3_BASE) {
    el.statusLead.textContent = 'Configure WS‑3 base URL to enable upsertLead.';
    return;
  }

  const payload = {
    firstName: $('#firstName').value.trim(),
    lastName: $('#lastName').value.trim(),
    phone: $('#phone').value.trim(),
    email: $('#email').value.trim(),
    timeline: $('#timeline').value,
    textUpdates: activeBool(el.textUpdates),
    source: 'UI-W4'
  };

  try {
    const resp = await fetch(WS3_UPSERT(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ payload })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok || !data.leadToken) {
      throw new Error(JSON.stringify(data || { error: 'upsertLead failed' }));
    }
    // Persist
    state.leadToken = data.leadToken;
    localStorage.setItem(LS_TOKEN, state.leadToken);
    localStorage.setItem(LS_EMAIL, payload.email);
    state.gated = true;

    closeLeadModal();
    el.statusTop.textContent = 'Lead captured. Fetching your pricing…';
    await priceNow(); // immediate first price
  } catch (err) {
    el.statusLead.textContent = `Lead error: ${err.message || err}`;
  }
}

/** ======= Helpers for pill groups ======= **/
function wirePillGroup(container, onChange) {
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    $$('.pill', container).forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    onChange(btn.dataset.value);
  });
}
function activeValue(container) {
  const btn = container.querySelector('.pill.active');
  return btn ? btn.dataset.value : undefined;
}
function activeBool(container) {
  return activeValue(container) === 'true';
}

/** ======= Pricing ======= **/
const scheduleReprice = debounce(() => {
  if (!state.gated) return; // only after lead captured
  priceNow();
}, REPRICE_DEBOUNCE_MS);

function buildInputsPayload() {
  const i = state.inputs;
  return {
    program: i.program,
    txn: i.txn,
    term: Number(i.term),
    loan: Math.round(i.loan),
    ltv: Math.round(i.ltv * 100) / 100,
    fico: Number(i.fico),
    borrowerPts: Number(i.borrowerPts),
    taxes: Math.round(i.taxes),
    ins: Math.round(i.ins),
    hoa: Math.round(i.hoa),
    pmiToggle: Boolean(i.pmiToggle),
    dtiOver45: Boolean(i.dtiOver45),
    twoPlusBorrowers: Boolean(i.twoPlusBorrowers),
    financeUfmip: Boolean(i.financeUfmip),
    annualMip: Number(i.annualMip),
    vaExempt: Boolean(i.vaExempt),
    vaFirstUse: Boolean(i.vaFirstUse),
    dscrRatio: Number(i.dscrRatio)
  };
}

async function priceNow() {
  el.statusTop.textContent = 'Pricing…';
  el.statusBottom.textContent = '';
  el.saveQuoteBtn.disabled = true;

  const payload = {
    inputs: buildInputsPayload(),
    leadToken: state.leadToken || ''
  };

  try {
    const resp = await fetch(WS2_PRICE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ payload })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(`Pricing HTTP ${resp.status}`);
    // Accept any shape; snapshot for saveQuote
    state.lastQuote = data;
    state.lastQuotedAt = new Date();
    el.lastQuoted.textContent = `Last quoted: ${mmdd_hhmm(state.lastQuotedAt)}`;
    renderResults(data);
    el.saveQuoteBtn.disabled = !state.leadToken || !WS3_BASE;
    el.statusTop.textContent = 'Pricing complete.';
  } catch (err) {
    el.statusTop.textContent = `Pricing error: ${err.message || err}`;
    renderResults({ error: err.message || String(err) });
  }
}

/** ======= Save Quote ======= **/
async function saveQuote() {
  el.statusBottom.textContent = '';
  if (!WS3_BASE) {
    el.statusBottom.textContent = 'Configure WS‑3 base URL to enable saveQuote.';
    return;
  }
  if (!state.leadToken) {
    el.statusBottom.textContent = 'Missing leadToken; please complete the gate.';
    return;
  }
  const payload = {
    leadToken: state.leadToken,
    inputs: buildInputsPayload(),
    quote: state.lastQuote || {},
    savedAt: mmdd_hhmm(new Date()),
    source: 'UI-W4',
    subjectZip: /^\d{5}$/.test(state.inputs.propZip) ? state.inputs.propZip : undefined
  };

  try {
    const resp = await fetch(WS3_SAVE(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ payload })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok !== true) {
      throw new Error(data && (data.message || data.error) || `HTTP ${resp.status}`);
    }
    el.statusBottom.textContent = 'Quote saved successfully.';
  } catch (err) {
    el.statusBottom.textContent = `saveQuote error: ${err.message || err}`;
  }
}

/** ======= Results Renderer (robust to unknown shapes) ======= **/
function renderResults(data) {
  const c = el.results;
  c.innerHTML = '';
  if (!data || typeof data !== 'object') {
    c.innerHTML = `<div class="muted">No data.</div>`;
    return;
  }

  // Try to extract common elements, or fallback to pretty JSON
  const summary = document.createElement('div');
  summary.className = 'results-grid';

  // Heuristics
  const rate = data.rate || data.bestRate || data.noteRate || data?.pricing?.rate;
  const apr = data.apr || data.APR || data?.pricing?.apr;
  const payment = data.piti || data.payment || data?.pricing?.payment;
  const price = data.price || data.points || data?.pricing?.price || state.inputs.borrowerPts;

  // Cards
  summary.appendChild(resultCard('Rate', rate ? `${Number(rate).toFixed(3)}%` : '—'));
  summary.appendChild(resultCard('APR', apr ? `${Number(apr).toFixed(3)}%` : '—'));
  summary.appendChild(resultCard('Points/Price', (price ?? '—').toString()));
  summary.appendChild(resultCard('Est. Payment', payment ? formatCurrency(payment) : '—'));

  c.appendChild(summary);

  // Details
  const details = document.createElement('pre');
  details.className = 'json';
  details.textContent = JSON.stringify(data, null, 2);
  c.appendChild(details);
}

function resultCard(label, value) {
  const d = document.createElement('div');
  d.className = 'result-card';
  d.innerHTML = `<div class="rc-label">${label}</div><div class="rc-value">${value}</div>`;
  return d;
}

/** ======= Auto-estimate toggles ======= **/
function applyTaxDefault(){
  if (!state.taxAuto) return;
  const abbr = state.inputs.stateAbbr || 'AZ';
  const rate = STATE_TAX_RATE_2023_PCT[abbr] ?? STATE_TAX_RATE_2023_PCT['AZ'] ?? 0.5;
  const taxes = Math.round(estimateAnnualTaxes(state.inputs.value, rate));
  state.inputs.taxes = taxes;
  el.taxes.value = formatCurrency(taxes);
}

function applyInsDefault(){
  if (!state.insAuto) return;
  const hoi = computeDefaultHOI(state.inputs.value, state.inputs.stateName || 'Arizona');
  state.inputs.ins = hoi;
  el.ins.value = formatCurrency(hoi);
}

function updateAutoChips() {
  el.taxAutoChip.classList.toggle('active', state.taxAuto);
  el.insAutoChip.classList.toggle('active', state.insAuto);
}

/** ======= Dev Panel ======= **/
function isDevRequested() {
  return (location.hostname === 'localhost') ||
         (/[?&]dev=1\b/i.test(location.search)) ||
         (localStorage.getItem(LS_DEV) === '1');
}

function showDevPanelIfNeeded() {
  state.devMode = isDevRequested();
  if (state.devMode) {
    el.devConfig.style.display = '';
    // Reflect dev mode pill
    $$('.pill', el.devModeGroup).forEach(p => p.classList.remove('active'));
    el.devModeGroup.querySelector('[data-value="on"]').classList.add('active');
  } else {
    el.devConfig.style.display = 'none';
    $$('.pill', el.devModeGroup).forEach(p => p.classList.remove('active'));
    el.devModeGroup.querySelector('[data-value="off"]').classList.add('active');
  }
  // Preload current WS3 & any override JSON (compact)
  el.ws3BaseInput.value = WS3_BASE || '';
  el.tablesJson.value = '';
}

function applyDevConfig() {
  const newWs3 = el.ws3BaseInput.value.trim();
  if (newWs3) {
    WS3_BASE = newWs3;
    localStorage.setItem(LS_WS3, WS3_BASE);
  }
  const txt = el.tablesJson.value.trim();
  if (txt) {
    try {
      const obj = JSON.parse(txt);
      // Accept combined or single objects
      if (obj.STATE_TAX_RATE_2023_PCT && typeof obj.STATE_TAX_RATE_2023_PCT === 'object') {
        STATE_TAX_RATE_2023_PCT = obj.STATE_TAX_RATE_2023_PCT;
        localStorage.setItem(LS_TAX, JSON.stringify(STATE_TAX_RATE_2023_PCT));
      } else if (!obj.HOI_2022 && !obj.STATE_TAX_RATE_2023_PCT) {
        // Try to infer if this looks like the tax map (keys are 2-letter states)
        const keys = Object.keys(obj);
        const isTax = keys.every(k => /^[A-Z]{2}$/.test(k));
        if (isTax) {
          STATE_TAX_RATE_2023_PCT = obj;
          localStorage.setItem(LS_TAX, JSON.stringify(STATE_TAX_RATE_2023_PCT));
        }
      }
      if (obj.HOI_2022 && typeof obj.HOI_2022 === 'object') {
        HOI_2022 = obj.HOI_2022;
        localStorage.setItem(LS_HOI, JSON.stringify(HOI_2022));
      } else if (!obj.HOI_2022 && !obj.STATE_TAX_RATE_2023_PCT) {
        // Try to infer HOI (keys likely full state names)
        const keys = Object.keys(obj);
        const looksLikeHoi = keys.some(k => k.length > 2 && /[a-z]/i.test(k));
        if (looksLikeHoi) {
          HOI_2022 = obj;
          localStorage.setItem(LS_HOI, JSON.stringify(HOI_2022));
        }
      }
      el.devStatus.textContent = 'Config applied.';
    } catch (e) {
      el.devStatus.textContent = `JSON parse error: ${e.message}`;
    }
  } else {
    el.devStatus.textContent = 'Config applied.';
  }
  // Re-run estimations with potentially updated tables
  applyTaxDefault();
  applyInsDefault();
}

function resetDevConfig() {
  WS3_BASE = _DEFAULT_WS3;
  STATE_TAX_RATE_2023_PCT = JSON.parse(JSON.stringify(_DEFAULT_TAX_TABLE));
  HOI_2022 = JSON.parse(JSON.stringify(_DEFAULT_HOI_TABLE));
  localStorage.removeItem(LS_WS3);
  localStorage.removeItem(LS_TAX);
  localStorage.removeItem(LS_HOI);
  el.ws3BaseInput.value = WS3_BASE;
  el.tablesJson.value = '';
  el.devStatus.textContent = 'Overrides cleared.';
  applyTaxDefault();
  applyInsDefault();
}

/** ======= Event Wiring ======= **/
function init() {
  // Load dev overrides from localStorage
  const savedWs3 = localStorage.getItem(LS_WS3);
  if (savedWs3) WS3_BASE = savedWs3;

  const savedTax = localStorage.getItem(LS_TAX);
  if (savedTax) {
    try { STATE_TAX_RATE_2023_PCT = JSON.parse(savedTax); } catch {}
  }
  const savedHoi = localStorage.getItem(LS_HOI);
  if (savedHoi) {
    try { HOI_2022 = JSON.parse(savedHoi); } catch {}
  }

  showDevPanelIfNeeded();

  // Dev panel wiring
  wirePillGroup(el.devModeGroup, (v) => {
    if (v === 'on') {
      localStorage.setItem(LS_DEV, '1');
    } else {
      localStorage.removeItem(LS_DEV);
    }
    showDevPanelIfNeeded();
  });
  el.applyConfigBtn.addEventListener('click', applyDevConfig);
  el.resetConfigBtn.addEventListener('click', resetDevConfig);

  // Program / Txn / Term
  el.program.addEventListener('change', (e) => {
    state.inputs.program = e.target.value;
    updateProgramPanels();
    scheduleReprice();
  });

  wirePillGroup(el.txnGroup, (v) => {
    state.inputs.txn = v;
    scheduleReprice();
  });
  wirePillGroup(el.termGroup, (v) => {
    state.inputs.term = Number(v);
    scheduleReprice();
  });

  // ZIP gating
  el.propZip.addEventListener('input', onZipChanged);
  onZipChanged(); // initialize state/city/estimates

  el.gateBtn.addEventListener('click', () => {
    if (state.leadToken) {
      // If returning user, allow quick reprice
      priceNow();
    } else {
      openLeadModal();
    }
  });

  // Loan structure
  el.propValue.addEventListener('blur', () => {
    el.propValue.value = formatCurrency(parseCurrency(el.propValue.value));
    syncFromValue();
  });
  el.ltvPct.addEventListener('blur', () => {
    el.ltvPct.value = formatPercent(parsePercent(el.ltvPct.value));
    syncFromLtv();
  });
  el.loanAmt.addEventListener('blur', () => {
    el.loanAmt.value = formatCurrency(parseCurrency(el.loanAmt.value));
    syncFromLoan();
  });

  // Credit & Points
  el.fico.addEventListener('input', () => {
    el.ficoNum.value = el.fico.value;
    state.inputs.fico = Number(el.fico.value);
    scheduleReprice();
  });
  el.ficoNum.addEventListener('change', () => {
    let v = Math.max(300, Math.min(850, Number(el.ficoNum.value || 740)));
    el.fico.value = String(v);
    state.inputs.fico = v;
    scheduleReprice();
  });
  el.points.addEventListener('input', () => {
    el.pointsNum.value = el.points.value;
    state.inputs.borrowerPts = Number(el.points.value);
    scheduleReprice();
  });
  el.pointsNum.addEventListener('change', () => {
    let v = Math.max(-5, Math.min(5, Number(el.pointsNum.value || 0)));
    el.points.value = String(v);
    state.inputs.borrowerPts = v;
    scheduleReprice();
  });

  // Toggle groups
  wirePillGroup(el.pmiToggle, (v) => {
    state.inputs.pmiToggle = v === 'true';
    scheduleReprice();
  });
  wirePillGroup(el.dti45, (v) => {
    state.inputs.dtiOver45 = v === 'true';
    scheduleReprice();
  });
  wirePillGroup(el.twoBorrowers, (v) => {
    state.inputs.twoPlusBorrowers = v === 'true';
    scheduleReprice();
  });

  // Taxes/HOI/HOA manual override and Auto toggles
  el.taxes.addEventListener('blur', () => {
    state.inputs.taxes = parseCurrency(el.taxes.value);
    el.taxes.value = formatCurrency(state.inputs.taxes);
    state.taxAuto = false;
    updateAutoChips();
    scheduleReprice();
  });
  el.ins.addEventListener('blur', () => {
    state.inputs.ins = parseCurrency(el.ins.value);
    el.ins.value = formatCurrency(state.inputs.ins);
    state.insAuto = false;
    updateAutoChips();
    scheduleReprice();
  });
  el.hoa.addEventListener('blur', () => {
    state.inputs.hoa = parseCurrency(el.hoa.value);
    el.hoa.value = formatCurrency(state.inputs.hoa);
    scheduleReprice();
  });
  el.taxAutoChip.addEventListener('click', () => {
    state.taxAuto = !state.taxAuto;
    updateAutoChips();
    applyTaxDefault();
    scheduleReprice();
  });
  el.insAutoChip.addEventListener('click', () => {
    state.insAuto = !state.insAuto;
    updateAutoChips();
    applyInsDefault();
    scheduleReprice();
  });

  // Program-specific controls
  wirePillGroup(el.financeUfmip, (v) => {
    state.inputs.financeUfmip = v === 'true';
    scheduleReprice();
  });
  el.annualMip.addEventListener('change', () => {
    state.inputs.annualMip = Number(el.annualMip.value || 0.55);
    scheduleReprice();
  });

  wirePillGroup(el.vaExempt, (v) => {
    state.inputs.vaExempt = v === 'true';
    scheduleReprice();
  });
  wirePillGroup(el.vaFirstUse, (v) => {
    state.inputs.vaFirstUse = v === 'true';
    scheduleReprice();
  });

  el.dscrRatio.addEventListener('change', () => {
    state.inputs.dscrRatio = Number(el.dscrRatio.value || 1.25);
    scheduleReprice();
  });

  // Lead modal
  el.leadForm.addEventListener('submit', handleLeadSubmit);
  el.cancelLead.addEventListener('click', (e) => {
    e.preventDefault();
    closeLeadModal();
  });

  // Save quote
  el.saveQuoteBtn.addEventListener('click', saveQuote);

  // Restore last email if present
  if (state.leadEmail) {
    el.email.value = state.leadEmail;
  }

  // Initialize formatted inputs and chips
  el.propValue.value = formatCurrency(state.inputs.value);
  el.ltvPct.value = formatPercent(state.inputs.ltv);
  el.loanAmt.value = formatCurrency(state.inputs.loan);
  updateProgramPanels();
  updateAutoChips();

  // If we already have a token (return visitor), consider the user gated
  if (state.leadToken) {
    state.gated = true;
    el.gateBtn.textContent = 'Reprice Now';
    el.gateBtn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', init);
