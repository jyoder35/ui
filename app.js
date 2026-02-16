// ======== Config (paste your live endpoints here) ========
// All POSTs use Content-Type: text/plain with raw JSON body (no preflight).
const CONFIG = {
  versions: {
    ui: 'UI v0.1.0',
    pricing: 'Pricing v1.1.0',
    rates: 'Rates v1.3.0',
  },
  // WS‑1 (Rates): include action=rates & default lpc spread
  ratesUrl: 'https://script.google.com/macros/s/AKfycbxFUmGP213ag2uV4cey3V2ox0diofarpDKNt0szGrSajVpO8CF_paFN7u_R9cPa4Y3FwA/exec?action=rates&lpc=2.25',

  // WS‑2 (Pricing)
  pricingBase: 'https://script.google.com/macros/s/AKfycbzM2epYNmWxxIP5Sp4Fnl1iz4tCcSf_lCVGb0Hm-0pQBaST8mb8EsQ-jVC6_5WIXZon/exec',

  // WS‑3 (Leads)
  leadsBase: 'https://script.google.com/macros/s/AKfycbxBP3K11wYn-r6_98B3qsJUMI8yj8bKRX8gLFarQ_f5WEvEMSfXHQ9neg4RQJhTlnKv/exec',

  // Sheets (read-only in UI, just for reference)
  llpaSheetId: '1ZEtVSxpOD2iYxH348ynQgzBOTofiAFFxZ04Ax6cCXHw',
  leadsSheetId: '1g4TSX6MFR-m0We1LfPKKsEfsXdCJ8BFL3hINmU2UlD8',
};

const LS_KEYS = {
  leadToken: 'azm_leadToken',
  leadEmail: 'azm_leadEmail',
};

