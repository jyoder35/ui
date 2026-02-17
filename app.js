// ======== AZM Workspace 4 — UI Engine (GitHub Pages) ========
// Incorporates: lead gate, auto-pricing, improved saveQuote, ZIP->State escrows,
// transaction-aware inputs, editable LTV, FICO & Points sliders.

// ---------------- Config ----------------
const CONFIG = {
  versions: { ui: 'UI v0.1.1', pricing: 'Pricing v1.1.0', rates: 'Rates v1.3.0' },

  // WS‑1 (Rates): optional preload; DISABLED to avoid CORS noise in GitHub Pages context
  ratesUrl:
    'https://script.google.com/macros/s/AKfycbxFUmGP213ag2uV4cey3V2ox0diofarpDKNt0szGrSajVpO8CF_paFN7u_R9cPa4Y3FwA/exec?action=rates&lpc=2.25',

  // WS‑2 (Pricing)
  pricingBase:
    'https://script.google.com/macros/s/AKfycbzM2epYNmWxxIP5Sp4Fnl1iz4tCcSf_lCVGb0Hm-0pQBaST8mb8EsQ-jVC6_5WIXZon/exec',

  // WS‑3 (Leads)
  leadsBase:
    'https://script.google.com/macros/s/AKfycbxBP3K11wYn-r6_98B3qsJUMI8yj8bKRX8gLFarQ_f5WEvEMSfXHQ9neg4RQJhTlnKv/exec',

  // Sheets (display-only)
  llpaSheetId: '1ZEtVSxpOD2iYxH348ynQgzBOTofiAFFxZ04Ax6cCXHw',
  leadsSheetId: '1g4TSX6MFR-m0We1LfPKKsEfsXdCJ8BFL3hINmU2UlD8',
};

// Local storage keys
const LS_KEYS = { leadToken: 'azm_leadToken', leadEmail: 'azm_leadEmail' };

// Cached last successful price result (for Save)
let lastPriceResult = null;

