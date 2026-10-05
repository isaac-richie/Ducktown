// The Skill Store: real Microduck skills published by the community on the Hugging Face Hub.
// Everything here is read live from the Hub's public API (it allows browser requests). Each skill
// is an ONNX policy plus, usually, a manifest.json (pollen-robotics/microduck docs/policy-manifest.md)
// and a preview video. Installing on a robot uses Pollen's own command:
//   sudo robotctl policy add <name> <owner/repo>
// Ducktown never runs or vets these policies; cards say so.

const HUB = 'https://huggingface.co';
const LIST_URL = `${HUB}/api/models?search=microduck&limit=300&full=true&sort=likes&direction=-1`;
const OFFICIAL = new Set(['pollen-robotics', 'apirrone', 'RemiFabre', 'tfrere', 'PierreRouanet', 'cdeplanne']);
const PAGE = 12;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const ago = iso => {
  const days = Math.floor((Date.now() - new Date(iso)) / 864e5);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
};
const compact = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n);

// "HannesVonEssen/microduck-chimney-climb" -> "Chimney climb"
export function prettyName(id) {
  if (id === 'pollen-robotics/microduck-policies') return 'Official skill set';
  const slug = id.split('/')[1].replace(/^microduck[-_]?/i, '').replace(/[-_][0-9a-f]{6}$/i, '') || id.split('/')[1];
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : slug;
}
// The name robotctl gives the skill on the robot: the manifest's, else the repo slug.
const skillName = (id, manifest) => manifest?.name || id.split('/')[1].replace(/^microduck[-_]?/i, '').toLowerCase() || 'skill';

// Pick the clip that best shows the skill: a top-level preview first; skip old training iterations.
export function pickMedia(files) {
  const skip = /(legacy|lineage|experiments|milestone|iteration|rejected)/i;
  const videos = files.filter(f => /\.mp4$/i.test(f) && !skip.test(f));
  const rank = f => /(^|\/)preview\.mp4$/i.test(f) ? 0 : /(^|\/)(video|replay)\.mp4$/i.test(f) ? 1 : /preview/i.test(f) ? 2 : 3 + f.split('/').length;
  videos.sort((a, b) => rank(a) - rank(b));
  const images = files.filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f) && !skip.test(f));
  const poster = images.find(f => /(poster|thumbnail|preview|social)/i.test(f)) || null;
  return {video: videos[0] || null, poster: poster || (videos.length ? null : images[0] || null)};
}

export function toSkill(model) {
  const files = (model.siblings || []).map(s => s.rfilename);
  if (!files.some(f => f.endsWith('.onnx')) || model.private || model.gated || model.disabled) return null;
  const tags = model.tags || [];
  const {video, poster} = pickMedia(files);
  const owner = model.id.split('/')[0];
  const kind = tags.includes('kind:episodic') ? 'trick' : tags.some(t => t === 'microduck-slot:walk' || t === 'family:velocity') || /walk|run|sprint|roller/i.test(model.id) ? 'gait' : null;
  return {
    id: model.id, owner, name: prettyName(model.id), likes: model.likes || 0, downloads: model.downloads || 0,
    updated: model.lastModified, created: model.createdAt, hasManifest: files.includes('manifest.json'),
    official: owner === 'pollen-robotics', team: OFFICIAL.has(owner), kind,
    license: (tags.find(t => t.startsWith('license:')) || '').slice(8) || null,
    video: video && `${HUB}/${model.id}/resolve/main/${video.split('/').map(encodeURIComponent).join('/')}`,
    poster: poster && `${HUB}/${model.id}/resolve/main/${poster.split('/').map(encodeURIComponent).join('/')}`,
    score: (model.likes || 0) * 30 + Math.log10(1 + (model.downloads || 0)) * 10 + (video ? 25 : 0) + (files.includes('manifest.json') ? 10 : 0)
  };
}

let cache = null, loading = null;
async function loadSkills() {
  if (cache) return cache;
  loading ??= fetch(LIST_URL).then(r => {
    if (!r.ok) throw new Error(`Hub answered ${r.status}`);
    return r.json();
  }).then(models => {
    const seen = new Set();
    cache = models.map(toSkill).filter(s => s && !seen.has(s.id) && seen.add(s.id));
    return cache;
  }).finally(() => { loading = null; });
  return loading;
}

