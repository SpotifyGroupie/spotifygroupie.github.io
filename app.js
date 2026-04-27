const CLIENT_ID = '33adcc7d9d21461692e6abbe93dc51ef';
const REDIRECT_URI = 'https://spotifygroupie.github.io';

const FRIEND_NAMES = {
  '92swuvcb8qlcp67ghfse2wyhp':    'AdrianRPNK',
  'xea9kyo32dr4zuxny05sur22m':    'GooberBone',
  '31kwvg2lk7q6cda4uh2riaf3hrp4': 'Hess',
  'mqf7xginrz6bg63s5fl4pvqxn':    'The Rat Creature',
  '31c7w4225cc4vzo7dlrrypgwg6ju': 'Lương Gia Bửu',
  '9ucq3a7eyyaim0qnb1qe2xyo9':    'melkbot',
  '5mivh7dtynq4owuyq9evq66ji':    'Supernova',
  '66qcq61mvxvpfqzb32au640vq':    'Andrew Austrager',
};

// ---- State ----
let accessToken = null;
let allTracks = [];
let memberMap = {};
let activeMembers = new Set();
let queueTracks = [];
let manualMode = false;
let manualMembers = {};
let manualIdCounter = 0;
let loadingPlaylist = false;

// ---- Helpers ----
function $(id) { return document.getElementById(id); }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(id, msg, cls) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

function showStep(id) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
  window.scrollTo(0, 0);
}

function goBack(step) { showStep(step); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- OAuth PKCE ----
async function sha256(plain) {
  const enc = new TextEncoder().encode(plain);
  return crypto.subtle.digest('SHA-256', enc);
}

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function doAuth() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await sha256(verifier));
  localStorage.setItem('gqf_verifier', verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: 'playlist-read-private playlist-read-collaborative user-modify-playback-state user-read-playback-state user-read-private',
  });

  window.location = 'https://accounts.spotify.com/authorize?' + params;
}

async function exchangeCode(code) {
  const verifier = localStorage.getItem('gqf_verifier');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error + ': ' + (data.error_description || ''));
  if (!data.access_token) throw new Error('No token: ' + JSON.stringify(data));
  return data.access_token;
}

// ---- Spotify API ----
async function spotifyGet(url) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!res.ok) {
    let errMsg = res.status + ' ' + res.statusText;
    try { const e = await res.json(); errMsg = JSON.stringify(e); } catch (_) {}
    throw new Error(errMsg);
  }
  return res.json();
}

// ---- Load playlists ----
async function loadPlaylists() {
  showStep('step-playlists');
  $('playlist-grid').innerHTML = '<div class="loading">Loading your playlists…</div>';

  try {
    let playlists = [];
    let url = 'https://api.spotify.com/v1/me/playlists?limit=50';
    while (url) {
      const data = await spotifyGet(url);
      playlists = playlists.concat(data.items || []);
      url = data.next;
    }

    if (playlists.length === 0) {
      $('playlist-grid').innerHTML = '<div class="loading">No playlists found.</div>';
      return;
    }

    $('playlist-grid').innerHTML = '';
    playlists.forEach(pl => {
      if (!pl) return;
      const imgUrl = pl.images?.[0]?.url;
      const imgHtml = imgUrl
        ? `<img src="${esc(imgUrl)}" alt="" loading="lazy">`
        : '<div class="pl-img-placeholder"></div>';

      const card = document.createElement('div');
      card.className = 'playlist-card';
      card.innerHTML = `
        ${imgHtml}
        <div class="playlist-card-info">
          <div class="playlist-card-name">${esc(pl.name || 'Untitled')}</div>
          <div class="playlist-card-count">${pl.tracks?.total ?? pl.items?.total ?? 0} tracks</div>
        </div>`;
      card.onclick = () => selectPlaylist(pl);
      $('playlist-grid').appendChild(card);
    });
  } catch (e) {
    $('playlist-grid').innerHTML = `<div class="loading" style="color:#e05">✗ ${esc(e.message)}</div>`;
  }
}

