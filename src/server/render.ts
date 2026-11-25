import {
  EDITORIAL_INDEPENDENCE_STATEMENT,
  FDIC_NCUA_GLOBAL_DISCLOSURE,
  MarketplaceComparisonResponse,
  RankedBankingProduct,
  SYNTHETIC_DEMO_DISCLAIMER,
} from '../domain/banking.js';
import type { BucketAssignment } from '../domain/experiments.js';
import {
  BANKING_MARKETPLACE_FAQS,
  buildMarketplaceJsonLd,
  buildSeoMetaTags,
  escapeHtml,
  safeJsonLdSerialize,
} from '../domain/seo.js';

export interface RenderMarketplaceOptions {
  baseUrl: string;
  comparison: MarketplaceComparisonResponse;
  bucket: BucketAssignment;
}

function formatMoney(amount: number): string {
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatWholeDollars(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

function renderCalculatorForm(
  comparison: MarketplaceComparisonResponse,
  compact: boolean,
): string {
  const { depositUsd, months, sort, accountType, noFeeOnly } = comparison.query;
  const topOffer = comparison.results[0];

  return `<section class="calc-card${compact ? ' calc-card--compact' : ''}" aria-labelledby="calc-heading">
      <div class="calc-header">
        <h2 id="calc-heading">${compact ? 'Personalize Yield &amp; Filter' : 'Compound APY &amp; Net Return Calculator'}</h2>
        <span class="badge badge--fresh">Reg DD Monthly Compounding</span>
      </div>
      <form id="comparison-form" method="GET" action="/" class="calc-grid">
        <div class="field">
          <label for="deposit-input">Deposit Amount (USD)</label>
          <input id="deposit-input" name="deposit" type="number" min="100" max="10000000" step="500" value="${Math.round(depositUsd)}" required>
        </div>
        <div class="field">
          <label for="months-input">Time Horizon (Months)</label>
          <input id="months-input" name="months" type="number" min="1" max="120" step="1" value="${months}" required>
        </div>
        <div class="field">
          <label for="type-select">Account Type</label>
          <select id="type-select" name="accountType">
            <option value="ALL"${accountType === 'ALL' ? ' selected' : ''}>All (HYSA &amp; CD)</option>
            <option value="HYSA"${accountType === 'HYSA' ? ' selected' : ''}>High-Yield Savings (HYSA)</option>
            <option value="CD"${accountType === 'CD' ? ' selected' : ''}>Certificates of Deposit (CD)</option>
          </select>
        </div>
        <div class="field">
          <label for="sort-select">Sort Order</label>
          <select id="sort-select" name="sort">
            <option value="best_net_yield"${sort === 'best_net_yield' ? ' selected' : ''}>Best Net Yield ($)</option>
            <option value="highest_apy"${sort === 'highest_apy' ? ' selected' : ''}>Highest Headline APY</option>
            <option value="editorial_pick"${sort === 'editorial_pick' ? ' selected' : ''}>Independent Editorial Pick</option>
            <option value="no_min_balance"${sort === 'no_min_balance' ? ' selected' : ''}>Lowest Minimum Balance</option>
          </select>
        </div>
        <div class="field field--checkbox">
          <input id="nofee-checkbox" name="noFeeOnly" type="checkbox" value="true"${noFeeOnly ? ' checked' : ''}>
          <label for="nofee-checkbox">$0 Monthly Fee Only</label>
        </div>
        <div class="field field--submit">
          <button type="submit" class="btn-primary">Update Comparison</button>
        </div>
      </form>
      <div id="calc-live-summary" class="calc-summary" aria-live="polite">
        ${
          topOffer
            ? `Top match for <strong>${formatWholeDollars(depositUsd)}</strong> over <strong>${months} mo</strong>: <strong>${escapeHtml(topOffer.product.productName)}</strong> — projected net return <strong>+${formatMoney(topOffer.yieldSummary.netReturnUsd)}</strong> (${topOffer.yieldSummary.effectiveAnnualizedNetYieldPct.toFixed(2)}% net annualized).`
            : 'No accounts match the active filter combination. Adjust your filters above.'
        }
      </div>
    </section>`;
}

function renderProductRow(entry: RankedBankingProduct): string {
  const { product, yieldSummary, freshness } = entry;
  const promoNote = yieldSummary.promoExpiryNotice
    ? `<div class="note-promo">${escapeHtml(yieldSummary.promoExpiryNotice)}</div>`
    : '';
  const feeNote =
    yieldSummary.totalFeesUsd > 0
      ? `<div class="note-warn">Fee drag: -${formatMoney(yieldSummary.totalFeesUsd)} (${yieldSummary.feeDragPctOfInterest.toFixed(1)}% of interest)</div>`
      : '<div class="note-muted">$0 fee drag</div>';
  const eligibilityNote = entry.eligibilityWarning
    ? `<div class="note-warn">${escapeHtml(entry.eligibilityWarning)}</div>`
    : '';
  const staleNote = entry.demotedForStaleness
    ? `<div class="note-warn">Rate verification expired (${freshness.ageHours}h old) — demoted</div>`
    : `<div class="note-muted">Rate verified ${freshness.ageHours}h ago</div>`;

  const badgeClass = product.isPartner ? 'badge--partner' : 'badge--independent';
  const initials = escapeHtml(
    product.institutionName
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase(),
  );

  return `<tr id="product-${escapeHtml(product.slug)}" data-product-id="${escapeHtml(product.id)}">
          <td>
            <div class="bank-cell">
              <svg class="bank-avatar" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
                <rect width="36" height="36" rx="8" fill="#0f5132"></rect>
                <text x="18" y="23" text-anchor="middle" fill="#ffffff" font-size="13" font-weight="700" font-family="system-ui,sans-serif">${initials}</text>
              </svg>
              <div>
                <div class="bank-title">
                  <span class="rank-pill">#${entry.rank}</span>
                  <strong>${escapeHtml(product.productName)}</strong>
                </div>
                <div class="bank-sub">${escapeHtml(product.institutionName)} &middot; ${escapeHtml(product.accountType)}</div>
                <div class="badge-row">
                  <span class="badge ${badgeClass}" title="${escapeHtml(product.partnerDisclosureText)}">${escapeHtml(entry.disclosureBadge)}</span>
                  <span class="badge badge--insurance">${escapeHtml(product.insuranceType)} $250k</span>
                </div>
                ${promoNote}${eligibilityNote}
              </div>
            </div>
          </td>
          <td class="num-col">
            <div class="apy-val">${yieldSummary.headlineApyPct.toFixed(2)}%</div>
            <div class="note-muted">Net: ${yieldSummary.effectiveAnnualizedNetYieldPct.toFixed(2)}%</div>
            ${staleNote}
          </td>
          <td class="num-col">
            <div class="return-val">+${formatMoney(yieldSummary.netReturnUsd)}</div>
            <div class="note-muted">End: ${formatMoney(yieldSummary.endingBalanceUsd)}</div>
            ${feeNote}
          </td>
          <td class="num-col">
            <div>${formatWholeDollars(product.minDepositUsd)}</div>
            <div class="note-muted">${product.monthlyFeeUsd === 0 ? '$0/mo fee' : `$${product.monthlyFeeUsd}/mo`}</div>
          </td>
          <td class="num-col">
            <div class="rating-val">${product.editorialRating.toFixed(1)} / 5.0</div>
            <a class="btn-cta" href="${escapeHtml(product.applyUrl)}" target="_blank" rel="noopener noreferrer sponsored" data-partner-cta="${escapeHtml(product.id)}">View Offer</a>
          </td>
        </tr>`;
}

function renderComparisonTable(comparison: MarketplaceComparisonResponse): string {
  const rowsHtml = comparison.results.map(renderProductRow).join('\n');
  return `<section class="table-section" aria-labelledby="table-heading">
      <div class="section-head">
        <div>
          <h2 id="table-heading">Personalized Banking Offers (${comparison.results.length} Verified)</h2>
          <p class="section-sub">Ranked strictly by selected algorithm &mdash; partner compensation never alters editorial scores or sort order.</p>
        </div>
        <div class="sla-pill" title="Compliance guardrail blocks or demotes rates older than 72 hours">
          Freshness SLA: ${comparison.freshnessSummary.freshCount + comparison.freshnessSummary.expiringSoonCount}/${comparison.freshnessSummary.totalCatalogProducts} within ${comparison.freshnessSummary.maxAllowedStaleHours}h
        </div>
      </div>
      <div class="table-wrap" aria-live="polite">
        <table class="rate-table" aria-label="High-Yield Savings Accounts and CDs Comparison">
          <caption class="sr-only">Comparison of synthetic High-Yield Savings Accounts and CDs showing APY, projected net return, fees, minimum deposit, and editorial rating.</caption>
          <thead>
            <tr>
              <th scope="col">Account &amp; Disclosures</th>
              <th scope="col" class="num-col">APY</th>
              <th scope="col" class="num-col">Projected Net Return</th>
              <th scope="col" class="num-col">Min Deposit &amp; Fee</th>
              <th scope="col" class="num-col">Editorial Rating</th>
            </tr>
          </thead>
          <tbody id="comparison-tbody">
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </section>`;
}

function renderHeroBanner(bucket: BucketAssignment, compact: boolean): string {
  return `<section class="hero${compact ? ' hero--compact' : ''}">
      <div class="hero-kicker">Consumer Banking Marketplace Reference &middot; Zero-CLS Server A/B</div>
      <h1>Best High-Yield Savings Accounts &amp; CDs</h1>
      <p class="hero-lead">Compare Reg DD monthly-compounded net returns after fee drag, balance tiers, and promotional APY cliffs &mdash; server-rendered with 0ms experiment layout shift and strict 72-hour rate freshness guardrails.</p>
      <div class="hero-meta">
        <span>Active Server Bucket: <code>${escapeHtml(bucket.experimentKey)}:${escapeHtml(bucket.variantKey)}</code></span>
        <span class="variant-switch">Preview Variant:
          <a href="/?forceVariant=hero_calc_above_fold">Hero Calc First</a> &middot;
          <a href="/?forceVariant=comparison_table_first">Table First</a>
        </span>
      </div>
    </section>`;
}

function renderFaqSection(): string {
  const items = BANKING_MARKETPLACE_FAQS.map(
    (faq) => `<details class="faq-item">
        <summary>${escapeHtml(faq.question)}</summary>
        <p>${escapeHtml(faq.answer)}</p>
      </details>`,
  ).join('\n');

  return `<section class="faq-section" aria-labelledby="faq-heading">
      <h2 id="faq-heading">Methodology, Insurance &amp; Rate Compliance FAQ</h2>
      <div class="faq-list">
        ${items}
      </div>
    </section>`;
}

function renderTelemetryDrawer(bucket: BucketAssignment): string {
  return `<section class="telemetry-section" aria-labelledby="telemetry-heading">
      <details id="telemetry-drawer" class="telemetry-drawer">
        <summary id="telemetry-heading">Live RUM Core Web Vitals, Experiment SRM &amp; Spec-Driven Audit Drawer</summary>
        <div class="telemetry-body">
          <div class="telemetry-grid">
            <div class="metric-box">
              <div class="metric-label">Server Experiment Bucket</div>
              <div class="metric-value" id="rum-bucket">${escapeHtml(bucket.variantKey)}</div>
              <div class="note-muted">Assigned pre-HTML (0ms CLS)</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">Live Browser CLS / LCP</div>
              <div class="metric-value" id="rum-local-vitals">Observing...</div>
              <div class="note-muted">Reported to /api/telemetry/vitals</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">Server p75 &amp; SRM Health</div>
              <div class="metric-value" id="rum-srm-status">Click refresh</div>
              <div class="note-muted">Chi-square SRM + p75 CWV</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">Spec-Driven Audit Score</div>
              <div class="metric-value" id="rum-audit-score">Click refresh</div>
              <div class="note-muted">SEO + CWV + WCAG + Compliance</div>
            </div>
          </div>
          <div class="telemetry-actions">
            <button type="button" id="refresh-telemetry-btn" class="btn-secondary">Refresh Live Telemetry &amp; Audit</button>
            <a class="btn-link" href="/api/audit?format=markdown" target="_blank" rel="noopener">Open Markdown Audit Report</a>
            <a class="btn-link" href="/api/telemetry/summary" target="_blank" rel="noopener">JSON Telemetry Summary</a>
          </div>
          <pre id="telemetry-json-output" class="telemetry-pre" aria-live="polite">Open drawer and click "Refresh Live Telemetry &amp; Audit" to inspect live server stats.</pre>
        </div>
      </details>
    </section>`;
}

const CRITICAL_CSS = `:root{--bg:#f8fafc;--surface:#ffffff;--ink:#0f172a;--muted:#475569;--brand:#0b6e4f;--brand-dark:#084c37;--border:#cbd5e1;--warn-bg:#fef3c7;--warn-ink:#78350f;--accent-bg:#ecfdf5;--accent-ink:#065f46}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.5}
.skip-link{position:absolute;left:-9999px;top:0;background:var(--brand-dark);color:#fff;padding:10px 16px;z-index:100;font-weight:600}
.skip-link:focus{left:12px;top:12px;border-radius:6px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.demo-banner{background:#1e293b;color:#f8fafc;font-size:13px;padding:8px 16px;text-align:center}
.site-header{background:var(--surface);border-bottom:1px solid var(--border);min-height:60px}
.container{max-width:1120px;margin:0 auto;padding:0 16px}
.header-inner{display:flex;align-items:center;justify-content:space-between;min-height:60px;gap:12px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px;color:var(--brand-dark);text-decoration:none}
.breadcrumb{font-size:13px;color:var(--muted)}
.breadcrumb a{color:var(--brand-dark);text-decoration:none}
main{padding:20px 0 40px}
.hero{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:22px 24px;margin-bottom:18px;min-height:164px}
.hero--compact{padding:14px 20px;min-height:112px}
.hero-kicker{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--brand)}
h1{margin:6px 0 8px;font-size:clamp(24px,3vw,34px);line-height:1.2}
h2{margin:0 0 8px;font-size:20px;line-height:1.3}
.hero-lead{margin:0 0 12px;color:var(--muted);max-width:74ch}
.hero-meta{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;color:var(--muted)}
.hero-meta code{background:#f1f5f9;padding:2px 6px;border-radius:4px;color:var(--ink)}
.variant-switch a{color:var(--brand-dark);font-weight:600}
.calc-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:18px;min-height:178px}
.calc-card--compact{padding:14px 18px;min-height:142px}
.calc-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.calc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;align-items:end}
.field{display:flex;flex-direction:column;gap:4px}
.field label{font-size:13px;font-weight:600;color:var(--ink)}
.field input[type=number],.field select{height:40px;padding:6px 10px;border:1px solid #94a3b8;border-radius:8px;font-size:14px;background:#fff;color:var(--ink)}
.field--checkbox{flex-direction:row;align-items:center;gap:8px;height:40px}
.field--checkbox input{width:18px;height:18px}
.btn-primary{height:40px;padding:0 16px;background:var(--brand);color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;width:100%}
.btn-primary:hover{background:var(--brand-dark)}
.calc-summary{margin-top:12px;padding:10px 12px;background:var(--accent-bg);color:var(--accent-ink);border-radius:8px;font-size:14px;min-height:42px}
.table-section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:18px}
.section-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.section-sub{margin:0;font-size:13px;color:var(--muted)}
.sla-pill{background:var(--accent-bg);color:var(--accent-ink);border:1px solid #a7f3d0;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700}
.table-wrap{overflow-x:auto}
.rate-table{width:100%;border-collapse:collapse;font-size:14px}
.rate-table th{text-align:left;padding:10px 12px;background:#f1f5f9;border-bottom:2px solid var(--border);font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#334155}
.rate-table td{padding:14px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top}
.num-col{text-align:right;white-space:nowrap}
.bank-cell{display:flex;gap:10px;align-items:flex-start;min-width:250px}
.bank-avatar{flex:0 0 36px;aspect-ratio:1/1;border-radius:8px}
.bank-title{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.rank-pill{background:#0f172a;color:#fff;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px}
.bank-sub{font-size:13px;color:var(--muted);margin-top:2px}
.badge-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}
.badge--partner{background:#fef3c7;color:#92400e;border:1px solid #fcd34d}
.badge--independent{background:#e0f2fe;color:#075985;border:1px solid #7dd3fc}
.badge--insurance{background:#f1f5f9;color:#334155;border:1px solid #cbd5e1}
.badge--fresh{background:var(--accent-bg);color:var(--accent-ink);border:1px solid #a7f3d0}
.apy-val{font-size:20px;font-weight:800;color:var(--brand-dark)}
.return-val{font-size:17px;font-weight:700;color:#0f172a}
.rating-val{font-weight:700;margin-bottom:6px}
.note-muted{font-size:12px;color:var(--muted)}
.note-promo{font-size:12px;color:#075985;margin-top:4px;max-width:44ch;white-space:normal}
.note-warn{font-size:12px;color:var(--warn-ink);background:var(--warn-bg);padding:2px 6px;border-radius:4px;margin-top:4px;display:inline-block;white-space:normal}
.btn-cta{display:inline-block;padding:6px 12px;background:var(--brand);color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:13px}
.btn-cta:hover{background:var(--brand-dark)}
.faq-section,.telemetry-section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:18px}
.faq-item{border-top:1px solid #e2e8f0;padding:10px 0}
.faq-item:first-child{border-top:none}
.faq-item summary{font-weight:700;cursor:pointer}
.faq-item p{margin:8px 0 0;color:var(--muted);font-size:14px}
.telemetry-drawer summary{font-weight:700;cursor:pointer;color:var(--brand-dark)}
.telemetry-body{margin-top:14px}
.telemetry-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px}
.metric-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;min-height:84px}
.metric-label{font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted)}
.metric-value{font-size:16px;font-weight:800;margin:4px 0}
.telemetry-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.btn-secondary{padding:8px 14px;border:1px solid var(--brand);background:#fff;color:var(--brand-dark);border-radius:6px;font-weight:700;cursor:pointer}
.btn-link{color:var(--brand-dark);font-size:13px;font-weight:600}
.telemetry-pre{background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;overflow:auto;font-size:12px;max-height:240px;margin:0}
.site-footer{border-top:1px solid var(--border);background:var(--surface);padding:20px 0;font-size:12px;color:var(--muted)}
.site-footer p{margin:0 0 8px}`;

const INLINE_CLIENT_SCRIPT = `(function(){
  var body=document.body;
  var expKey=body.dataset.experimentKey||'hysa_layout_v1';
  var variant=body.dataset.experimentVariant||'hero_calc_above_fold';
  var vid=body.dataset.visitorId||'anonymous';
  var clsVal=0,lcpVal=null,inpVal=null;
  function sendTelemetry(payload){
    var data=JSON.stringify(Object.assign({visitorId:vid,experimentKey:expKey,variantKey:variant,path:location.pathname},payload));
    if(navigator.sendBeacon){navigator.sendBeacon('/api/telemetry/vitals',new Blob([data],{type:'application/json'}));}
    else{fetch('/api/telemetry/vitals',{method:'POST',headers:{'Content-Type':'application/json'},body:data,keepalive:true}).catch(function(){});}
  }
  function updateLocalLabel(){
    var el=document.getElementById('rum-local-vitals');
    if(!el)return;
    el.textContent='CLS '+clsVal.toFixed(3)+(lcpVal!==null?' | LCP '+Math.round(lcpVal)+'ms':'');
  }
  if(typeof PerformanceObserver!=='undefined'){
    try{
      new PerformanceObserver(function(list){
        var entries=list.getEntries();
        var last=entries[entries.length-1];
        if(last){lcpVal=last.startTime;updateLocalLabel();}
      }).observe({type:'largest-contentful-paint',buffered:true});
      new PerformanceObserver(function(list){
        list.getEntries().forEach(function(e){if(!e.hadRecentInput){clsVal+=e.value;}});
        updateLocalLabel();
      }).observe({type:'layout-shift',buffered:true});
      new PerformanceObserver(function(list){
        list.getEntries().forEach(function(e){if(e.duration&&(inpVal===null||e.duration>inpVal)){inpVal=e.duration;}});
      }).observe({type:'event',buffered:true,durationThreshold:16});
    }catch(e){}
  }
  window.addEventListener('load',function(){
    var nav=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];
    var ttfb=nav?Math.max(0,nav.responseStart-nav.requestStart):0;
    setTimeout(function(){
      var vitals=[{name:'CLS',value:Number(clsVal.toFixed(4))},{name:'TTFB',value:Math.round(ttfb)}];
      if(lcpVal!==null)vitals.push({name:'LCP',value:Math.round(lcpVal)});
      if(inpVal!==null)vitals.push({name:'INP',value:Math.round(inpVal)});
      sendTelemetry({vitals:vitals});
      updateLocalLabel();
    },400);
  });
  var form=document.getElementById('comparison-form');
  if(form){
    form.addEventListener('submit',function(ev){
      ev.preventDefault();
      var fd=new FormData(form);
      var qs=new URLSearchParams();
      qs.set('deposit',String(fd.get('deposit')||'25000'));
      qs.set('months',String(fd.get('months')||'12'));
      qs.set('accountType',String(fd.get('accountType')||'ALL'));
      qs.set('sort',String(fd.get('sort')||'best_net_yield'));
      if(fd.get('noFeeOnly'))qs.set('noFeeOnly','true');
      sendTelemetry({event:{eventType:'calculator_interact'}});
      fetch('/api/products?'+qs.toString()).then(function(r){return r.json();}).then(function(data){
        var summary=document.getElementById('calc-live-summary');
        if(summary&&data.results&&data.results[0]){
          var top=data.results[0];
          summary.textContent='Top match for $'+Math.round(data.query.depositUsd).toLocaleString('en-US')+' over '+data.query.months+' mo: '+top.product.productName+' — projected net return +$'+top.yieldSummary.netReturnUsd.toFixed(2)+' ('+top.yieldSummary.effectiveAnnualizedNetYieldPct.toFixed(2)+'% net annualized).';
        }
        window.history.replaceState(null,'','/?'+qs.toString());
        location.reload();
      }).catch(function(){form.submit();});
    });
  }
  document.addEventListener('click',function(ev){
    var target=ev.target&&ev.target.closest?ev.target.closest('[data-partner-cta]'):null;
    if(target){sendTelemetry({event:{eventType:'partner_click',productId:target.getAttribute('data-partner-cta')||undefined}});}
  });
  var btn=document.getElementById('refresh-telemetry-btn');
  if(btn){
    btn.addEventListener('click',function(){
      var out=document.getElementById('telemetry-json-output');
      Promise.all([fetch('/api/telemetry/summary').then(function(r){return r.json();}),fetch('/api/audit').then(function(r){return r.json();})])
        .then(function(pair){
          var sum=pair[0],aud=pair[1];
          var srmEl=document.getElementById('rum-srm-status');
          var audEl=document.getElementById('rum-audit-score');
          if(srmEl)srmEl.textContent=sum.experiment.srm.status+' (p='+sum.experiment.srm.pValue+')';
          if(audEl)audEl.textContent=aud.passedCount+'/'+aud.totalChecks+' ('+aud.scorePct+'%)';
          if(out)out.textContent=JSON.stringify({webVitals:sum.webVitals,srm:sum.experiment.srm,auditSummary:{passed:aud.passed,scorePct:aud.scorePct,htmlBytes:aud.htmlBytes}},null,2);
        }).catch(function(err){if(out)out.textContent='Error loading telemetry: '+err;});
    });
  }
})();`;

export function renderMarketplaceHtml(options: RenderMarketplaceOptions): string {
  const { baseUrl, comparison, bucket } = options;
  const isTableFirst = bucket.variantKey === 'comparison_table_first';

  const seoMeta = buildSeoMetaTags({
    baseUrl,
    canonicalPath: '/',
    title: 'Best High-Yield Savings Accounts & CDs | NerdPulse Consumer Banking',
    description:
      'Compare High-Yield Savings Accounts and CDs with Reg DD monthly compounding, fee-drag modeling, 72-hour rate freshness checks, and FDIC/NCUA disclosures.',
    experimentBucket: `${bucket.experimentKey}:${bucket.variantKey}`,
  });

  const jsonLd = buildMarketplaceJsonLd(comparison.results, baseUrl);
  const serializedJsonLd = safeJsonLdSerialize(jsonLd);

  const primarySections = isTableFirst
    ? [
        renderHeroBanner(bucket, true),
        renderComparisonTable(comparison),
        renderCalculatorForm(comparison, true),
      ].join('\n    ')
    : [
        renderHeroBanner(bucket, false),
        renderCalculatorForm(comparison, false),
        renderComparisonTable(comparison),
      ].join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${seoMeta}
  <style>${CRITICAL_CSS}</style>
  <script type="application/ld+json">${serializedJsonLd}</script>
</head>
<body data-experiment-key="${escapeHtml(bucket.experimentKey)}" data-experiment-variant="${escapeHtml(bucket.variantKey)}" data-visitor-id="${escapeHtml(bucket.visitorId)}">
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <div class="demo-banner" role="note">${escapeHtml(SYNTHETIC_DEMO_DISCLAIMER)}</div>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="/">
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <rect width="28" height="28" rx="6" fill="#0b6e4f"></rect>
          <path d="M7 20V8h3.2l7.6 8.2V8H21v12h-3.2l-7.6-8.2V20H7z" fill="#ffffff"></path>
        </svg>
        <span>NerdPulse Banking</span>
      </a>
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a> &rsaquo; <a href="/?accountType=ALL">Consumer Banking</a> &rsaquo; <span aria-current="page">High-Yield Savings &amp; CDs</span>
      </nav>
    </div>
  </header>
  <main id="main-content" class="container">
    ${primarySections}
    ${renderFaqSection()}
    ${renderTelemetryDrawer(bucket)}
  </main>
  <footer class="site-footer">
    <div class="container">
      <p><strong>${escapeHtml(FDIC_NCUA_GLOBAL_DISCLOSURE)}</strong></p>
      <p>${escapeHtml(EDITORIAL_INDEPENDENCE_STATEMENT)}</p>
      <p>${escapeHtml(SYNTHETIC_DEMO_DISCLAIMER)}</p>
    </div>
  </footer>
  <script>${INLINE_CLIENT_SCRIPT}</script>
</body>
</html>`;
}