const manifests = new Map();
function loadManifest(id) {
  if (!manifests.has(id)) manifests.set(id, fetch(`${HUB}/${id}/raw/main/manifest.json`).then(r => r.ok ? r.json() : null).catch(() => null));
  return manifests.get(id);
}
const readmes = new Map();
function loadSummary(id) {
  // First real paragraph of the model card, for skills without a manifest description.
  if (!readmes.has(id)) readmes.set(id, fetch(`${HUB}/${id}/raw/main/README.md`).then(r => r.ok ? r.text() : '').then(text => {
    const body = text.replace(/^---[\s\S]*?---/, '');
    const para = body.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !/^(#|<|!\[|```|\||-{3})/.test(p));
    return para ? para.replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').slice(0, 320) : '';
  }).catch(() => ''));
  return readmes.get(id);
}

const ui = {filter: 'all', sort: 'popular', query: '', shown: PAGE};
const FILTERS = [['all', 'All'], ['video', 'With video'], ['trick', 'Tricks'], ['gait', 'Gaits'], ['official', 'Pollen']];

function visible(skills) {
  const q = ui.query.trim().toLowerCase();
  const list = skills.filter(s =>
    (ui.filter === 'all' || (ui.filter === 'video' && s.video) || (ui.filter === 'official' && s.official) || s.kind === ui.filter) &&
    (!q || `${s.name} ${s.id}`.toLowerCase().includes(q)));
  return list.sort(ui.sort === 'new' ? (a, b) => new Date(b.updated) - new Date(a.updated) : (a, b) => b.score - a.score);
}

const heart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
const down = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>';

// Preview clips are whole files (often several MB, not streamable), so cards never load them up
// front: a card shows the maker's thumbnail or a colour tile, and the clip starts on hover.
const hue = id => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
let markUrl = '';
function card(s, i) {
  // The colour tile is always there, so a slow thumbnail fades in over it instead of a blank box.
  const media = `<span class="store-art" style="--h:${hue(s.id)}" aria-hidden="true">${markUrl ? `<img src="${esc(markUrl)}" alt="">` : ''}</span>`
    + (s.poster ? `<img class="store-thumb" src="${esc(s.poster)}" alt="" loading="lazy" onload="this.classList.add('is-in')">` : '');
  return `<article class="store-card" style="--i:${i % PAGE}">
    <button class="store-media" data-skill="${esc(s.id)}" aria-label="Open ${esc(s.name)}">${media}${s.video ? `<span class="store-play" aria-hidden="true"></span><span class="store-clip" data-clip="${esc(s.video)}"></span>` : ''}
      ${s.official ? '<span class="store-badge official">Pollen</span>' : s.kind ? `<span class="store-badge">${s.kind === 'trick' ? 'Trick' : 'Gait'}</span>` : ''}</button>
    <div class="store-body">
      <h3><button data-skill="${esc(s.id)}">${esc(s.name)}</button></h3>
      <p class="store-by">by <a href="${HUB}/${esc(s.owner)}" target="_blank" rel="noopener noreferrer">${esc(s.owner)}</a> · ${ago(s.updated)}</p>
      <div class="store-stats"><span title="Likes on Hugging Face">${heart}${compact(s.likes)}</span><span title="Downloads">${down}${compact(s.downloads)}</span></div>
    </div>
  </article>`;
}

function shell(skills) {
  const list = visible(skills), total = skills.length, withVideo = skills.filter(s => s.video).length, makers = new Set(skills.map(s => s.owner)).size;
  return `<div class="store-head">
      <div><span class="store-live"><i></i>Live from Hugging Face</span><h2>The Skill Store</h2>
      <p>Real tricks and gaits the community trained for Microduck. Watch them, then put one on your duck with a single command.</p></div>
      <div class="store-numbers"><div><strong>${total}</strong><span>skills</span></div><div><strong>${makers}</strong><span>makers</span></div><div><strong>${withVideo}</strong><span>with video</span></div></div>
    </div>
    <div class="store-tools">
      <label class="store-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input type="search" placeholder="Search skills or makers" value="${esc(ui.query)}" data-store-search aria-label="Search skills"></label>
      <div class="store-chips" role="group" aria-label="Filter skills">${FILTERS.map(([id, label]) => `<button data-store-filter="${id}" aria-pressed="${ui.filter === id}">${label}</button>`).join('')}</div>
      <div class="store-sort" role="group" aria-label="Sort skills"><button data-store-sort="popular" aria-pressed="${ui.sort === 'popular'}">Popular</button><button data-store-sort="new" aria-pressed="${ui.sort === 'new'}">New</button></div>
    </div>
    ${list.length ? `<div class="store-grid">${list.slice(0, ui.shown).map(card).join('')}</div>` : `<div class="store-empty"><strong>No skills match “${esc(ui.query)}”.</strong><span>Try another word, or clear the filter.</span></div>`}
    ${list.length > ui.shown ? `<button class="store-more" data-store-more>Show more skills <span>${list.length - ui.shown} more</span></button>` : ''}
    <p class="store-note">Community skills are published by their makers and are not checked by Ducktown or Pollen. Many have only been tested in simulation, so read each one’s notes before running it on a real duck.</p>`;
}

// Desktop: hovering a card plays its clip over the thumbnail; leaving stops and frees it.
function hoverPreviews(root) {
  if (!matchMedia('(hover:hover)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('motion-disabled')) return;
  root.onpointerover = event => {
    const media = event.target.closest('.store-media'), clip = media?.querySelector('[data-clip]');
    if (!clip || clip.firstChild) return;
    clip.innerHTML = `<video muted loop playsinline autoplay src="${esc(clip.dataset.clip)}"></video>`;
    media.classList.add('is-loading');
    clip.firstChild.addEventListener('playing', () => { media.classList.remove('is-loading'); media.classList.add('is-playing'); }, {once: true});
    media.addEventListener('pointerleave', () => { clip.innerHTML = ''; media.classList.remove('is-loading', 'is-playing'); }, {once: true});
  };
}

export function mountSkillStore(root, {openModal, mark = ''}) {
  if (!root) return;
  markUrl = mark;
  const draw = skills => { root.innerHTML = shell(skills); hoverPreviews(root); };
  if (cache) draw(cache);
  else {
    root.innerHTML = `<div class="store-head"><div><span class="store-live"><i></i>Live from Hugging Face</span><h2>The Skill Store</h2><p>Loading the community’s skills…</p></div></div><div class="store-grid">${'<div class="store-card is-skeleton"><div class="store-media"></div><div class="store-body"><i></i><i></i></div></div>'.repeat(6)}</div>`;
    loadSkills().then(skills => root.isConnected && draw(skills)).catch(() => {
      if (root.isConnected) root.innerHTML = `<div class="store-head"><div><h2>The Skill Store</h2><p>Hugging Face could not be reached just now. <button class="text-button" data-store-retry>Try again</button></p></div></div>`;
    });
  }
  root.onclick = event => {
    const t = event.target.closest('[data-store-filter],[data-store-sort],[data-store-more],[data-skill],[data-store-retry]');
    if (!t) return;
    if (t.dataset.storeRetry !== undefined) return mountSkillStore(root, {openModal, mark});
    if (t.dataset.skill) return openSkill(t.dataset.skill, openModal);
    if (t.dataset.storeFilter) { ui.filter = t.dataset.storeFilter; ui.shown = PAGE; }
    if (t.dataset.storeSort) ui.sort = t.dataset.storeSort;
    if (t.dataset.storeMore !== undefined) ui.shown += PAGE;
    draw(cache);
  };
  root.oninput = event => {
    if (!event.target.matches('[data-store-search]')) return;
    ui.query = event.target.value; ui.shown = PAGE;
    const at = event.target.selectionStart;
    draw(cache);
    const input = root.querySelector('[data-store-search]'); input.focus(); input.setSelectionRange(at, at);
  };
}

async function openSkill(id, openModal) {
  const s = cache?.find(x => x.id === id);
  if (!s) return;
  const placeholder = s.video ? `<video src="${esc(s.video)}" ${s.poster ? `poster="${esc(s.poster)}"` : ''} controls muted loop playsinline autoplay></video>` : s.poster ? `<img src="${esc(s.poster)}" alt="">` : '';
  openModal(`<div class="skill-sheet"><div class="skill-media">${placeholder}</div><div class="skill-info">
    <div class="skill-top">${s.official ? '<span class="store-badge official">Pollen</span>' : ''}<a href="${HUB}/${esc(s.id)}" target="_blank" rel="noopener noreferrer">${esc(s.id)} ↗</a></div>
    <h2>${esc(s.name)}</h2><p class="skill-desc" data-skill-desc>Loading details…</p>
    <dl class="skill-facts" data-skill-facts></dl>
    <div class="skill-install"><span>Put it on your duck</span><div class="skill-cmd"><code data-skill-cmd>sudo robotctl policy add ${esc(skillName(s.id))} ${esc(s.id)}</code><button type="button" data-copy-cmd>Copy</button></div>
    <small data-skill-run>Then run it with <code>robotctl robot do ${esc(skillName(s.id))}</code>. The duck must be driving: press Start on the pad first.</small></div>
    <p class="skill-warning" data-skill-warning hidden></p>
    <p class="store-note">Published by <a href="${HUB}/${esc(s.owner)}" target="_blank" rel="noopener noreferrer">${esc(s.owner)}</a>${s.license ? ` under ${esc(s.license)}` : ''}. Not checked by Ducktown or Pollen.</p>
  </div></div>`, true, 'skill');
  const modal = document.querySelector('.modal-skill');
  modal?.querySelector('[data-copy-cmd]')?.addEventListener('click', async event => {
    const text = modal.querySelector('[data-skill-cmd]').textContent;
    try { await navigator.clipboard.writeText(text); event.target.textContent = 'Copied'; } catch { event.target.textContent = 'Select & copy'; }
    setTimeout(() => { event.target.textContent = 'Copy'; }, 1800);
  });
  const [manifest, summary] = await Promise.all([s.hasManifest ? loadManifest(s.id) : null, loadSummary(s.id)]);
  if (!modal?.isConnected) return;
  const name = skillName(s.id, manifest);
  const kind = manifest?.kind === 'episodic' ? 'Trick (runs once)' : manifest?.kind === 'perpetual' ? 'Gait or hold (runs until stopped)' : s.kind === 'gait' ? 'Gait' : null;
  const facts = [
    kind && ['Type', kind],
    manifest?.duration_s && ['Length', `${manifest.duration_s} s`],
    manifest?.robot?.control_hz && ['Runs at', `${manifest.robot.control_hz} Hz`],
    manifest?.entry_pose && ['Starts from', manifest.entry_pose],
    manifest?.training?.repo && ['Trained with', manifest.training.repo.replace('pollen-robotics/', '')],
    ['Likes', compact(s.likes)], ['Downloads', compact(s.downloads)], ['Updated', ago(s.updated)]
  ].filter(Boolean);
  modal.querySelector('[data-skill-desc]').textContent = manifest?.description || summary || 'The maker has not written a description yet. See the model page for details.';
  modal.querySelector('[data-skill-facts]').innerHTML = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  const perpetual = manifest?.kind === 'perpetual';
  modal.querySelector('[data-skill-cmd]').textContent = `sudo robotctl policy add ${name} ${s.id}${perpetual ? ' --hold 5' : ''}`;
  modal.querySelector('[data-skill-run]').innerHTML = `Then run it with <code>robotctl robot do ${esc(name)}</code>. The duck must be driving: press Start on the pad first.${perpetual ? ' This one holds until stopped, so <code>--hold 5</code> gives it a length; check its notes for any command it needs.' : ''}`;
  const limits = manifest?.eval?.known_limits || (/never (been )?(run|tested) on hardware|sim only/i.test(summary + JSON.stringify(manifest || {})) ? 'Only tested in simulation so far.' : '');
  if (limits) { const w = modal.querySelector('[data-skill-warning]'); w.hidden = false; w.textContent = `Known limits: ${limits}`; }
}