// ---- Select playlist ----
async function selectPlaylist(pl) {
  if (loadingPlaylist) return;
  loadingPlaylist = true;
  const imgUrl = pl.images?.[0]?.url;
  const selImgHtml = imgUrl
    ? `<img src="${esc(imgUrl)}" alt="">`
    : '<div class="pl-img-placeholder"></div>';

  $('selected-playlist-display').innerHTML = `
    <div class="selected-playlist">
      ${selImgHtml}
      <div>
        <div class="selected-playlist-name">${esc(pl.name || 'Untitled')}</div>
        <div class="selected-playlist-count">${pl.tracks?.total ?? pl.items?.total ?? 0} tracks</div>
      </div>
    </div>`;

  showStep('step-members');
  $('members-grid').innerHTML = '<div class="loading">Loading tracks & members…</div>';
  setStatus('status2', '');
  activeMembers = new Set();
  allTracks = [];
  memberMap = {};
  manualMode = false;
  manualMembers = {};

  try {
    let skipped = 0;
    let url = `https://api.spotify.com/v1/playlists/${pl.id}/items?limit=100`;
    while (url) {
      const data = await spotifyGet(url);
      for (const item of (data.items || [])) {
        // Spotify uses "item" field for mixed playlists (tracks + episodes), "track" for legacy
        const track = item?.item ?? item?.track;
        if (!track || track.type !== 'track' || track.is_local || !track.uri) {
          skipped++;
          continue;
        }
        const userId = item.added_by?.id || 'unknown';
        allTracks.push({
          name: track.name || 'Unknown',
          artist: track.artists?.map(a => a.name).join(', ') || '',
          addedBy: userId,
          uri: track.uri,
        });
        if (userId && userId !== 'unknown') memberMap[userId] = userId;
      }
      url = data.next;
    }

    if (allTracks.length === 0) {
      const reason = skipped > 0
        ? `All ${skipped} tracks are local files or no longer available on Spotify and can't be queued via the API.`
        : 'No tracks found in this playlist.';
      $('members-grid').innerHTML = `<div class="loading" style="color:#e05">✗ ${esc(reason)}</div>`;
      setStatus('status2', '✗ 0 tracks loaded', 'err');
      return;
    }

    // Spotify's /users/{id} endpoint is restricted to 403 for other users.
    // Only /me works reliably, so identify the current user and shorten other IDs.
    const savedNames = JSON.parse(localStorage.getItem('gqf_names') || '{}');
    Object.keys(memberMap).forEach(uid => {
      memberMap[uid] = savedNames[uid] || FRIEND_NAMES[uid] || (uid.length > 15 ? uid.slice(0, 10) + '...' : uid);
    });

    renderMembersGrid();
    const skipNote = skipped > 0 ? ` (${skipped} local/unavailable skipped)` : '';
    setStatus('status2', `✓ ${allTracks.length} tracks loaded${skipNote}`, 'ok');
  } catch (e) {
    $('members-grid').innerHTML = `<div class="loading" style="color:#e05">✗ ${esc(e.message)}</div>`;
  } finally {
    loadingPlaylist = false;
  }
}

// ---- Members ----
function renderMembersGrid() {
  const grid = $('members-grid');
  grid.innerHTML = '';
  grid.classList.remove('manual');
  const users = Object.keys(memberMap);
  if (users.length === 0) {
    showManualMode();
    return;
  }
  users.forEach(uid => {
    const trackCount = allTracks.filter(t => t.addedBy === uid).length;
    const chip = document.createElement('div');
    chip.className = 'member-chip';

    const nameEl = document.createElement('span');
    nameEl.className = 'member-label';
    nameEl.textContent = memberMap[uid];

    const editBtn = document.createElement('button');
    editBtn.className = 'rename-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'Rename';
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = memberMap[uid];
      input.className = 'rename-input';
      nameEl.replaceWith(input);
      editBtn.style.display = 'none';
      input.focus();
      input.select();
      const save = () => {
        const val = input.value.trim() || memberMap[uid];
        memberMap[uid] = val;
        const savedNames = JSON.parse(localStorage.getItem('gqf_names') || '{}');
        savedNames[uid] = val;
        localStorage.setItem('gqf_names', JSON.stringify(savedNames));
        nameEl.textContent = val;
        input.replaceWith(nameEl);
        editBtn.style.display = '';
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    });

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex;align-items:center;gap:2px;min-width:0';
    nameEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1';
    nameRow.appendChild(nameEl);
    nameRow.appendChild(editBtn);

    const nameWrap = document.createElement('div');
    nameWrap.className = 'member-name';
    nameWrap.appendChild(nameRow);
    nameWrap.insertAdjacentHTML('beforeend', `<span style="font-size:0.6rem;color:var(--muted)">${trackCount} songs</span>`);

    chip.innerHTML = '';
    chip.appendChild(document.createElement('div')).className = 'dot';
    chip.appendChild(nameWrap);
    chip.addEventListener('click', () => {
      if (activeMembers.has(uid)) activeMembers.delete(uid);
      else activeMembers.add(uid);
      chip.classList.toggle('active', activeMembers.has(uid));
    });
    grid.appendChild(chip);
  });
}

function showManualMode() {
  manualMode = true;
  const grid = $('members-grid');
  grid.classList.add('manual');
  grid.innerHTML = `
    <div class="manual-notice">
      Spotify didn't return contributor info for this playlist.
      Add everyone in your group below. Tracks will be split evenly among them.
    </div>
    <div class="manual-add-row">
      <input type="text" id="manualNameInput" placeholder="Name (e.g. Alice)" />
      <button class="btn manual-add-btn" onclick="addManualMember()">+</button>
    </div>
    <div class="members-grid" id="manual-chips"></div>`;
  $('manualNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addManualMember();
  });
}

function addManualMember() {
  const input = $('manualNameInput');
  const name = input.value.trim();
  if (!name) return;
  const id = 'manual_' + (++manualIdCounter);
  manualMembers[id] = name;
  memberMap[id] = name;
  input.value = '';
  input.focus();
  renderManualChips();
}

