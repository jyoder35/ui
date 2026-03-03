/* AZM – W4 UX pass 14
 - Require Loan Structure values before unlocking / pricing
 - Results panel hidden until unlock; toggle visible after gate success or if token present
 - Floating footer action bar (CSS handled)
 - Hide delta tiles unless borrower points !== 0.0
 - Keep prior logic: shaped curve response, memo cache, FICO bucketing, inverted delta colors, etc.
*/
const $ = (id) => document.getElementById(id);

/* ---------- Formatters ---------- */
const fmtUSD   = (n) => (isFinite(+n) ? "$" + Math.round(+n).toLocaleString() : "—");
const fmtUSD0  = (n) => (isFinite(+n) ? Math.round(+n).toLocaleString() : "—");
const fmtRate  = (r) => (isFinite(+r) ? (+r).toFixed(3).replace(/\.?0+$/,"") + "%" : "—");
const fmtMonthlyDelta = (n) => {
  if (!isFinite(+n)) return "—";
  const s = Math.round(Math.abs(n));
  return `${n >= 0 ? "+" : "−"}$${s.toLocaleString()}/mo`;
};
const fmtOneTimeDelta = (n) => {
  if (!isFinite(+n)) return "—";
  const s = Math.round(Math.abs(n));
  return `${n >= 0 ? "+" : "−"}$${s.toLocaleString()}`;
};
const nowStamp = () => {
  const d = new Date();
  return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

/* ---------- Status + Toast ---------- */
function showStatus(text, type=""){ const s=$("statusLine"); s.textContent=text; s.className="status"+(type?(" "+type):""); }
function toast(msg, type="info", timeout=2400){
  const host = $("toastHost");
  const div = document.createElement("div");
  div.className = `toast ${type}`;
  div.textContent = msg;
  host.appendChild(div);
  requestAnimationFrame(()=>div.classList.add("in"));
  setTimeout(()=>{ div.classList.remove("in"); setTimeout(()=>host.removeChild(div),240); }, timeout);
}

/* ---------- Endpoints ---------- */
const WS2_PRICE = "https://script.google.com/macros/s/AKfycbzM2epYNmWxxIP5Sp4Fnl1iz4tCcSf_lCVGb0Hm-0pQBaST8mb8EsQ-jVC6_5WIXZon/exec?action=price&curve=9&points=-1,-0.5,0,0.5,1,1.5,2,2.5,3&fields=core";
const WS3_LEADS = "https://script.google.com/macros/s/AKfycbxBP3K11wYn-r6_98B3qsJUMI8yj8bKRX8gLFarQ_f5WEvEMSfXHQ9neg4RQJhTlnKv/exec?action=upsertLead";
const WS3_SAVE  = "https://script.google.com/macros/s/AKfycbxBP3K11wYn-r6_98B3qsJUMI8yj8bKRX8gLFarQ_f5WEvEMSfXHQ9neg4RQJhTlnKv/exec?action=saveQuote";

/* ---------- Dev inspector ---------- */
let DEV_SHOW=false;
function setDev(show){ DEV_SHOW=!!show; $("devPayloads").open=DEV_SHOW; }
function setDevBlock(id,v){ $(id).textContent=(typeof v==="string")?v:JSON.stringify(v ?? "// none", null, 2); }
function captureDev(id,obj,trunc=0){ if(!DEV_SHOW) return; if(trunc && typeof obj==="string" && obj.length>trunc) setDevBlock(id,obj.slice(0,trunc)+"…"); else setDevBlock(id,obj); }

/* ---------- Tax/HOI tables ---------- */
const STATE_TAX_RATE_2023_PCT = {
  AL:0.375, AK:0.875, AZ:0.500, AR:0.500, CA:0.750, CO:0.500, CT:1.500, DE:0.500,
  FL:0.750, GA:0.750, HI:0.375, ID:0.500, IL:1.875, IN:0.750, IA:1.250, KS:1.250,
  KY:0.750, LA:0.500, ME:1.000, MD:0.875, MA:1.000, MI:1.125, MN:1.000, MS:0.625,
  MO:0.875, MT:0.625, NE:1.375, NV:0.500, NH:1.375, NJ:1.750, NM:0.625, NY:1.250,
  NC:0.625, ND:1.000, OH:1.250, OK:0.750, OR:0.750, PA:1.250, RI:1.000, SC:0.500,
  SD:1.000, TN:0.500, TX:1.375, UT:0.500, VT:1.375, VA:0.750, WA:0.750, WV:0.500,
  WI:1.250, WY:0.500, DC:0.625
};
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

/* ---------- ZIP gating ---------- */
const zipCache = new Map();
function normalizeZip(z){ const d=String(z??"").replace(/\D/g,""); return d.length>=5?d.slice(0,5):""; }
async function fetchZipInfo(zip){
  const z=normalizeZip(zip); if(!z) return null; if(zipCache.has(z)) return zipCache.get(z);
  try{
    const res=await fetch(`https://api.zippopotam.us/us/${z}`,{cache:"no-store"});
    if(!res.ok) return null;
    const data=await res.json();
    const p=data?.places?.[0];
    const info={ abbr:p?.["state abbreviation"], state:p?.["state"], city:p?.["place name"]??"" };
    if(!info.abbr || !info.state) return null;
    zipCache.set(z, info); return info;
  }catch{ return null; }
}
let stateAbbr="AZ", stateName="Arizona", cityName="";
let zipResolved=false;

/* ---------- Helpers ---------- */
function setZipMsg(type,text){ const el=$("zipMsg"); if(!text){ el.style.display="none"; el.textContent=""; el.className="msg"; return; } el.className="msg "+(type==="warn"?"bad":"ok"); el.textContent=text; el.style.display="block"; }
function setGateEnabled(en){ $("btnGate").disabled=!en; }
function clamp(n, lo, hi){ n=Number(n); if(!isFinite(n)) return lo; return Math.max(lo, Math.min(hi, n)); }
function estimateAnnualTaxes(v, pct){ const x=Number(v), r=Number(pct); if(!isFinite(x)||x<=0||!isFinite(r)||r<=0) return 0; return x*(r/100); }
function computeDefaultHOI(v){
  const base = HOI_2022[stateName] ?? HOI_2022["Arizona"] ?? 0;
  const scaled = base * (Number(v||0) / HOI_BASE_COVERAGE);
  return Math.round((scaled||0)/25)*25;
}
function seedTaxesInsFromState(){
  const pct = STATE_TAX_RATE_2023_PCT[stateAbbr] ?? STATE_TAX_RATE_2023_PCT["AZ"];
  const v = Number($("value").value || 0);
  if (pct && v) $("taxes").value = String(Math.round(estimateAnnualTaxes(v, pct)));
  $("ins").value = String(computeDefaultHOI(v));
}

/* ---------- Program/Txn/Term ---------- */
function currentProgKind(){ return $("program").value || "CONV"; }
function backendProgram(){ return ({ CONV:"CONV30", FHA:"FHA30", VA:"VA30", DSCR:"DSCR30" })[currentProgKind()] || "CONV30"; }
function rebuildTxnOptions(){
  const prog=currentProgKind();
  const el=$("txn"); const keep=el.value;
  el.innerHTML="";
  const add=(v,t)=>{ const o=document.createElement("option"); o.value=v; o.textContent=t; el.appendChild(o); };
  add("PURCHASE","Purchase");
  add("REFI","Refinance");
  add("CASHOUT","Cash‑Out");
  if(prog==="VA") add("IRRRL","VA IRRRL (Streamline)");
  if(prog==="FHA") add("FHA_STREAMLINE","FHA Streamline");
  el.value = Array.from(el.options).some(o=>o.value===keep) ? keep : "PURCHASE";
}

/* ---------- Program options ---------- */
function pillCheckbox(id, label, checked){
  const labelEl=document.createElement("label");
  labelEl.className="pill";
  const i=document.createElement("input");
  i.type="checkbox"; i.id=id; i.checked=!!checked;
  const s=document.createElement("span"); s.textContent=label;
  labelEl.appendChild(i); labelEl.appendChild(s);
  return labelEl;
}
function renderProgFactors(){
  const wrap=$("progFactors");
  wrap.innerHTML="";
  const kind=currentProgKind();
  const txn=$("txn").value;
  $("dscrWrap").style.display="none";
  if(kind==="CONV"){
    if(txn==="PURCHASE"){
      wrap.appendChild(pillCheckbox("pmiToggle","Include PMI",true));
      wrap.appendChild(pillCheckbox("dtiOver45","DTI > 45%",false));
      wrap.appendChild(pillCheckbox("twoPlusBorrowers","2+ Borrowers",false));
      wrap.appendChild(pillCheckbox("firstTimeBuyer","First‑Time Homebuyer",false));
    }else if(txn==="REFI"){
      wrap.appendChild(pillCheckbox("pmiToggle","Include PMI",true));
      wrap.appendChild(pillCheckbox("dtiOver45","DTI > 45%",false));
      wrap.appendChild(pillCheckbox("twoPlusBorrowers","2+ Borrowers",false));
    }else if(txn==="CASHOUT"){
      wrap.appendChild(pillCheckbox("dtiOver45","DTI > 45%",false));
    }
  }else if(kind==="FHA" && txn==="PURCHASE"){
    wrap.appendChild(pillCheckbox("firstTimeBuyer","First‑Time Homebuyer",false));
  }else if(kind==="VA"){
    wrap.appendChild(pillCheckbox("vaExempt","Funding Fee Exempt",false));
    wrap.appendChild(pillCheckbox("vaFirstUse","First‑Use",true));
  }else if(kind==="DSCR"){
    wrap.appendChild(pillCheckbox("firstTimeBuyer","First‑Time Homebuyer",false));
    $("dscrWrap").style.display="";
  }
  ["pmiToggle","dtiOver45","twoPlusBorrowers","vaExempt","vaFirstUse"].forEach(id=>{
    if ($(id)) $(id).addEventListener("change", ()=>{ renderLoanLine(); maybeReprice(); });
  });
  if ($("firstTimeBuyer")){
    $("firstTimeBuyer").addEventListener("change", ()=>{
      const isConvPurchase = currentProgKind()==="CONV" && $("txn").value==="PURCHASE";
      if (isConvPurchase && !$("firstTimeBuyer").checked){
        let ltv=Number($("ltv").value||0);
        if (ltv > 95){
          $("ltv").value="95";
          syncFromLtvCore();
          showConvPurchaseCapMsg();
        }
      }
      maybeReprice();
    });
  }
}

/* ---------- Labels & helper notes ---------- */
function updateProgramPanels(){
  const txn=$("txn").value;
  if (txn==="PURCHASE"){
    $("valueLabel").textContent="Purchase Price ($)";
    $("equityLabel").textContent="Down Payment ($)";
    $("structureTitle").textContent="Purchase Structure";
  } else {
    $("valueLabel").textContent="Property Value ($)";
    $("equityLabel").textContent="Equity ($)";
    $("structureTitle").textContent="Loan Structure";
  }
  renderProgFactors();
  renderHelperNotes();
}

/* ---------- LTV sync ---------- */
let syncLock=false;
function parseNum(el){ const n=parseFloat(el.value); return Number.isFinite(n)?n:null; }
function getMaxLTV(){
  const kind=currentProgKind();
  const txn=$("txn").value;
  const fthb=$("firstTimeBuyer")?.checked || false;
  if(txn==="CASHOUT"){
    if(kind==="VA") return 90;
    if(kind==="CONV"||kind==="FHA") return 80;
    return 80;
  }
  if(txn==="PURCHASE"){
    if(kind==="FHA") return 96.5;
    if(kind==="VA") return 100;
    if(kind==="CONV")return fthb?97:95;
    return 80;
  }
  if(txn==="IRRRL") return 100;
  if(txn==="FHA_STREAMLINE") return 100;
  if(txn==="REFI"){
    if(kind==="VA") return 100;
    if(kind==="FHA") return 97;
    if(kind==="CONV")return 97;
    return 80;
  }
}
function showConvPurchaseCapMsg(){
  showMsg("ltvMsg","LTV capped at 95% for CONV PURCHASE unless First‑Time Homebuyer is selected.");
}
function showMsg(id,text){ const el=$(id); if(!text){ el.style.display="none"; el.textContent=""; return; } el.textContent=text; el.style.display="block"; }
function applyLtvCap(ltv){
  const kind=currentProgKind(), txn=$("txn").value;
  const max=getMaxLTV();
  let out=ltv;
  if(Number.isFinite(ltv) && Number.isFinite(max) && ltv>max){
    out=max;
    if(kind==="CONV" && txn==="PURCHASE" && !($("firstTimeBuyer")?.checked))
      showConvPurchaseCapMsg();
    else
      showMsg("ltvMsg",`LTV capped at ${max}% for ${kind} ${txn}.`);
  }else{
    showMsg("ltvMsg","");
  }
  if(Number.isFinite(out)) $("ltv").value=String(Math.round(out*1000)/1000);
  return out;
}
function recomputeFromValue(){
  const v=parseNum($("value")); if(!Number.isFinite(v)||v<=0) return;
  let ltv=parseNum($("ltv")); if(!Number.isFinite(ltv)) return;
  ltv=applyLtvCap(ltv);
  const loan=Math.round(v*(ltv/100)); const eq=Math.round(v-loan);
  $("loan").value=String(loan); $("equity").value=String(eq);
}
function recomputeFromLtv(){
  const v=parseNum($("value")); let ltv=parseNum($("ltv"));
  if(!Number.isFinite(v)||v<=0||!Number.isFinite(ltv)) return;
  ltv=applyLtvCap(ltv);
  const loan=Math.round(v*(ltv/100)); const eq=Math.round(v-loan);
  $("loan").value=String(loan); $("equity").value=String(eq);
}
function recomputeFromLoan(){
  const v=parseNum($("value")), loan=parseNum($("loan"));
  if(!Number.isFinite(v)||v<=0||!Number.isFinite(loan)) return;
  let ltv=(loan/v)*100; ltv=applyLtvCap(ltv);
  const adj=Math.round(v*(ltv/100)); const eq=Math.round(v-adj);
  $("loan").value=String(adj); $("equity").value=String(eq);
}
function recomputeFromEquity(){
  const v=parseNum($("value")), eq=parseNum($("equity"));
  if(!Number.isFinite(v)||v<=0||!Number.isFinite(eq)) return;
  let loan=Math.round(v-eq); if(loan<0) loan=0;
  let ltv=(loan/v)*100; ltv=applyLtvCap(ltv);
  const adj=Math.round(v*(ltv/100));
  $("loan").value=String(adj); $("ltv").value=String(Math.round(ltv*1000)/1000);
}
function enforceLtvOnContextChange(){
  if(syncLock) return; syncLock=true;
  const v=parseNum($("value"));
  if(Number.isFinite(v)&&v>0){ recomputeFromLtv(); }
  syncLock=false; renderLoanLine();
}
function syncFromLtvCore(){ if(syncLock) return; syncLock=true; recomputeFromLtv(); renderLoanLine(); syncLock=false; markCoreDirty(); }

/* ---------- FHA/VA financed loan (UI mirror) ---------- */
const FHA_UFMIP_PCT = 1.75;
function vaFFPct_UI(firstUse,exempt,downPct,irrrl){
  if(exempt) return 0;
  if(irrrl) return 0.5;
  if(downPct>=10) return 1.25;
  if(downPct>=5)  return 1.50;
  return firstUse ? 2.15 : 3.30;
}
function computeFinancedLoan(baseLoan){
  const kind=currentProgKind(), txn=$("txn").value;
  let loanCalc=baseLoan;
  if(kind==="FHA"){
    loanCalc = Math.round(baseLoan + baseLoan*(FHA_UFMIP_PCT/100));
  } else if(kind==="VA"){
    const exempt=$("vaExempt")?.checked||false;
    const first=$("vaFirstUse")?.checked||false;
    const downPct=Math.max(0,100-Number($("ltv").value||0));
    const irrrl=(txn==="IRRRL");
    const ffPct=vaFFPct_UI(first,exempt,downPct,irrrl);
    loanCalc = Math.round(baseLoan + baseLoan*(ffPct/100));
  }
  return loanCalc;
}
function renderLoanLine(){
  const base=Number($("loan").value||0); if(!isFinite(base)||base<=0){ $("loanLine").textContent=""; return; }
  const calc=computeFinancedLoan(base);
  $("loanLine").textContent = (calc!==base)
    ? `Base Loan: $${fmtUSD0(base)} • Financed Loan (est.): $${fmtUSD0(calc)}`
    : `Base Loan: $${fmtUSD0(base)}`;
}
function renderHelperNotes(){
  const kind=currentProgKind(), txn=$("txn").value;
  let msg="";
  if(kind==="FHA"){
    msg="FHA: UFMIP (1.75%) is financed automatically; Annual MIP set to 0.55%.";
  }else if(kind==="VA"){
    msg=(txn==="IRRRL")
      ? "VA IRRRL: Funding Fee 0.50% is financed automatically unless exempt."
      : "VA: Funding Fee financed automatically unless exempt; % varies by first‑use and down payment.";
  } else {
    msg="";
  }
  $("helperNotes").textContent=msg;
}

/* ---------- Loan Structure completeness ---------- */
function loanStructureComplete(){
  const v = Number($("value").value);
  const ltv = Number($("ltv").value);
  const loan = Number($("loan").value);
  const eq = Number($("equity").value);
  const ok = isFinite(v) && v>0 &&
             isFinite(ltv) && ltv>0 &&
             isFinite(loan) && loan>0 &&
             isFinite(eq) && eq>=0;
  const msg = $("loanStructMsg");
  if (!ok){
    msg.textContent = "Enter valid numbers for Value, LTV, Loan Amount, and Equity.";
    msg.style.display = "block";
  } else {
    msg.style.display = "none";
    msg.textContent = "";
  }
  return ok;
}
function refreshUnlockButton(){
  const enabled = zipResolved && loanStructureComplete();
  setGateEnabled(enabled);
}

/* ---------- Pricing pipeline: state ---------- */
let leadToken=localStorage.getItem("azm_leadToken")||"", lastQuote=null, lastQuotePar=null, gated=!!leadToken;
let lastParSig=null;
let lastPricedFicoBucket=null, lastProgramForBucket=null;
let debounceTimer=null, priceCallSeq=0;
let coreDirty=false;
let priceController = null;
let leadController  = null;

function setRecalcState(){
  $("btnRecalc").disabled = !(gated && coreDirty);
  $("recalcDot").style.visibility = (gated && coreDirty) ? "visible" : "hidden";
}
function markCoreDirty(){
  coreDirty = true;
  setRecalcState();
  showStatus("Pending changes — click Re‑Calculate to update pricing.", "info");
}
function toggleResultsVisibility(show){
  $("resultsPanel").style.display = show ? "" : "none";
}

/* ---------- FICO bucketing & effective pricing FICO ---------- */
function ficoBucketKey(programUI, entered){
  const f = Number(entered||0);
  if(programUI==="CONV"){
    if (f <= 639) return "CONV-620-639";
    if (f >= 780) return "CONV-780+";
    const start = 620 + 20*Math.floor((f-620)/20);
    const end = start+19;
    return `CONV-${start}-${end}`;
  } else if(programUI==="FHA" || programUI==="VA"){
    if (f <= 579) return "FHAVA-580-599";
    if (f >= 700) return "FHAVA-700+";
    const start = 580 + 20*Math.floor((f-580)/20);
    const end = start+19;
    return `FHAVA-${start}-${end}`;
  }
  return `GEN-${Math.round(f)}`;
}
function effectiveFicoForPricing(programUI, entered){
  const f = Number(entered||0);
  if(programUI==="CONV"){
    if (f < 620) return 620;
    if (f > 850) return 850;
    return f;
  } else if(programUI==="FHA" || programUI==="VA"){
    if (f < 580) return 580;
    if (f > 850) return 850;
    return f;
  }
  return Math.max(300, Math.min(850, f));
}
function updateFicoFloorMessage(programUI, entered){
  const msgEl = $("ficoMsg");
  msgEl.style.display = "none"; msgEl.textContent = ""; $("fico").classList.remove("input-error");
  if(programUI==="CONV" && Number(entered)<620){
    msgEl.textContent = "Pricing requested with 620 Conv minimum credit score.";
    msgEl.style.display = "block";
  }
}

/* ---------- Inputs & signatures ---------- */
function currentInputs(){
  const programUI=$("program").value;
  const program=backendProgram();
  const txn=$("txn").value;
  const term=360;

  const baseLoan=Number($("loan").value || 0);
  const ltv=Number($("ltv").value || 0);

  const enteredFico = clamp($("fico").value, 300, 850);
  const pricingFico = effectiveFicoForPricing(programUI, enteredFico);
  updateFicoFloorMessage(programUI, $("fico").value);

  // Borrower Points (0.5 steps)
  let borrowerPts = Number($("points").value);
  if(!isFinite(borrowerPts)) borrowerPts = 0;
  borrowerPts = Math.max(-1, Math.min(3, Math.round(borrowerPts*2)/2));
  $("points").value = String(borrowerPts);
  $("pointsRange").value = String(borrowerPts);
  $("pointsChip").textContent = `${borrowerPts.toFixed(1)}%`;

  const taxes=Number($("taxes").value || 0);
  const ins=Number($("ins").value || 0);
  const hoa=Number($("hoa").value || 0);
  const pmiToggle=$("pmiToggle")?.checked ?? false;
  const dtiOver45=$("dtiOver45")?.checked ?? false;
  const twoPlusBorrowers=$("twoPlusBorrowers")?.checked ?? false;
  const firstTimeBuyer=$("firstTimeBuyer")?.checked ?? false;
  const vaExempt=$("vaExempt")?.checked ?? false;
  const vaFirstUse=$("vaFirstUse")?.checked ?? false;
  const dscrRatio=Number($("dscrRatio")?.value || 1.25);
  const loanCalc=computeFinancedLoan(baseLoan);
  const fha = (program.startsWith("FHA")) ? { financeUfmip: true, annualMip: 0.55 } : undefined;
  const va  = (program.startsWith("VA"))  ? { exempt: vaExempt, firstUse: vaFirstUse } : undefined;

  return {
    program, programUI, txn, term,
    loan: baseLoan, loanCalc, ltv,
    fico: pricingFico, ficoEntered: enteredFico,
    borrowerPts,
    taxes, ins, hoa,
    pmiToggle, dtiOver45, twoPlusBorrowers, firstTimeBuyer,
    fha, va,
    dscrRatio
  };
}
function parSignatureFrom(inputs){
  return JSON.stringify({
    program: inputs.program,
    txn: inputs.txn,
    term: inputs.term,
    loan: inputs.loan,
    ltv: inputs.ltv,
    fico: inputs.fico,
    pmiToggle: inputs.pmiToggle,
    dtiOver45: inputs.dtiOver45,
    twoPlusBorrowers: inputs.twoPlusBorrowers,
    firstTimeBuyer: inputs.firstTimeBuyer,
    fha: inputs.fha,
    va: inputs.va,
    dscrRatio: inputs.dscrRatio
  });
}
function selSignatureFrom(inputs){
  return JSON.stringify({
    program: inputs.program,
    txn: inputs.txn,
    term: inputs.term,
    loan: inputs.loan,
    ltv: inputs.ltv,
    fico: inputs.fico,
    borrowerPts: inputs.borrowerPts,
    pmiToggle: inputs.pmiToggle,
    dtiOver45: inputs.dtiOver45,
    twoPlusBorrowers: inputs.twoPlusBorrowers,
    firstTimeBuyer: inputs.firstTimeBuyer,
    fha: inputs.fha,
    va: inputs.va,
    dscrRatio: inputs.dscrRatio
  });
}

/* ---------- Client memoization ---------- */
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const priceCache = new Map();
function cacheGet(key){
  const e = priceCache.get(key);
  if(!e) return null;
  if(Date.now() - e.ts > PRICE_CACHE_TTL_MS){ priceCache.delete(key); return null; }
  return e.data;
}
function cacheSet(key, data){ priceCache.set(key, { ts: Date.now(), data }); }

/* ---------- Results rendering ---------- */
function monthly(n){ return isFinite(+n) ? Math.round(+n/12) : 0; }
function housingTotal(pi, mi, taxesM, insM, hoaM){ return (Number(pi)||0)+(Number(mi)||0)+(Number(taxesM)||0)+(Number(insM)||0)+(Number(hoaM)||0); }

function renderKPIs(quoteWith){
  const rate = quoteWith?.noteRate;
  const total = (Number(quoteWith?.piMonthly)||0) + (Number(quoteWith?.miMonthly)||0); // PI + MI only
  $("kpiRate").textContent  = fmtRate(rate);
  $("kpiTotal").textContent = fmtUSD(total);
  $("lastQuoted").textContent = `Last quoted at ${nowStamp()}`;
}
function fillCard(prefix, {loanCalc, rate, pi, mi, taxesM, insM, hoaM}){
  const totalHousing = housingTotal(pi, mi, taxesM, insM, hoaM);
  $(`${prefix}_loanCalc`).textContent = fmtUSD(loanCalc);
  $(`${prefix}_rate`).textContent     = fmtRate(rate);
  $(`${prefix}_housing`).textContent  = fmtUSD(totalHousing);
  $(`${prefix}_pi`).textContent       = fmtUSD(pi);
  $(`${prefix}_mi`).textContent       = fmtUSD(mi);
  $(`${prefix}_taxes`).textContent    = fmtUSD(taxesM);
  $(`${prefix}_ins`).textContent      = fmtUSD(insM);
  $(`${prefix}_hoa`).textContent      = fmtUSD(hoaM);
}
function computeCardData(quote, inputs){
  return {
    loanCalc: inputs.loanCalc,
    rate: quote?.noteRate,
    pi: quote?.piMonthly,
    mi: quote?.miMonthly,
    taxesM: monthly(inputs.taxes),
    insM: monthly(inputs.ins),
    hoaM: monthly(inputs.hoa)
  };
}
function rateCost(baseLoan, pts){ return Math.round((Number(baseLoan)||0) * ((Number(pts)||0)/100)); }
function renderDelta(quoteWith, quotePar, inputs){
  const deltaRow = $("resultsDelta");
  if (Number(inputs.borrowerPts) === 0){
    // Hide deltas when points = 0%
    deltaRow.style.display = "none";
    $("delta_payment").textContent = "—";
    $("delta_rateCost").textContent = "—";
    $("delta_payment").classList.remove("delta-pos","delta-neg");
    $("delta_rateCost").classList.remove("delta-pos","delta-neg");
    return;
  }
  deltaRow.style.display = "";

  const piw = Number(quoteWith?.piMonthly), miw = Number(quoteWith?.miMonthly);
  const pip = Number(quotePar ?.piMonthly), mip = Number(quotePar ?.miMonthly);
  const diffPay  = (isFinite(piw)&&isFinite(miw)&&isFinite(pip)&&isFinite(mip)) ? Math.round((piw+miw) - (pip+mip)) : NaN;
  const diffCost = rateCost(inputs.loan, inputs.borrowerPts) - 0;

  const elPay  = $("delta_payment");
  const elCost = $("delta_rateCost");
  elPay.textContent  = fmtMonthlyDelta(diffPay);
  elCost.textContent = fmtOneTimeDelta(diffCost);

  elPay.classList.remove("delta-pos","delta-neg");
  elCost.classList.remove("delta-pos","delta-neg");
  if (isFinite(diffPay))  { elPay.classList.add(diffPay  < 0 ? "delta-pos" : "delta-neg"); }
  if (isFinite(diffCost)) { elCost.classList.add(diffCost < 0 ? "delta-pos" : "delta-neg"); }
}

/* ---------- Validation ---------- */
function validateBeforePrice(){
  // Must have Loan Structure complete as well
  if (!loanStructureComplete()){ return false; }
  const kind=currentProgKind();
  const dscr=Number($("dscrRatio")?.value||1.25);
  if(kind==="DSCR" && (!isFinite(dscr)||dscr<0.75)){ showMsg("dscrMsg","DSCR should be at least 0.75."); return false; } else showMsg("dscrMsg","");
  const ltv=Number($("ltv").value);
  if(!isFinite(ltv)||ltv<0){ showMsg("ltvMsg","Enter a valid LTV."); return false; }
  const entered = Number($("fico").value);
  if(!isFinite(entered) || entered<300 || entered>850){
    $("ficoMsg").textContent = "Enter a valid FICO between 300 and 850.";
    $("ficoMsg").style.display = "block";
    $("fico").classList.add("input-error");
    return false;
  }
  $("fico").classList.remove("input-error");
  return true;
}

/* ---------- Pricing (shaped response + cache + fallback) ---------- */
async function priceNow(){
  if(!gated||!leadToken){ showStatus("Pricing ready — click Get My Results to review.","info"); return; }
  if(!validateBeforePrice()) return;

  const mySeq=++priceCallSeq;
  if (priceController) priceController.abort();
  priceController = new AbortController();

  const inputs = currentInputs();
  const selSig = selSignatureFrom(inputs);
  const parSig = parSignatureFrom(inputs);
  const selKey = "sel|" + selSig;
  const parKey = "par|" + parSig;

  $("btnSave").disabled=true;
  coreDirty=false; setRecalcState();

  let quoteWith = cacheGet(selKey);
  if(quoteWith){
    renderKPIs(quoteWith);
    fillCard("with", computeCardData(quoteWith, inputs));
    showStatus("Loaded cached results. Getting Par Price…","ok");
  }else{
    showStatus("Pricing…","info");
  }

  try{
    if(!quoteWith){
      const payloadSel = { payload:{ inputs, leadToken } };
      captureDev("devPriceReq", payloadSel);
      const resSel = await fetch(WS2_PRICE,{
        method:"POST",
        headers:{ "Content-Type":"text/plain" },
        body: JSON.stringify(payloadSel),
        signal: priceController.signal
      });
      const textSel = await resSel.text();
      if(mySeq!==priceCallSeq) return;
      captureDev("devPriceRes", textSel, 2000);

      let data; try{ data = JSON.parse(textSel); }catch{
        showStatus(`Pricing response not JSON (HTTP ${resSel.status} ${resSel.statusText})`,"error");
        toast("Pricing failed (non‑JSON)","error"); return;
      }
      if(data?.error && !data?.ok){
        showStatus(`Pricing error: ${data.error}`,"error"); toast("Pricing error","error"); return;
      }

      if (data?.quotes && data?.context){
        const q = data.quotes || {};
        const ptsList = [-1,-0.5,0,0.5,1,1.5,2,2.5,3];
        ptsList.forEach(pt=>{
          if(q[String(pt)]){
            const cloneInputs = { ...inputs, borrowerPts: pt };
            const key = "sel|" + selSignatureFrom(cloneInputs);
            cacheSet(key, q[String(pt)]);
          }
        });
        if(q["0"]) cacheSet(parKey, q["0"]);
        lastQuotePar = q["0"];
        lastParSig   = parSig;

        quoteWith = q[String(inputs.borrowerPts)] ?? q["0"];
        cacheSet(selKey, quoteWith);
        lastQuote = quoteWith;

        renderKPIs(quoteWith);
        fillCard("with", computeCardData(quoteWith, inputs));

        const parInputsForUI = { ...inputs, borrowerPts: 0, loanCalc: computeFinancedLoan(inputs.loan) };
        fillCard("par", computeCardData(q["0"], parInputsForUI));
        renderDelta(quoteWith, q["0"], inputs);

        $("btnSave").disabled=false;
        showStatus("Priced successfully.","ok");
        toast("Pricing complete","success");

        lastPricedFicoBucket = ficoBucketKey(inputs.programUI, inputs.ficoEntered);
        lastProgramForBucket = inputs.programUI;
        return;
      }

      // Non-shaped fallback
      quoteWith = data;
      cacheSet(selKey, quoteWith);
      lastQuote = quoteWith;

      renderKPIs(quoteWith);
      fillCard("with", computeCardData(quoteWith, inputs));
      $("btnSave").disabled=false;
      showStatus("Priced successfully. Getting Par Price…","ok");
    }

    // Par from cache?
    let quotePar = cacheGet(parKey);
    const onlyPointsChanged = (lastParSig === parSig) && !!lastQuotePar;

    if(quotePar){
      const parInputsForUI = { ...inputs, borrowerPts: 0, loanCalc: computeFinancedLoan(inputs.loan) };
      fillCard("par", computeCardData(quotePar, parInputsForUI));
      renderDelta(quoteWith, quotePar, inputs);
      showStatus("Priced successfully.","ok");
      toast("Pricing complete","success");
      lastQuotePar = quotePar;
      lastParSig   = parSig;

      lastPricedFicoBucket = ficoBucketKey(inputs.programUI, inputs.ficoEntered);
      lastProgramForBucket = inputs.programUI;
      return;
    }

    if(onlyPointsChanged){
      const parInputsForUI = { ...inputs, borrowerPts: 0, loanCalc: computeFinancedLoan(inputs.loan) };
      fillCard("par", computeCardData(lastQuotePar, parInputsForUI));
      renderDelta(quoteWith, lastQuotePar, inputs);
      showStatus("Priced successfully.","ok");
      toast("Pricing complete","success");
      cacheSet(parKey, lastQuotePar);

      lastPricedFicoBucket = ficoBucketKey(inputs.programUI, inputs.ficoEntered);
      lastProgramForBucket = inputs.programUI;
      return;
    }

    // Legacy Par fetch
    const parInputs = { ...inputs, borrowerPts: 0 };
    parInputs.loanCalc = computeFinancedLoan(parInputs.loan);
    const payloadPar = { payload:{ inputs: parInputs, leadToken } };
    captureDev("devPriceReqPar", payloadPar);

    const resPar = await fetch(WS2_PRICE,{
      method:"POST",
      headers:{ "Content-Type":"text/plain" },
      body: JSON.stringify(payloadPar),
      signal: priceController.signal
    });
    const textPar = await resPar.text();
    if(mySeq!==priceCallSeq) return;
    captureDev("devPriceResPar", textPar, 2000);

    try{ quotePar = JSON.parse(textPar); }catch{
      showStatus(`Par Price response not JSON (HTTP ${resPar.status} ${resPar.statusText})`,"warn");
      toast("Par Price failed (non‑JSON)","warn");
      return;
    }
    if(quotePar?.error && !quotePar?.ok){
      showStatus(`Par Price error: ${quotePar.error}`,"warn");
      toast("Par Price error","warn");
      return;
    }

    cacheSet(parKey, quotePar);
    lastQuotePar = quotePar;
    lastParSig   = parSig;

    const parInputsForUI = { ...inputs, borrowerPts: 0, loanCalc: computeFinancedLoan(inputs.loan) };
    fillCard("par", computeCardData(quotePar, parInputsForUI));
    renderDelta(quoteWith, quotePar, inputs);

    showStatus("Priced successfully.","ok");
    toast("Pricing complete","success");

    lastPricedFicoBucket = ficoBucketKey(inputs.programUI, inputs.ficoEntered);
    lastProgramForBucket = inputs.programUI;
  }catch(err){
    if (err?.name === "AbortError") return;
    showStatus(`Pricing failed: ${err?.message || "Network error"}`,"error");
    toast("Pricing failed (network)","error");
  }
}

function maybeReprice(){
  if(!gated || coreDirty) return;
  clearTimeout(debounceTimer);
  debounceTimer=setTimeout(priceNow, 220);
}

/* ---------- Save Quote ---------- */
async function saveQuote(){
  if(!gated||!leadToken||!lastQuote){ showStatus("Nothing to save yet.","warn"); toast("Nothing to save yet","warn"); return; }
  const inputs=currentInputs();
  const token = localStorage.getItem("azm_leadToken") || leadToken || "";
  if(!token){ showStatus("Token missing. Please complete the gate again.","warn"); toast("Token missing","warn"); return; }
  const payload={ payload:{ leadToken: token, inputs: { ...inputs, leadToken: token }, quote:lastQuote, savedAt: nowStamp(), source:"UI-W4", subjectZip: normalizeZip($("zip").value) } };
  $("btnSave").disabled=true; showStatus("Saving quote…","info"); captureDev("devSaveReq", payload);
  try{
    const res=await fetch(WS3_SAVE,{ method:"POST", headers:{ "Content-Type":"text/plain" }, body: JSON.stringify(payload) });
    const text=await res.text(); captureDev("devSaveRes", text, 2000);
    let data; try{ data=JSON.parse(text); }catch{ showStatus(`Save: non‑JSON (HTTP ${res.status} ${res.statusText}). Body[0..300]: ${text.slice(0,300)}`,"error"); toast("Save failed (non‑JSON)","error"); $("btnSave").disabled=false; return; }
    if(!data?.ok){ showStatus(data?.error || `Save failed (HTTP ${res.status} ${res.statusText}).`,"error"); toast("Save failed","error"); $("btnSave").disabled=false; return; }
    showStatus("Quote saved.","ok"); toast("Quote saved","success"); $("btnSave").disabled=false;
  }catch(err){
    showStatus(`Save error: ${err?.message || "Network error"}`,"error"); toast("Save error (network)","error"); $("btnSave").disabled=false;
  }
}

/* ---------- Lead modal ---------- */
function openLeadModal(){
  // Require Loan Structure + ZIP before opening
  if (!zipResolved || !loanStructureComplete()){
    toast("Please complete Property ZIP and Loan Structure first.","warn");
    refreshUnlockButton();
    return;
  }
  $("leadModal").setAttribute("aria-hidden","false"); clearLeadErrors(); $("leadFirst").focus();
}
function closeLeadModal(){ $("leadModal").setAttribute("aria-hidden","true"); }
function clearLeadErrors(){
  ["leadFirstErr","leadLastErr","leadPhoneErr","leadEmailErr","leadTimelineErr","leadErr"].forEach(id=>{ const el=$(id); el.style.display="none"; el.textContent=""; });
}
function digitsOnlyPhone(raw){ return String(raw||"").replace(/\D/g,""); }
function isClearlyFakePhone(d10){
  if (d10.length !== 10) return true;
  const allSame = /^(\d)\1{9}$/.test(d10);
  if (allSame) return true;
  if (d10 === "1234567890") return true;
  const area = d10.slice(0,3), exch = d10.slice(3,6);
  const invalidArea = area === "000" || area === "555";
  const invalidExch = exch === "000" || exch === "555";
  if (invalidArea || invalidExch) return true;
  return false;
}
function validateLeadInputs(){
  clearLeadErrors();
  const first = $("leadFirst").value.trim();
  const last = $("leadLast").value.trim();
  const phone = $("leadPhone").value.trim();
  const email = $("leadEmail").value.trim();
  const timeline = $("leadTimeline").value;
  let ok = true;
  const nameRe = /^[A-Za-z][A-Za-z' -]{1,}$/;
  if (!nameRe.test(first)){ $("leadFirstErr").textContent="Please enter at least 2 letters."; $("leadFirstErr").style.display="block"; ok=false; }
  if (!nameRe.test(last)){ $("leadLastErr").textContent="Please enter at least 2 letters."; $("leadLastErr").style.display="block"; ok=false; }
  const phoneRe = /^\s*(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\s*$/;
  if (!phoneRe.test(phone)){
    $("leadPhoneErr").textContent="Enter a valid 10‑digit phone (US/Canada).";
    $("leadPhoneErr").style.display="block"; ok=false;
  } else {
    const d = digitsOnlyPhone(phone);
    if (isClearlyFakePhone(d)){
      $("leadPhoneErr").textContent="Please enter a real mobile/phone number (not a placeholder like 555‑555‑5555).";
      $("leadPhoneErr").style.display="block"; ok=false;
    }
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRe.test(email)){ $("leadEmailErr").textContent="Enter a valid email address."; $("leadEmailErr").style.display="block"; ok=false; }
  if (!timeline){ $("leadTimelineErr").textContent="Please select a timeline."; $("leadTimelineErr").style.display="block"; ok=false; }
  return { ok, first, last, phone, email, timeline };
}
async function upsertLead(){
  const v = validateLeadInputs();
  if (!v.ok) return false;
  const textOk = $("leadTextOK").checked;
  const payload = { payload: {
    first: v.first, last: v.last, phone: v.phone, email: v.email,
    timeline: v.timeline, textOk,
    source: "UI-W4", subjectZip: normalizeZip($("zip").value)
  }}; 
  if (leadController) leadController.abort();
  leadController = new AbortController();
  showStatus("Submitting…","info");
  $("leadSubmit").disabled = true;
  try{
    const res = await fetch(WS3_LEADS, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
      signal: leadController.signal
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { ok:false, error:text || "Non‑JSON response" }; }
    if (!data?.ok || !data?.leadToken){
      $("leadErr").style.display = "block";
      $("leadErr").textContent = data?.error || text || "Submission failed.";
      showStatus("Submission failed.","error");
      toast("Submission failed","error");
      $("leadSubmit").disabled = false;
      return false;
    }
    leadToken = data.leadToken;
    localStorage.setItem("azm_leadToken", leadToken);
    localStorage.setItem("azm_leadEmail", v.email);
    gated = true;

    // Show results panel now that we're unlocked
    toggleResultsVisibility(true);

    // Gray out Get My Results after unlock
    const gateBtn = $("btnGate");
    gateBtn.disabled = true;
    gateBtn.textContent = "Unlocked";
    gateBtn.title = "You’re unlocked";

    showStatus("Saved. Pricing…","ok");
    toast("Unlocked","success");
    $("leadSubmit").disabled = false;
    return true;
  }catch(err){
    if (err?.name === "AbortError"){
      showStatus("Submission canceled.","warn");
      $("leadSubmit").disabled = false;
      return false;
    }
    $("leadErr").style.display = "block";
    $("leadErr").textContent = err?.message || "Submission error.";
    showStatus("Submission error.","error");
    toast("Submission error","error");
    $("leadSubmit").disabled = false;
    return false;
  }
}

/* ---------- Buttons & events ---------- */
function bindEvents(){
  // Gate
  $("btnGate").addEventListener("click", () => {
    if(!zipResolved || !loanStructureComplete()){ toast("Please complete Property ZIP and Loan Structure first.","warn"); refreshUnlockButton(); return; }
    if (gated && leadToken){ /* already unlocked */ return; }
    openLeadModal();
  });
  // Lead modal controls
  $("leadSubmit").addEventListener("click", async () => {
    const ok = await upsertLead();
    if (ok){ closeLeadModal(); priceNow(); }
  });
  $("cancelLead").addEventListener("click", () => {
    if (leadController) leadController.abort();
    closeLeadModal();
  });
  $("closeLead").addEventListener("click", () => {
    if (leadController) leadController.abort();
    closeLeadModal();
  });
  $("leadModalBackdrop").addEventListener("click", () => {
    if (leadController) leadController.abort();
    closeLeadModal();
  });

  // Re-Calculate
  $("btnRecalc").addEventListener("click", () => {
    if(!gated){ toast("Complete Get My Results first","warn"); return; }
    if(!loanStructureComplete()){ toast("Please complete Loan Structure fields.","warn"); return; }
    priceNow();
  });
  // Save
  $("btnSave").addEventListener("click", saveQuote);
  // Reset (keep ZIP & gating)
  $("btnReset").addEventListener("click", () => {
    const keepZip = $("zip").value; const keepResolved = zipResolved;
    $("program").value="CONV";
    rebuildTxnOptions();
    $("term").value="360";
    $("value").value="500000"; $("ltv").value="80"; $("loan").value="400000"; $("equity").value="100000";
    seedTaxesInsFromState();
    $("ficoRange").value="740"; $("fico").value="740"; $("ficoChip").textContent="740";
    $("pointsRange").value="0.0"; $("points").value="0.0"; $("pointsChip").textContent="0.0%";
    updateProgramPanels();
    enforceLtvOnContextChange();
    renderLoanLine();
    $("zip").value = keepZip;
    zipResolved = keepResolved;
    refreshUnlockButton();
    coreDirty = true; setRecalcState();
    $("btnSave").disabled = true;
    ["kpiRate","kpiTotal",
     "with_loanCalc","with_rate","with_housing","with_pi","with_mi","with_taxes","with_ins","with_hoa",
     "par_loanCalc","par_rate","par_housing","par_pi","par_mi","par_taxes","par_ins","par_hoa",
     "delta_payment","delta_rateCost"
    ].forEach(id => { $(id).textContent = "—"; });
    $("resultsDelta").style.display = "none";
    $("delta_payment").classList.remove("delta-pos","delta-neg");
    $("delta_rateCost").classList.remove("delta-pos","delta-neg");
    lastQuotePar = null; lastParSig = null;
    lastPricedFicoBucket = null; lastProgramForBucket = null;
    showStatus("Pending changes — click Re‑Calculate to update pricing.","info");
  });

  // ZIP
  $("zip").addEventListener("input", () => { onZipInput(); refreshUnlockButton(); markCoreDirty(); });
  $("zip").addEventListener("keydown", (e) => { if(e.key==="Enter" && !$("btnGate").disabled){ e.preventDefault(); $("btnGate").click(); } });

  // Program/Txn/Term
  $("program").addEventListener("change", () => {
    rebuildTxnOptions(); updateProgramPanels(); enforceLtvOnContextChange(); markCoreDirty();
    lastPricedFicoBucket = null; lastProgramForBucket = null;
  });
  $("txn").addEventListener("change", () => {
    updateProgramPanels(); enforceLtvOnContextChange(); markCoreDirty();
  });
  $("term").addEventListener("change", () => { markCoreDirty(); });

  // Structure (core) + unlock state
  $("value").addEventListener("input", () => {
    if(syncLock) return; syncLock=true; recomputeFromValue(); syncLock=false;
    seedTaxesInsFromState(); renderLoanLine(); refreshUnlockButton(); markCoreDirty();
  });
  $("ltv").addEventListener("input", () => { if(syncLock) return; syncLock=true; recomputeFromLtv(); syncLock=false; renderLoanLine(); refreshUnlockButton(); markCoreDirty(); });
  $("loan").addEventListener("input", () => { if(syncLock) return; syncLock=true; recomputeFromLoan(); syncLock=false; renderLoanLine(); refreshUnlockButton(); markCoreDirty(); });
  $("equity").addEventListener("input", () => { if(syncLock) return; syncLock=true; recomputeFromEquity();syncLock=false; renderLoanLine(); refreshUnlockButton(); markCoreDirty(); });

  // Taxes & Insurance (live unless core dirty)
  ["taxes","ins","hoa"].forEach(id => $(id).addEventListener("input", () => {
    if(!gated) return;
    if(!coreDirty) maybeReprice();
    else showStatus("Pending changes — click Re‑Calculate to update pricing.","info");
  }));

  // FICO slider: update chip live; reprice on release (bucket change)
  $("ficoRange").addEventListener("input", () => {
    const v=$("ficoRange").value; $("fico").value=v; $("ficoChip").textContent=v;
  });
  $("ficoRange").addEventListener("change", () => {
    const programUI = $("program").value;
    const entered = Number($("fico").value);
    const bucket = ficoBucketKey(programUI, entered);
    if (lastPricedFicoBucket && lastProgramForBucket===programUI && bucket===lastPricedFicoBucket) return;
    priceNow();
  });

  // FICO manual entry: commit on Enter or blur; validate & bucket check
  $("fico").addEventListener("keydown", (e) => {
    if(e.key==="Enter"){ e.preventDefault(); e.currentTarget.blur(); }
  });
  $("fico").addEventListener("blur", () => {
    const vRaw = $("fico").value.trim();
    const v = Number(vRaw);
    const msgEl = $("ficoMsg");
    if(!isFinite(v) || v<300 || v>850){
      msgEl.textContent = "Enter a valid FICO between 300 and 850.";
      msgEl.style.display = "block";
      $("fico").classList.add("input-error");
      return;
    }
    $("fico").classList.remove("input-error");
    msgEl.style.display = "none";

    const programUI = $("program").value;
    const bucket = ficoBucketKey(programUI, v);
    if (lastPricedFicoBucket && lastProgramForBucket===programUI && bucket===lastPricedFicoBucket) return;
    priceNow();
  });

  // Points (0.5 steps)
  $("pointsRange").addEventListener("input", () => {
    let v=Number($("pointsRange").value); if(!isFinite(v)) v=0;
    v=Math.max(-1,Math.min(3,Math.round(v*2)/2));
    $("points").value = String(v);
    $("pointsChip").textContent = `${v.toFixed(1)}%`;
    maybeReprice();
  });
  $("points").addEventListener("input", () => {
    let v=Number($("points").value); if(!isFinite(v)) v=0;
    v=Math.max(-1,Math.min(3,Math.round(v*2)/2));
    $("pointsRange").value = String(v);
    $("points").value = String(v);
    $("pointsChip").textContent = `${v.toFixed(1)}%`;
    maybeReprice();
  });

  // DSCR ratio
  $("dscrRatio").addEventListener("input", () => { maybeReprice(); });

  // Dev
  $("devShowPayloads").addEventListener("change",(e)=> setDev(e.target.checked));
}

/* ---------- ZIP input handler ---------- */
let zipTimer=null;
function onZipInput(){
  clearTimeout(zipTimer);
  zipTimer=setTimeout(async ()=>{
    const zipEl=$("zip"); const zip=normalizeZip(zipEl.value);
    if(!zip){
      zipResolved=false; setZipMsg("", "");
      stateAbbr="AZ"; stateName="Arizona"; cityName="";
      seedTaxesInsFromState();
      refreshUnlockButton();
      showStatus("Pricing ready — click Get My Results to review.","info");
      return;
    }
    const info=await fetchZipInfo(zip);
    if(!info){
      zipResolved=false; setZipMsg("warn","Could not find Property Zip. Try another ZIP.");
      refreshUnlockButton();
      showStatus("Enter a valid ZIP to proceed.","warn");
      return;
    }
    zipResolved=true;
    stateAbbr=info.abbr; stateName=info.state; cityName=info.city||"";
    setZipMsg("ok", `${cityName?cityName+", ":""}${stateName}`);
    seedTaxesInsFromState();
    refreshUnlockButton();
    if(!gated) showStatus("Pricing ready — click Get My Results to review.","info");
  }, 250);
}

/* ---------- Init ---------- */
function initialRender(){
  rebuildTxnOptions();
  updateProgramPanels();
  seedTaxesInsFromState();
  refreshUnlockButton();
  $("btnRecalc").disabled = true;
  $("btnSave").disabled = true;
  $("recalcDot").style.visibility = "hidden";
  renderLoanLine();
  toggleResultsVisibility(!!leadToken); // show results only if already unlocked
  showStatus("Pricing ready — click Get My Results to review.","info");
}
document.addEventListener("DOMContentLoaded", () => { bindEvents(); initialRender(); });