// ---------------- DOM Helpers ----------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------------- Formatters ----------------
function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}
function nowStampMMDD_HHMM(d = new Date()) {
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function onlyDigits(s = '') { return String(s).replace(/\D+/g, ''); }
function normalizeZip5(z) { return onlyDigits(z).slice(0, 5).padStart(5, '0'); }
function debounce(fn, ms = 350) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function setStatus(msg, isError = false) {
  const el = $('#statusArea'); if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#ef4444' : 'var(--muted, #aab2d5)';
}
function hasLeadToken() { return !!localStorage.getItem(LS_KEYS.leadToken); }
function toggleLoading(disabled) {
  $('#btnCalculate') && ($('#btnCalculate').disabled = disabled || !hasLeadToken());
  $('#btnSave') && ($('#btnSave').disabled = disabled || !hasLeadToken());
}

// ---------------- Transaction-aware trio sync ----------------
function getNumber(el, fallback = 0) {
  const v = Number(el?.value);
  return Number.isFinite(v) ? v : fallback;
}
function setNumber(el, n) { if (el) el.value = Number(n ?? 0); }
function setText(el, s) { if (el) el.textContent = s; }

function syncTrioFrom(source) {
  const valueEl = $('#value'), loanEl = $('#loan'), ltvEl = $('#ltv');
  const value = getNumber(valueEl, 0), loan = getNumber(loanEl, 0);
  let ltv = ltvEl ? getNumber(ltvEl, value > 0 ? (loan / value) * 100 : 0) : (value > 0 ? (loan / value) * 100 : 0);

  const dpPctEl = $('#downPct');    // purchase helper
  const eqPctEl = $('#equityPct');  // refi helper

  if (source === 'value') {
    if (ltvEl) { setNumber(loanEl, Math.round(getNumber(ltvEl) / 100 * getNumber(valueEl))); }
    else if (value > 0) { setNumber(ltvEl, (loan / value) * 100); }
  } else if (source === 'loan') {
    if (value > 0) setNumber(ltvEl, (getNumber(loanEl) / value) * 100);
  } else if (source === 'ltv') {
    setNumber(loanEl, Math.round(getNumber(ltvEl) / 100 * value));
  } else if (source === 'downPct' && dpPctEl) {
    setNumber(loanEl, Math.round(value * (1 - getNumber(dpPctEl, 0) / 100)));
    if (value > 0) setNumber(ltvEl, (getNumber(loanEl) / value) * 100);
  } else if (source === 'equityPct' && eqPctEl) {
    setNumber(loanEl, Math.round(value * (1 - getNumber(eqPctEl, 0) / 100)));
    if (value > 0) setNumber(ltvEl, (getNumber(loanEl) / value) * 100);
  }

  // Clamp UI ranges
  if (ltvEl) setNumber(ltvEl, Math.max(0, Math.min(200, getNumber(ltvEl))));
  if (dpPctEl) setNumber(dpPctEl, Math.max(0, Math.min(100, getNumber(dpPctEl))));
  if (eqPctEl) setNumber(eqPctEl, Math.max(0, Math.min(100, getNumber(eqPctEl))));
}

function updateTxnPanels() {
  const txn = $('#txn')?.value || 'PURCHASE';
  $('#panelPurchase')?.classList.toggle('hidden', txn !== 'PURCHASE');
  $('#panelRefi')?.classList.toggle('hidden', txn === 'PURCHASE');
  setText($('#labelValue'), txn === 'PURCHASE' ? 'Property Value ($)' : 'Property Value ($)');
  setText($('#labelLoan'), 'Base Loan Amount ($)');
}

// ---------------- ZIP → State Tax & HOI Estimator ----------------
// Interprets your previous methodology: fetch state by ZIP via zippopotam.us,
// use state-level property tax % of value and HOI average at $300k coverage,
// then scale HOI by (value / 300k). (From your prior snippet.) [1](https://netorgft13002274-my.sharepoint.com/personal/josh_myazm_com/Documents/Microsoft%20Copilot%20Chat%20Files/AZM%20Calculator%20HTML.txt)

// State property tax rates (%) — 2023 (from your prior data)
const STATE_TAX_RATE_2023_PCT = {
  AL:0.375, AK:0.875, AZ:0.500, AR:0.500, CA:0.750, CO:0.500, CT:1.500, DE:0.500,
  FL:0.750, GA:0.750, HI:0.375, ID:0.500, IL:1.875, IN:0.750, IA:1.250, KS:1.250,
  KY:0.750, LA:0.500, ME:1.000, MD:0.875, MA:1.000, MI:1.125, MN:1.000, MS:0.625,
  MO:0.875, MT:0.625, NE:1.375, NV:0.500, NH:1.375, NJ:1.750, NM:0.625, NY:1.250,
  NC:0.625, ND:1.000, OH:1.250, OK:0.750, OR:0.750, PA:1.250, RI:1.000, SC:0.500,
  SD:1.000, TN:0.500, TX:1.375, UT:0.500, VT:1.375, VA:0.750, WA:0.750, WV:0.500,
  WI:1.250, WY:0.500, DC:0.625
};

// Average HOI premium by state at $300k coverage — 2022 (from your prior data)
const HOI_2022 = {
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

const zipCache = new Map();
let zipTimer = null;
let stateAbbr = 'AZ';
let stateName = 'Arizona';
let cityName = '';

function normalizeZip(zip){ const d = String(zip || '').replace(/\D/g, ''); return d.length >= 5 ? d.slice(0, 5) : ''; }

async function fetchZipInfo(zip){
  const z = normalizeZip(zip);
  if (!z) return null;
  if (zipCache.has(z)) return zipCache.get(z);
  try{
    const res = await fetch(`https://api.zippopotam.us/us/${z}`, { cache:"no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const place = data?.places?.[0];
    const abbr = place?.["state abbreviation"] || null;
    const state = place?.["state"] || null;
    const city = place?.["place name"] || null;
    if (!abbr || !state) return null;
    const info = { abbr, state, city: city || "" };
    zipCache.set(z, info);
    return info;
  }catch{
    return null;
  }
}

function estimateAnnualTaxes(value, ratePct){
  const v = Number(value), r = Number(ratePct);
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(r) || r <= 0) return 0;
  return v * (r/100);
}
function clamp(n, lo, hi){ n = Number(n); if (!isFinite(n)) return lo; return Math.max(lo, Math.min(hi, n)); }
function computeDefaultHOI(value){
  const v = clamp(value, 0, 1e12);
  const base = HOI_2022[stateName] ?? HOI_2022["Arizona"] ?? 0;
  if (!base || !v) return 0;
  const scaled = base * (v / HOI_BASE_COVERAGE);
  return Math.round(scaled / 25) * 25;
}
function applyTaxDefault(){
  const auto = $('#autoEscrowsToggle'); if (auto && !auto.checked) return;
  const rate = STATE_TAX_RATE_2023_PCT[stateAbbr] ?? STATE_TAX_RATE_2023_PCT["AZ"];
  const value = getNumber($('#value'), 0);
  if (!rate || !value) return;
  setNumber($('#taxes'), Math.round(estimateAnnualTaxes(value, rate)));
}
function applyInsDefault(){
  const auto = $('#autoEscrowsToggle'); if (auto && !auto.checked) return;
  const value = getNumber($('#value'), 0);
  setNumber($('#ins'), computeDefaultHOI(value));
}
function setZipMsg(type, text){
  const el = $('#zipMsg'); if (!el) return;
  if (!text){ el.textContent=''; return; }
  el.textContent = text;
}

function onZipInput(){
  clearTimeout(zipTimer);
  zipTimer = setTimeout(async () => {
    const zip = normalizeZip($('#propZip')?.value || '');
    if (!zip){
      stateAbbr = 'AZ'; stateName = 'Arizona'; cityName = '';
      setZipMsg('ok', '');
      applyTaxDefault(); applyInsDefault();
      return;
    }
    const info = await fetchZipInfo(zip);
    if (!info){ setZipMsg('warn', 'Could not find Property ZIP. Try another ZIP.'); return; }
    stateAbbr = info.abbr; stateName = info.state; cityName = info.city || '';
    setZipMsg('ok', `${cityName ? cityName + ', ' : ''}${stateName}`);
    applyTaxDefault(); applyInsDefault();
    if (hasLeadToken()) debouncedPrice();
  }, 300);
}

// ---------------- API Helpers (diagnostic-friendly) ----------------
async function postTextJson(url, bodyObj) {
  let res, text;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(bodyObj),
    });
  } catch (netErr) {
    setStatus(`Network error: ${netErr.message}`, true);
    throw netErr;
  }

  text = await res.text();
  if (!res.ok) {
    const snippet = text.slice(0, 200);
    const action = new URL(url).searchParams.get('action') || 'call';
    const msg = `HTTP ${res.status} on ${action} — ${snippet}`;
    setStatus(msg, true);
    console.error('API error', { url, status: res.status, body: text });
    throw new Error(msg);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    const action = new URL(url).searchParams.get('action') || 'call';
    const msg = `Unexpected non‑JSON response for ${action}`;
    setStatus(msg, true);
    console.error('Parse error', { url, text });
    throw e;
  }
}