function removeManualMember(id) {
  delete manualMembers[id];
  delete memberMap[id];
  activeMembers.delete(id);
  renderManualChips();
}

function renderManualChips() {
  const container = $('manual-chips');
  if (!container) return;
  container.innerHTML = '';
  Object.entries(manualMembers).forEach(([id, name]) => {
    const chip = document.createElement('div');
    chip.className = 'member-chip' + (activeMembers.has(id) ? ' active' : '');
    chip.innerHTML = `
      <div class="dot"></div>
      <div class="member-name">${esc(name)}</div>
      <button class="chip-remove" onclick="event.stopPropagation();removeManualMember('${id}')">✕</button>`;
    chip.onclick = () => {
      if (activeMembers.has(id)) activeMembers.delete(id);
      else activeMembers.add(id);
      chip.classList.toggle('active', activeMembers.has(id));
    };
    container.appendChild(chip);
  });
}

function selectAll(val) {
  const keys = manualMode ? Object.keys(manualMembers) : Object.keys(memberMap);
  keys.forEach(id => val ? activeMembers.add(id) : activeMembers.delete(id));
  document.querySelectorAll('.member-chip').forEach(c => c.classList.toggle('active', val));
}

// ---- Build queue ----
function buildQueue() {
  if (manualMode && Object.keys(manualMembers).length === 0) { alert('Add at least one person first!'); return; }
  if (activeMembers.size === 0) { alert('Select at least one person!'); return; }

  let filtered;
  if (manualMode) {
    const allIds = Object.keys(manualMembers);
    const pool = shuffle(allTracks).map((t, i) => ({ ...t, addedBy: allIds[i % allIds.length] }));
    filtered = pool.filter(t => activeMembers.has(t.addedBy));
  } else {
    filtered = allTracks.filter(t => activeMembers.has(t.addedBy));
  }

  if (filtered.length === 0) { alert('No tracks found for selected members.'); return; }

  const equalMode = $('equalMode')?.checked;
  if (equalMode) {
    const members = [...activeMembers];
    const pools = {};
    members.forEach(uid => {
      pools[uid] = shuffle(filtered.filter(t => t.addedBy === uid));
    });
    queueTracks = [];
    while (members.some(uid => pools[uid].length > 0)) {
      const remaining = members.filter(uid => pools[uid].length > 0);
      const uid = remaining[Math.floor(Math.random() * remaining.length)];
      queueTracks.push(pools[uid].pop());
    }
  } else {
    queueTracks = shuffle(filtered);
  }
  $('q-count').textContent = queueTracks.length;
  $('q-members').textContent = activeMembers.size;

  const list = $('track-list');
  list.innerHTML = '';
  queueTracks.forEach((t, i) => {
    const div = document.createElement('div');
    div.className = 'track-item';
    div.innerHTML = `
      <div class="track-num">${i + 1}</div>
      <div class="track-info">
        <div class="track-name">${esc(t.name)}</div>
        <div class="track-artist">${esc(t.artist)}</div>
      </div>
      <div class="track-added">${esc(memberMap[t.addedBy] || t.addedBy)}</div>`;
    list.appendChild(div);
  });

  showStep('step-queue');
}

// ---- Playback ----
async function startPlayback() {
  if (!queueTracks.length) return;
  setStatus('status3', 'Finding active device...');
  try {
    const devData = await spotifyGet('https://api.spotify.com/v1/me/player/devices');
    const device = devData.devices?.find(d => d.is_active) || devData.devices?.[0];
    if (!device) {
      setStatus('status3', '✗ No active device found. Open Spotify and play something first.', 'err');
      return;
    }

    // Start first track
    await fetch('https://api.spotify.com/v1/me/player/play?device_id=' + device.id, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [queueTracks[0].uri] }),
    });

    // Queue the rest
    for (let i = 1; i < queueTracks.length; i++) {
      setStatus('status3', `Queuing tracks... ${i} / ${queueTracks.length - 1}`);
      let res;
      for (let attempt = 0; attempt < 5; attempt++) {
        res = await fetch(
          `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(queueTracks[i].uri)}&device_id=${device.id}`,
          { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken } }
        );
        if (res.status === 429) {
          const wait = (parseInt(res.headers.get('Retry-After') || '2') + 1) * 1000;
          await new Promise(r => setTimeout(r, wait));
        } else {
          break;
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }

    setStatus('status3', `Queued ${queueTracks.length} tracks on "${device.name}"!`, 'ok');
  } catch (e) {
    setStatus('status3', '✗ ' + e.message, 'err');
  }
}

// ---- Init: handle OAuth callback ----
(async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  showStep('step-setup');

  if (error) {
    setStatus('status', 'Spotify login failed: ' + error, 'err');
    window.history.replaceState({}, '', window.location.pathname);
    return;
  }

  if (!code) return;

  window.history.replaceState({}, '', window.location.pathname);
  setStatus('status', 'Connecting to Spotify...');

  try {
    accessToken = await exchangeCode(code);
    await loadPlaylists();
  } catch (e) {
    setStatus('status', '✗ ' + e.message, 'err');
  }
})();