// ======== Utilities ========

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${(Number(n) * 100).toFixed(3)}%`;
}

function nowStampMMDD_HHMM(d = new Date()) {
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function onlyDigits(s = '') { return String(s).replace(/\D+/g, ''); }
function normalizeZip5(z) {
  const digits = onlyDigits(z).slice(0, 5);
  // pad start to preserve leading zeros (e.g., 02134)
  return digits.padStart(5, '0');
}

function debounce(fn, ms = 350) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}

function setStatus(msg, isError = false) {
  const el = $('#statusArea');
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function toggleLoading(disabled) {
  $('#btnCalculate').disabled = disabled || !hasLeadToken();
  $('#btnSave').disabled = disabled || !hasLeadToken();
}

function hasLeadToken() {
  return !!localStorage.getItem(LS_KEYS.leadToken);
}

// ======== API Helpers ========

async function postTextJson(url, bodyObj) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(bodyObj),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data;
}

async function callPrice(inputs, leadToken) {
  const url = `${CONFIG.pricingBase}?action=price`;
  const body = { payload: { inputs, ...(leadToken ? { leadToken } : {}) } };
  return postTextJson(url, body);
}

async function callUpsertLead(leadFields) {
  const url = `${CONFIG.leadsBase}?action=upsertLead`;
  // As per contract, raw JSON in text/plain with "payload": { … }
  return postTextJson(url, { payload: leadFields });
}

async function callSaveQuote(savePayload) {
  const url = `${CONFIG.leadsBase}?action=saveQuote`;
  return postTextJson(url, { payload: savePayload });
}

// Optional: preload rates (WS‑1), not required for pricing
async function preloadRates() {
  try {
    const res = await postTextJson(CONFIG.ratesUrl, {}); // Apps Script ignores body for GET-like params
    console.debug('Rates preload:', res);
  } catch (e) {
    console.debug('Rates preload failed (non-blocking):', e.message);
  }
}

// ======== Input State & Mappers ========

function gatherInputs() {
  const program = $('#program').value;
  const txn = $('#txn').value;
  const termMonths = Number($('#termYears').value || 30) * 12;

  const loan = Number($('#loan').value || 0);
  const value = Number($('#value').value || 0);
  const ltv = value > 0 ? Math.round((loan / value) * 10000) / 100 : 0;

  const base = {
    program,
    txn,
    term: termMonths,
    loan,
    ltv,
    fico: Number($('#fico').value || 0),
    borrowerPts: Number($('#borrowerPts').value || 0),
    taxes: Number($('#taxes').value || 0),
    ins: Number($('#ins').value || 0),
    hoa: Number($('#hoa').value || 0),
  };

  // Program-specific flags
  if (program === 'CONV30') {
    base.pmiToggle = $('#pmiToggle').checked;
    base.dtiOver45 = $('#dtiOver45').checked;
    base.twoPlusBorrowers = $('#twoPlusBorrowers').checked;
  } else if (program === 'FHA30') {
    base.financeUfmip = $('#financeUfmip').checked;
    base.annualMip = Number($('#annualMip').value || 0.55);
  } else if (program === 'VA30') {
    base.vaExempt = $('#vaExempt').checked;
    base.vaFirstUse = $('#vaFirstUse').checked;
  } else if (program === 'DSCR30') {
    base.dscrRatio = Number($('#dscrRatio').value || 1.25);
  }

  return base;
}

function showProgramPanel(program) {
  $('#panelCONV').classList.toggle('hidden', program !== 'CONV30');
  $('#panelFHA').classList.toggle('hidden', program !== 'FHA30');
  $('#panelVA').classList.toggle('hidden', program !== 'VA30');
  $('#panelDSCR').classList.toggle('hidden', program !== 'DSCR30');
}

// ======== Rendering ========

function renderResults(data, inputs) {
  const el = $('#results');
  if (!data || data.ok === false) {
    el.innerHTML = `<div class="placeholder">No results. ${data && data.message ? data.message : ''}</div>`;
    return;
  }

  const {
    noteRate, parRate, totalLoan,
    piMonthly, miMonthly, totalPayment,
    breakdown,
  } = data;

  const ltv = inputs.ltv;
  const programLabel = {
    CONV30: 'Conventional 30‑Year',
    FHA30: 'FHA 30‑Year',
    VA30: 'VA 30‑Year',
    DSCR30: 'DSCR 30‑Year',
  }[inputs.program] || inputs.program;

  el.innerHTML = `
    <div class="grid two-col">
      <div>
        <h3>${programLabel}</h3>
        <div>Txn: <strong>${inputs.txn}</strong></div>
        <div>Loan: <strong>${fmtMoney(inputs.loan)}</strong></div>
        <div>LTV: <strong>${ltv.toFixed(2)}%</strong></div>
        <div>FICO: <strong>${inputs.fico}</strong></div>
        <div>Borrower Pts: <strong>${inputs.borrowerPts.toFixed(3)}%</strong></div>
      </div>

      <div>
        <div>Par Rate: <strong>${parRate != null ? (Number(parRate).toFixed(3) + '%') : '—'}</strong></div>
        <div>Note Rate: <strong>${noteRate != null ? (Number(noteRate).toFixed(3) + '%') : '—'}</strong></div>
        <div>Total Loan: <strong>${fmtMoney(totalLoan)}</strong></div>
        <div>PI: <strong>${fmtMoney(piMonthly)}</strong></div>
        <div>MI: <strong>${fmtMoney(miMonthly)}</strong></div>
        <div>Total Pmt: <strong>${fmtMoney(totalPayment)}</strong></div>
      </div>
    </div>

    ${breakdown ? `
      <div style="margin-top: 12px;">
        <h3>Breakdown</h3>
        <pre style="white-space:pre-wrap;">${JSON.stringify(breakdown, null, 2)}</pre>
      </div>
    ` : ''}
  `;
}

function renderLastQuotedAt() {
  $('#lastQuoted').textContent = `Last quoted at ${nowStampMMDD_HHMM()}`;
}

// ======== Lead Gating ========

function openLeadModal() {
  const dlg = $('#leadModal');
  if (typeof dlg.showModal === 'function') {
    dlg.showModal();
  } else {
    dlg.classList.remove('hidden');
  }
}

function closeLeadModal() {
  const dlg = $('#leadModal');
  if (typeof dlg.close === 'function') dlg.close();
  dlg.classList.add('hidden');
}

async function handleLeadSubmit(e) {
  e.preventDefault();
  $('#leadStatus').textContent = 'Creating lead…';
  $('#leadStatus').style.color = 'var(--muted)';

  const name = $('#leadName').value.trim();
  const email = $('#leadEmail').value.trim();
  const phone = $('#leadPhone').value.trim();
  const zip5 = normalizeZip5($('#leadZip').value);

  // Basic validation
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    $('#leadStatus').textContent = 'Please enter a valid email.';
    $('#leadStatus').style.color = 'var(--danger)';
    return;
  }
  if (!/^\d{5}$/.test(zip5)) {
    $('#leadStatus').textContent = 'ZIP must be 5 digits.';
    $('#leadStatus').style.color = 'var(--danger)';
    return;
  }

  try {
    const leadFields = {
      // Match existing sheet field names as provided:
      'Primary Borrower Name': name,
      'Primary Borrower Email': email,
      'Primary Borrower Phone': phone,
      'Subject ZIP': zip5,
      'Source': 'UI-W4',
    };
    const res = await callUpsertLead(leadFields);

    if (!res || !res.ok || !res.leadToken) {
      throw new Error('Lead service returned an unexpected response.');
    }

    localStorage.setItem(LS_KEYS.leadToken, res.leadToken);
    localStorage.setItem(LS_KEYS.leadEmail, email);

    $('#btnCalculate').disabled = false;
    $('#btnSave').disabled = false;
    $('#leadStatus').textContent = 'Lead created. Loading your pricing…';

    closeLeadModal();

    // Immediately price after gating
    await doPrice();
  } catch (err) {
    console.error(err);
    $('#leadStatus').textContent = `Lead error: ${err.message || err}`;
    $('#leadStatus').style.color = 'var(--danger)';
  }
}

// ======== Pricing Flow ========

async function doPrice() {
  const leadToken = localStorage.getItem(LS_KEYS.leadToken);
  if (!leadToken) {
    setStatus('Please submit the lead form to unlock pricing.', true);
    return;
  }
  const inputs = gatherInputs();

  // Basic inline validation
  if (inputs.loan <= 0 || inputs.fico < 300) {
    setStatus('Please check your loan amount and FICO.', true);
    return;
  }

  setStatus('Pricing…');
  toggleLoading(true);

  try {
    const data = await callPrice(inputs, leadToken);
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

// ======== Save Quote (Optional) ========

async function doSaveQuote() {
  const leadToken = localStorage.getItem(LS_KEYS.leadToken);
  if (!leadToken) {
    setStatus('Lead token missing. Please submit the lead form.', true);
    return;
  }
  const inputs = gatherInputs();

  setStatus('Saving quote…');
  toggleLoading(true);

  try {
    const payload = {
      leadToken,
      inputs,
      savedAt: nowStampMMDD_HHMM(),
      // Optionally include last results snapshot if you want richer history:
      // results: lastResultsCache
    };
    const res = await callSaveQuote(payload);
    if (!res || res.ok === false) throw new Error('Save failed.');
    setStatus('Saved.');
  } catch (err) {
    console.error(err);
    setStatus(`Save failed: ${err.message || err}`, true);
  } finally {
    toggleLoading(false);
  }
}

// ======== Wire Up ========

function initConfigUi() {
  $('#cfgRatesUrl').value = CONFIG.ratesUrl;
  $('#cfgPricingUrl').value = `${CONFIG.pricingBase}?action=price`;
  $('#cfgLeadsUrl').value = `${CONFIG.leadsBase}?[upsertLead|saveQuote]`;
  $('#cfgLlpaSheet').value = CONFIG.llpaSheetId;
  $('#cfgLeadsSheet').value = CONFIG.leadsSheetId;

  const versionChip = $('#versionChip');
  versionChip.textContent = `${CONFIG.versions.ui} • ${CONFIG.versions.pricing} • ${CONFIG.versions.rates}`;
  $('#footerVersion').textContent = CONFIG.versions.ui;
}

function initEvents() {
  // Program panel toggle
  $('#program').addEventListener('change', (e) => {
    showProgramPanel(e.target.value);
    if (hasLeadToken()) debouncedPrice();
  });

  // Input listeners: auto re‑price when leadToken exists
  [
    '#txn', '#termYears', '#loan', '#value', '#fico', '#borrowerPts', '#taxes', '#ins', '#hoa',
    '#pmiToggle', '#dtiOver45', '#twoPlusBorrowers',
    '#financeUfmip', '#annualMip',
    '#vaExempt', '#vaFirstUse',
    '#dscrRatio'
  ].forEach((sel) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('input', () => { if (hasLeadToken()) debouncedPrice(); });
    el.addEventListener('change', () => { if (hasLeadToken()) debouncedPrice(); });
  });

  // Gate actions
  $('#btnGetResults').addEventListener('click', openLeadModal);
  $('#btnCalculate').addEventListener('click', doPrice);
  $('#btnSave').addEventListener('click', doSaveQuote);

  // Lead modal
  $('#leadForm').addEventListener('submit', handleLeadSubmit);
  $('#leadCancel').addEventListener('click', closeLeadModal);

  // If token already present (returning user), enable buttons & auto price
  if (hasLeadToken()) {
    $('#btnCalculate').disabled = false;
    $('#btnSave').disabled = false;
    setStatus('Welcome back! Re‑pricing with your current inputs…');
    doPrice();
  }
}

// ======== Boot ========
window.addEventListener('DOMContentLoaded', async () => {
  initConfigUi();
  initEvents();
  showProgramPanel($('#program').value);
  preloadRates(); // non-blocking
});