async function callPrice(inputs, leadToken) {
  const url = `${CONFIG.pricingBase}?action=price`;
  const body = { payload: { inputs, ...(leadToken ? { leadToken } : {}) } };
  console.debug('→ price payload', body);
  return postTextJson(url, body);
}
async function callUpsertLead(leadFields) {
  const url = `${CONFIG.leadsBase}?action=upsertLead`;
  const body = { payload: leadFields };
  console.debug('→ upsertLead payload', body);
  return postTextJson(url, body);
}
async function callSaveQuote(savePayload) {
  const url = `${CONFIG.leadsBase}?action=saveQuote`;
  console.debug('→ saveQuote payload', savePayload);
  return postTextJson(url, { payload: savePayload });
}

// Optional rates preload — disabled to avoid CORS noise when WS‑1 is GET-only
async function preloadRates() {
  // If you re-enable later, prefer simple GET:
  // const res = await fetch(CONFIG.ratesUrl); const data = await res.json().catch(()=> ({}));
  // console.debug('Rates preload:', data);
}

// ---------------- Inputs & Program Panels ----------------
function gatherInputs() {
  const program = $('#program')?.value || 'CONV30';
  const txn = $('#txn')?.value || 'PURCHASE';
  const termMonths = getNumber($('#termYears'), 30) * 12;

  const value = getNumber($('#value'), 0);
  const loan = getNumber($('#loan'), 0);
  const ltvEl = $('#ltv');
  const ltv = ltvEl ? getNumber(ltvEl, (value > 0 ? (loan / value) * 100 : 0)) : (value > 0 ? (loan / value) * 100 : 0);

  const base = {
    program,
    txn,
    term: termMonths,
    loan,
    ltv: Math.round(ltv * 100) / 100,
    fico: getNumber($('#fico'), 740),
    borrowerPts: getNumber($('#borrowerPts'), 0),
    taxes: getNumber($('#taxes'), 0),
    ins: getNumber($('#ins'), 0),
    hoa: getNumber($('#hoa'), 0),
  };

  if (program === 'CONV30') {
    base.pmiToggle = $('#pmiToggle')?.checked ?? true;
    base.dtiOver45 = $('#dtiOver45')?.checked ?? false;
    base.twoPlusBorrowers = $('#twoPlusBorrowers')?.checked ?? false;
  } else if (program === 'FHA30') {
    base.financeUfmip = $('#financeUfmip')?.checked ?? true;
    base.annualMip = getNumber($('#annualMip'), 0.55);
  } else if (program === 'VA30') {
    base.vaExempt = $('#vaExempt')?.checked ?? false;
    base.vaFirstUse = $('#vaFirstUse')?.checked ?? true;
  } else if (program === 'DSCR30') {
    base.dscrRatio = getNumber($('#dscrRatio'), 1.25);
  }

  return base;
}

