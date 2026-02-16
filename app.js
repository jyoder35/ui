// ======== Config (update these 3 URLs if they change) ========
const CONFIG = {
  versions: {
    ui: 'UI v0.1.0',
    pricing: 'Pricing v1.1.0',
    rates: 'Rates v1.3.0',
  },

  // WS‑1 (Rates): optional preload; Apps Script web app supports POST with text/plain
  ratesUrl:
    'https://script.google.com/macros/s/AKfycbxFUmGP213ag2uV4cey3V2ox0diofarpDKNt0szGrSajVpO8CF_paFN7u_R9cPa4Y3FwA/exec?action=rates&lpc=2.25',

  // WS‑2 (Pricing): we will call ?action=price
  pricingBase:
    'https://script.google.com/macros/s/AKfycbzM2epYNmWxxIP5Sp4Fnl1iz4tCcSf_lCVGb0Hm-0pQBaST8mb8EsQ-jVC6_5WIXZon/exec',

  // WS‑3 (Leads): we will call ?action=upsertLead and ?action=saveQuote
  leadsBase:
    'https://script.google.com/macros/s/AKfycbxBP3K11wYn-r6_98B3qsJUMI8yj8bKRX8gLFarQ_f5WEvEMSfXHQ9neg4RQJhTlnKv/exec',

  // Sheets (read-only in UI, for display only)
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
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

function nowStampMMDD_HHMM(d = new Date()) {
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function onlyDigits(s = '') {
  return String(s).replace(/\D+/g, '');
}
function normalizeZip5(z) {
  const digits = onlyDigits(z).slice(0, 5);
  return digits.padStart(5, '0'); // preserve leading zeros
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
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#ef4444' : 'var(--muted, #aab2d5)';
}

function toggleLoading(disabled) {
  const calc = $('#btnCalculate');
  const save = $('#btnSave');
  if (calc) calc.disabled = disabled || !hasLeadToken();
  if (save) save.disabled = disabled || !hasLeadToken();
}

function hasLeadToken() {
  return !!localStorage.getItem(LS_KEYS.leadToken);
}

// ======== API Helpers (diagnostic-friendly) ========
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

// Optional: preload rates (non-blocking)
async function preloadRates() {
  try {
    const res = await postTextJson(CONFIG.ratesUrl, {});
    console.debug('Rates preload:', res);
  } catch (e) {
    console.debug('Rates preload failed (non-blocking):', e.message);
  }
}

// ======== Input State & Program Panels ========
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
  $('#panelCONV')?.classList.toggle('hidden', program !== 'CONV30');
  $('#panelFHA')?.classList.toggle('hidden', program !== 'FHA30');
  $('#panelVA')?.classList.toggle('hidden', program !== 'VA30');
  $('#panelDSCR')?.classList.toggle('hidden', program !== 'DSCR30');
}

// ======== Rendering ========
function renderResults(data, inputs) {
  const el = $('#results');
  if (!el) return;

  if (!data || data.ok === false) {
    el.innerHTML = `<div class="placeholder">No results. ${
      data && data.message ? data.message : ''
    }</div>`;
    return;
  }

  const { noteRate, parRate, totalLoan, piMonthly, miMonthly, totalPayment, breakdown } = data;

  const programLabel =
    {
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
        <div>LTV: <strong>${(inputs.ltv || 0).toFixed(2)}%</strong></div>
        <div>FICO: <strong>${inputs.fico}</strong></div>
        <div>Borrower Pts: <strong>${inputs.borrowerPts.toFixed(3)}%</strong></div>
      </div>

      <div>
        <div>Par Rate: <strong>${
          parRate != null ? Number(parRate).toFixed(3) + '%' : '—'
        }</strong></div>
        <div>Note Rate: <strong>${
          noteRate != null ? Number(noteRate).toFixed(3) + '%' : '—'
        }</strong></div>
        <div>Total Loan: <strong>${fmtMoney(totalLoan)}</strong></div>
        <div>PI: <strong>${fmtMoney(piMonthly)}</strong></div>
        <div>MI: <strong>${fmtMoney(miMonthly)}</strong></div>
        <div>Total Pmt: <strong>${fmtMoney(totalPayment)}</strong></div>
      </div>
    </div>

    ${
      breakdown
        ? `<div style="margin-top:12px;">
             <h3>Breakdown</h3>
             <pre style="white-space:pre-wrap;">${JSON.stringify(breakdown, null, 2)}</pre>
           </div>`
        : ''
    }
  `;
}

function renderLastQuotedAt() {
  $('#lastQuoted').textContent = `Last quoted at ${nowStampMMDD_HHMM()}`;
}

// ======== Lead Gate: modal open/close & submit ========
function openLeadModal() {
  const dlg = $('#leadModal');
  if (!dlg) return;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.classList.remove('hidden');
}
function closeLeadModal() {
  const dlg = $('#leadModal');
  if (!dlg) return;
  if (typeof dlg.close === 'function') dlg.close();
  dlg.classList.add('hidden');
}

async function handleLeadSubmit(e) {
  e.preventDefault();
  const status = $('#leadStatus');
  if (status) {
    status.textContent = 'Creating lead…';
    status.style.color = 'var(--muted)';
  }

  const name = $('#leadName').value.trim();
  const email = $('#leadEmail').value.trim();
  const phone = $('#leadPhone').value.trim();
  const zip5 = normalizeZip5($('#leadZip').value);

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    status.textContent = 'Please enter a valid email.';
    status.style.color = '#ef4444';
    return;
  }
  if (!/^\d{5}$/.test(zip5)) {
    status.textContent = 'ZIP must be 5 digits.';
    status.style.color = '#ef4444';
    return;
  }

  try {
    const leadFields = {
      'Primary Borrower Name': name,
      'Primary Borrower Email': email,
      'Primary Borrower Phone': phone,
      'Subject ZIP': zip5,
      Source: 'UI-W4',
    };
    const res = await callUpsertLead(leadFields);
    if (!res || !res.ok || !res.leadToken) throw new Error('Unexpected lead response.');

    localStorage.setItem(LS_KEYS.leadToken, res.leadToken);
    localStorage.setItem(LS_KEYS.leadEmail, email);

    $('#btnCalculate').disabled = false;
    $('#btnSave').disabled = false;

    status.textContent = 'Lead created. Loading your pricing…';
    closeLeadModal();

    await doPrice(); // immediate first price
  } catch (err) {
    console.error(err);
    status.textContent = `Lead error: ${err.message || err}`;
    status.style.color = '#ef4444';
  }
}

// ======== Pricing & Save ========
async function doPrice() {
  const leadToken = localStorage.getItem(LS_KEYS.leadToken);
  if (!leadToken) {
    setStatus('Please submit the lead form to unlock pricing.', true);
    return;
  }

  const inputs = gatherInputs();
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

// ======== Wire up ========
function initConfigUi() {
  $('#cfgRatesUrl').value = CONFIG.ratesUrl;
  $('#cfgPricingUrl').value = `${CONFIG.pricingBase}?action=price`;
  $('#cfgLeadsUrl').value = `${CONFIG.leadsBase}?[upsertLead|saveQuote]`;
  $('#cfgLlpaSheet').value = CONFIG.llpaSheetId;
  $('#cfgLeadsSheet').value = CONFIG.leadsSheetId;

  const versionChip = $('#versionChip');
  if (versionChip) {
    versionChip.textContent = `${CONFIG.versions.ui} • ${CONFIG.versions.pricing} • ${CONFIG.versions.rates}`;
  }
  const footerVersion = $('#footerVersion');
  if (footerVersion) footerVersion.textContent = CONFIG.versions.ui;
}

function initEvents() {
  // Program panel switching
  $('#program').addEventListener('change', (e) => {
    showProgramPanel(e.target.value);
    if (hasLeadToken()) debouncedPrice();
  });

  // Auto‑reprice on changes (when gated)
  [
    '#txn',
    '#termYears',
    '#loan',
    '#value',
    '#fico',
    '#borrowerPts',
    '#taxes',
    '#ins',
    '#hoa',
    '#pmiToggle',
    '#dtiOver45',
    '#twoPlusBorrowers',
    '#financeUfmip',
    '#annualMip',
    '#vaExempt',
    '#vaFirstUse',
    '#dscrRatio',
  ].forEach((sel) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('input', () => {
      if (hasLeadToken()) debouncedPrice();
    });
    el.addEventListener('change', () => {
      if (hasLeadToken()) debouncedPrice();
    });
  });

  // Gate + actions
  $('#btnGetResults').addEventListener('click', openLeadModal);
  $('#btnCalculate').addEventListener('click', doPrice);
  $('#btnSave').addEventListener('click', doSaveQuote);

  // Lead modal
  $('#leadForm').addEventListener('submit', handleLeadSubmit);
  $('#leadCancel').addEventListener('click', closeLeadModal);

  // Returning user
  if (hasLeadToken()) {
    $('#btnCalculate').disabled = false;
    $('#btnSave').disabled = false;
    setStatus('Welcome back! Re‑pricing with your current inputs…');
    doPrice();
  }
}

// ======== Boot ========
window.addEventListener('DOMContentLoaded', () => {
  console.log('W4 UI booting…');
  initConfigUi();
  initEvents();
  showProgramPanel($('#program').value);
  preloadRates(); // optional, non-blocking
});
