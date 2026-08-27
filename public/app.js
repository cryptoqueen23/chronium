const form = document.querySelector('#searchForm');
const input = document.querySelector('#query');
const statusBox = document.querySelector('#status');
const section = document.querySelector('#resultsSection');
const list = document.querySelector('#results');
const title = document.querySelector('#resultsTitle');
const coverage = document.querySelector('#coverage');
const sourceFilter = document.querySelector('#sourceFilter');
const typeFilter = document.querySelector('#typeFilter');
let current = [];

document.querySelectorAll('[data-q]').forEach(btn => btn.addEventListener('click', () => { input.value = btn.dataset.q; form.requestSubmit(); }));
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = input.value.trim(); if (!q) return;
  setStatus(`Searching Chronium heads for “${q}”…`);
  section.classList.add('hidden');
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=25`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');
    current = data.results || [];
    title.textContent = `${data.total} historical result${data.total === 1 ? '' : 's'}`;
    renderCoverage(data);
    buildFilters(current);
    render();
    section.classList.remove('hidden');
    setStatus(data.mode === 'topic'
      ? `Topic mode: only heads with full-text capability were queried. ${data.tookMs} ms.`
      : `URL history mode: archive capture indexes were queried. ${data.tookMs} ms.`);
  } catch (err) { setStatus(`Search error: ${err.message}`, true); }
});
sourceFilter.addEventListener('change', render); typeFilter.addEventListener('change', render);

function renderCoverage(data) {
  coverage.innerHTML = data.connectors.map(c => `<div class="source ${c.ok ? '' : 'bad'}"><strong><i class="dot ${c.ok ? 'live' : ''}"></i>${esc(c.source)} · ${c.ok ? c.count : 'unavailable'}</strong><p>${esc(c.capability)}${c.note ? `<br>${esc(c.note)}` : ''}${c.error ? `<br>${esc(c.error)}` : ''}</p></div>`).join('');
}
function buildFilters(items) {
  const sources = [...new Set(items.map(x=>x.source).filter(Boolean))].sort();
  const types = [...new Set(items.map(x=>bucket(x.mime)).filter(Boolean))].sort();
  sourceFilter.innerHTML = '<option value="all">All sources</option>'+sources.map(x=>`<option>${esc(x)}</option>`).join('');
  typeFilter.innerHTML = '<option value="all">All content</option>'+types.map(x=>`<option>${esc(x)}</option>`).join('');
}
function render() {
  const sf=sourceFilter.value, tf=typeFilter.value;
  const filtered=current.filter(x=>(sf==='all'||x.source===sf)&&(tf==='all'||bucket(x.mime)===tf));
  list.innerHTML = filtered.length ? filtered.map(card).join('') : '<p class="status">No results match these filters.</p>';
}
function card(x) {
  const d=x.captureDate ? new Date(x.captureDate) : null;
  const year=d&&!isNaN(d)?d.getUTCFullYear():'Unknown';
  const date=d&&!isNaN(d)?d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'Capture date unavailable';
  return `<article class="card"><div class="when"><strong>${esc(year)}</strong>${esc(date)}</div><div><h3>${esc(x.title||x.originalUrl||'Archived result')}</h3><div class="url">${esc(x.originalUrl||'')}</div>${x.snippet?`<p class="snippet">${esc(x.snippet).slice(0,450)}</p>`:''}<div class="tags"><span class="tag">${esc(x.source)}</span><span class="tag">${esc(x.matchType||'archive')}</span>${x.mime?`<span class="tag">${esc(x.mime)}</span>`:''}${x.language?`<span class="tag">${esc(x.language)}</span>`:''}</div></div><div class="actions">${x.archiveUrl?`<a class="primary" target="_blank" rel="noopener" href="${attr(x.archiveUrl)}">View source</a>`:''}${x.originalUrl?`<a target="_blank" rel="noopener" href="${attr(asUrl(x.originalUrl))}">Live URL</a>`:''}</div></article>`;
}
function bucket(m=''){m=String(m).toLowerCase();if(m.includes('pdf'))return'PDF';if(m.startsWith('image/'))return'Image';if(m.includes('html'))return'Webpage';if(m.includes('audio'))return'Audio';if(m.includes('video'))return'Video';return m?'Other':'Unknown'}
function setStatus(msg,bad=false){statusBox.textContent=msg;statusBox.classList.remove('hidden');statusBox.style.color=bad?'#ff8a8a':''}
function asUrl(u){return /^https?:\/\//i.test(u)?u:`https://${u}`}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function attr(s=''){return esc(s)}