function showProgramPanel(program) {
  $('#panelCONV')?.classList.toggle('hidden', program !== 'CONV30');
  $('#panelFHA')?.classList.toggle('hidden', program !== 'FHA30');
  $('#panelVA')?.classList.toggle('hidden', program !== 'VA30');
  $('#panelDSCR')?.classList.toggle('hidden', program !== 'DSCR30');
}

// ---------------- Rendering ----------------
function renderResults(data, inputs) {
  const el = $('#results'); if (!el) return;

  if (!data || data.ok === false) {
    el.innerHTML = `<div class="placeholder">No results. ${data?.message || ''}</div>`;
    return;
  }
  const { noteRate, parRate, totalLoan, piMonthly, miMonthly, totalPayment, breakdown } = data;

  const programLabel = ({
    CONV30: 'Conventional 30‑Year',
    FHA30: 'FHA 30‑Year',
    VA30: 'VA 30‑Year',
    DSCR30: 'DSCR 30‑Year',
  })[inputs.program] || inputs.program;

  el.innerHTML = `
    <div class="grid two-col">
      <div>
        <h3>${programLabel}</h3>
        <div>Txn: <strong>${inputs.txn}</strong></div>
        <div>Loan: <strong>${fmtMoney(inputs.loan)}</strong></div>
        <div>LTV: <strong>${(inputs.ltv || 0).toFixed(2)}%</strong></div>
        <div>FICO: <strong>${inputs.fico}</strong></div>
        <div>Borrower Pts: <strong>${inputs.borrowerPts.toFixed(3)}%</strong></div>
      </div>
      <div>
        <div>Par Rate: <strong>${parRate != null ? Number(parRate).toFixed(3) + '%' : '—'}</strong></div>
        <div>Note Rate: <strong>${noteRate != null ? Number(noteRate).toFixed(3) + '%' : '—'}</strong></div>
        <div>Total Loan: <strong>${fmtMoney(totalLoan)}</strong></div>
        <div>PI: <strong>${fmtMoney(piMonthly)}</strong></div>
        <div>MI: <strong>${fmtMoney(miMonthly)}</strong></div>
        <div>Total Pmt: <strong>${fmtMoney(totalPayment)}</strong></div>
      </div>
    </div>
    ${breakdown ? `<div style="margin-top:12px;"><h3>Breakdown</h3><pre style="white-space:pre-wrap;">${JSON.stringify(breakdown, null, 2)}</pre></div>` : ''}
  `;
}
function renderLastQuotedAt() { $('#lastQuoted') && ($('#lastQuoted').textContent = `Last quoted at ${nowStampMMDD_HHMM()}`); }

// ---------------- Lead Gate ----------------
function openLeadModal() {
  const dlg = $('#leadModal');
  if (!dlg) return;
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.classList.remove('hidden');
}
function closeLeadModal() {
  const dlg = $('#leadModal'); if (!dlg) return;
  if (typeof dlg.close === 'function') dlg.close();
  dlg.classList.add('hidden');
}

async function handleLeadSubmit(e) {
  e.preventDefault();
  const status = $('#leadStatus');
  if (status) { status.textContent = 'Creating lead…'; status.style.color = 'var(--muted)'; }

  const name = $('#leadName')?.value.trim();
  const email = $('#leadEmail')?.value.trim();
  const phone = $('#leadPhone')?.value.trim();
  const zip5Input = $('#leadZip')?.value;
  const zip5 = normalizeZip5(zip5Input || '');

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { status.textContent = 'Please enter a valid email.'; status.style.color = '#ef4444'; return; }
  if (!/^\d{5}$/.test(zip5)) { status.textContent = 'ZIP must be 5 digits.'; status.style.color = '#ef4444'; return; }

  try {
    const leadFields = {
      'Primary Borrower Name': name || '',
      'Primary Borrower Email': email,
      'Primary Borrower Phone': phone || '',
      'Subject ZIP': zip5,
      Source: 'UI-W4',
    };
    const res = await callUpsertLead(leadFields);
    if (!res || !res.ok || !res.leadToken) throw new Error(res?.message || 'Unexpected lead response.');

    localStorage.setItem(LS_KEYS.leadToken, res.leadToken);
    localStorage.setItem(LS_KEYS.leadEmail, email);

    if ($('#propZip') && !$('#propZip').value) $('#propZip').value = zip5;

    $('#btnCalculate') && ($('#btnCalculate').disabled = false);
    $('#btnSave') && ($('#btnSave').disabled = false);

    status.textContent = 'Lead created. Loading your pricing…';
    closeLeadModal();

    await doPrice(); // immediate first price
  } catch (err) {
    console.error(err);
    status.textContent = `Lead error: ${err.message || err}`;
    status.style.color = '#ef4444';
  }
}

// ---------------- Pricing & Save ----------------
async function doPrice() {
  const leadToken = localStorage.getItem(LS_KEYS.leadToken);
  if (!leadToken) { setStatus('Please submit the lead form to unlock pricing.', true); return; }

  const inputs = gatherInputs();
  if (inputs.loan <= 0 || inputs.fico < 300) { setStatus('Please check your loan amount and FICO.', true); return; }

  setStatus('Pricing…'); toggleLoading(true);
  try {
    const data = await callPrice(inputs, leadToken);
    lastPriceResult = data;
    renderResults(data, inputs);
    renderLastQuotedAt();
    setStatus('Done.');
  } catch (err) {
    console.error(err);
    setStatus(`Pricing failed: ${err.message || err}`, true);
  } finally {
    toggleLoading(false);
  }
}
const debouncedPrice = debounce(doPrice, 350);

async function doSaveQuote() {
  const leadToken = localStorage.getItem(LS_KEYS.leadToken);
  if (!leadToken) { setStatus('Lead token missing. Please submit the lead form.', true); return; }
  const inputs = gatherInputs();

  setStatus('Saving quote…'); toggleLoading(true);
  try {
    const payload = {
      leadToken,
      inputs,
      quote: lastPriceResult || null, // include snapshot so history is meaningful
      savedAt: nowStampMMDD_HHMM(),
      source: 'UI-W4',
    };
    const res = await callSaveQuote(payload);
    console.debug('saveQuote response:', res);
    if (!res) throw new Error('No response from saveQuote.');
    if (res.ok === false) throw new Error(res.message || 'Save failed (ok:false).');
    setStatus('Saved.');
  } catch (err) {
    console.error(err);
    setStatus(`Save failed: ${err.message || err}`, true);
  } finally {
    toggleLoading(false);
  }
}

// ---------------- Sliders & ZIP hooks ----------------
function hookSliders() {
  const ficoSlider = $('#ficoSlider'), ficoNum = $('#fico');
  if (ficoSlider && ficoNum) {
    ficoSlider.value = String(getNumber(ficoNum, 740));
    ficoSlider.addEventListener('input', () => { ficoNum.value = ficoSlider.value; if (hasLeadToken()) debouncedPrice(); });
    ficoNum.addEventListener('input', () => { ficoSlider.value = ficoNum.value; if (hasLeadToken()) debouncedPrice(); });
  }

  const ptsSlider = $('#pointsSlider'), ptsNum = $('#borrowerPts');
  if (ptsSlider && ptsNum) {
    const syncFromSlider = () => { ptsNum.value = Number(ptsSlider.value).toFixed(3); if (hasLeadToken()) debouncedPrice(); };
    const syncFromNumber = () => { ptsSlider.value = String(Number(ptsNum.value || 0)); if (hasLeadToken()) debouncedPrice(); };
    ptsSlider.addEventListener('input', syncFromSlider);
    ptsNum.addEventListener('input', syncFromNumber);
    syncFromNumber();
  }
}

function initConfigUi() {
  $('#cfgRatesUrl') && ($('#cfgRatesUrl').value = CONFIG.ratesUrl);
  $('#cfgPricingUrl') && ($('#cfgPricingUrl').value = `${CONFIG.pricingBase}?action=price`);
  $('#cfgLeadsUrl') && ($('#cfgLeadsUrl').value = `${CONFIG.leadsBase}?[upsertLead|saveQuote]`);
  $('#cfgLlpaSheet') && ($('#cfgLlpaSheet').value = CONFIG.llpaSheetId);
  $('#cfgLeadsSheet') && ($('#cfgLeadsSheet').value = CONFIG.leadsSheetId);

  $('#versionChip') && ($('#versionChip').textContent = `${CONFIG.versions.ui} • ${CONFIG.versions.pricing} • ${CONFIG.versions.rates}`);
  $('#footerVersion') && ($('#footerVersion').textContent = CONFIG.versions.ui);
}

function initEvents() {
  // Program/Txn panels
  $('#program')?.addEventListener('change', (e) => { showProgramPanel(e.target.value); if (hasLeadToken()) debouncedPrice(); });
  $('#txn')?.addEventListener('change', () => { updateTxnPanels(); if (hasLeadToken()) debouncedPrice(); });

  // Core inputs auto-reprice when gated + sync trio + ZIP estimates
  [
    '#termYears', '#loan', '#value', '#ltv', '#fico', '#borrowerPts', '#taxes', '#ins', '#hoa',
    '#pmiToggle', '#dtiOver45', '#twoPlusBorrowers',
    '#financeUfmip', '#annualMip',
    '#vaExempt', '#vaFirstUse',
    '#dscrRatio',
    '#propZip', '#downPct', '#equityPct'
  ].forEach((sel) => {
    const el = $(sel); if (!el) return;
    const source = sel.replace('#', '');
    el.addEventListener('input', () => {
      if (['value','loan','ltv','downPct','equityPct'].includes(source)) syncTrioFrom(source);
      if (source === 'propZip' || source === 'value') onZipInput();
      if (hasLeadToken()) debouncedPrice();
    });
    el.addEventListener('change', () => {
      if (['value','loan','ltv','downPct','equityPct'].includes(source)) syncTrioFrom(source);
      if (source === 'propZip' || source === 'value') onZipInput();
      if (hasLeadToken()) debouncedPrice();
    });
  });

  // Gate + actions
  $('#btnGetResults')?.addEventListener('click', openLeadModal);
  $('#btnCalculate')?.addEventListener('click', doPrice);
  $('#btnSave')?.addEventListener('click', doSaveQuote);

  // Lead modal
  $('#leadForm')?.addEventListener('submit', handleLeadSubmit);
  $('#leadCancel')?.addEventListener('click', closeLeadModal);

  // Sliders
  hookSliders();

  // Returning user
  if (hasLeadToken()) {
    $('#btnCalculate') && ($('#btnCalculate').disabled = false);
    $('#btnSave') && ($('#btnSave').disabled = false);
    setStatus('Welcome back! Re‑pricing with your current inputs…');
    doPrice();
  }

  updateTxnPanels(); // init labels/panels
}

// ---------------- Boot ----------------
window.addEventListener('DOMContentLoaded', () => {
  console.log('W4 UI booting…');
  initConfigUi();
  initEvents();
  showProgramPanel($('#program')?.value || 'CONV30');
  // preloadRates(); // disabled by default (avoid WS‑1 CORS noise)
});
