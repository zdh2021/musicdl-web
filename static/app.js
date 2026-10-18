(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const LS_KEY = "musicdl_library_v1";
  const LS_MODE = "musicdl_play_mode";
  const LS_SOURCES = "musicdl_sources";
  const MODES = ["sequential", "shuffle", "repeat-one", "repeat-all"];
  const MODE_LABEL = {
    sequential: "顺序播放",
    shuffle: "随机播放",
    "repeat-one": "单曲循环",
    "repeat-all": "列表循环",
  };

  const state = {
    sources: [],
    searchTracks: new Map(),
    searching: false,
    es: null,
    page: "search",
    activePlaylistId: null,
    menuTrack: null,
    addPlTrack: null,
    queue: [],
    queueIndex: -1,
    mode: localStorage.getItem(LS_MODE) || "sequential",
    seeking: false,
    shuffleOrder: [],
  };

  const library = loadLibrary();

  const els = {
    pageTitle: $("#page-title"),
    form: $("#search-form"),
    q: $("#q"),
    sources: $("#sources"),
    searchResults: $("#search-results"),
    searchEmpty: $("#search-empty"),
    metaBar: $("#meta-bar"),
    metaText: $("#meta-text"),
    sourceChips: $("#source-chips"),
    resultCount: $("#result-count"),
    searchActions: $("#search-actions"),
    favList: $("#fav-list"),
    favCount: $("#fav-count"),
    playlistGrid: $("#playlist-grid"),
    plDetailTitle: $("#pl-detail-title"),
    plDetailCount: $("#pl-detail-count"),
    plDetailList: $("#pl-detail-list"),
    audio: $("#audio"),
    nowBar: $("#now-bar"),
    coverMini: $("#cover-mini"),
    coverMiniPh: $("#cover-mini-ph"),
    cover: $("#cover"),
    coverPh: $("#cover-ph"),
    nowTitle: $("#now-title"),
    nowArtist: $("#now-artist"),
    sheetTitle: $("#sheet-title"),
    sheetArtist: $("#sheet-artist"),
    btnPlay: $("#btn-play"),
    btnPlayBig: $("#btn-play-big"),
    lyric: $("#lyric"),
    dlStatus: $("#dl-status"),
    playerSheet: $("#player-sheet"),
    progressFill: $("#progress-fill"),
    progressFillBig: $("#progress-fill-big"),
    progressTrack: $("#progress-track"),
    progressTrackBig: $("#progress-track-big"),
    timeCurBig: $("#time-cur-big"),
    timeDurBig: $("#time-dur-big"),
    toast: $("#toast"),
    sourcesDialog: $("#sources-dialog"),
    filesDialog: $("#files-dialog"),
    addPlDialog: $("#add-pl-dialog"),
    addPlList: $("#add-pl-list"),
    trackMenu: $("#track-menu"),
    trackMenuTitle: $("#track-menu-title"),
    trackMenuActions: $("#track-menu-actions"),
    filesList: $("#files-list"),
    filesDir: $("#files-dir"),
    btnFavNow: $("#btn-fav-now"),
    btnMode: $("#btn-mode"),
  };

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function loadLibrary() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        return {
          favorites: Array.isArray(d.favorites) ? d.favorites : [],
          playlists: Array.isArray(d.playlists) ? d.playlists : [],
        };
      }
    } catch (_) {}
    return { favorites: [], playlists: [] };
  }

  function saveLibrary() {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        favorites: library.favorites,
        playlists: library.playlists,
        updated: Date.now(),
      })
    );
    // best-effort server sync
    fetch("/api/library", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        favorites: library.favorites,
        playlists: library.playlists,
      }),
    }).catch(() => {});
  }

  function trackKey(t) {
    return (
      (t.token || "") +
      "|" +
      (t.source_id || t.source || "") +
      "|" +
      (t.song_name || "") +
      "|" +
      (t.singers || "")
    );
  }

  function sameTrack(a, b) {
    if (!a || !b) return false;
    if (a.token && b.token && a.token === b.token) return true;
    return (
      (a.song_name || "") === (b.song_name || "") &&
      (a.singers || "") === (b.singers || "") &&
      (a.source_id || a.source || "") === (b.source_id || b.source || "")
    );
  }

  function cloneTrack(t) {
    return {
      token: t.token,
      source: t.source,
      source_id: t.source_id,
      source_label: t.source_label,
      song_name: t.song_name,
      singers: t.singers,
      album: t.album || "",
      ext: t.ext || "",
      file_size: t.file_size || "",
      duration: t.duration || "",
      cover_url: t.cover_url || "",
      has_lyric: !!t.has_lyric,
      lossless: !!t.lossless,
      has_url: t.has_url !== false,
      saved_at: Date.now(),
    };
  }

  function isFav(t) {
    return library.favorites.some((x) => sameTrack(x, t));
  }

  function toggleFav(t) {
    const i = library.favorites.findIndex((x) => sameTrack(x, t));
    if (i >= 0) {
      library.favorites.splice(i, 1);
      toast("已取消收藏");
    } else {
      library.favorites.unshift(cloneTrack(t));
      toast("已加入收藏");
    }
    saveLibrary();
    updateFavButton();
    if (state.page === "fav") renderFavPage();
    refreshVisibleRows();
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      els.toast.hidden = true;
    }, 1800);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    return m + ":" + String(s % 60).padStart(2, "0");
  }

  function fmtBytes(n) {
    if (!n || n <= 0) return "";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return v.toFixed(i ? 1 : 0) + " " + u[i];
  }

  function coverSrc(t) {
    if (!t) return "";
    if (t.cover_url && t.token) return `/api/cover/${t.token}`;
    return "";
  }

  /* ---------- pages ---------- */
  function showPage(name, opts = {}) {
    state.page = name;
    $$(".page").forEach((p) => {
      p.hidden = p.dataset.page !== name;
    });
    $$(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name || (name === "playlist-detail" && t.dataset.tab === "playlists")));
    const titles = {
      search: "搜索",
      fav: "收藏",
      playlists: "歌单",
      "playlist-detail": opts.title || "歌单",
    };
    els.pageTitle.textContent = titles[name] || "音乐";
    if (name === "fav") renderFavPage();
    if (name === "playlists") renderPlaylistsPage();
    if (name === "playlist-detail") renderPlaylistDetail();
  }

  /* ---------- track row ---------- */
  function renderRow(t, opts = {}) {
    const row = document.createElement("div");
    row.className = "row";
    row.dataset.key = trackKey(t);
    const current = state.queue[state.queueIndex];
    if (current && sameTrack(current, t)) row.classList.add("active");
    const csrc = coverSrc(t);
    const fav = isFav(t);
    row.innerHTML = `
      ${csrc ? `<img class="thumb" src="${csrc}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'" /><div class="thumb-ph" style="display:none">♪</div>` : `<div class="thumb-ph">♪</div>`}
      <div class="info">
        <div class="t"></div>
        <div class="a"></div>
      </div>
      <div class="side">
        <span class="tag">${escapeHtml(t.source || "")}</span>
        <button type="button" class="icon-mini fav-btn ${fav ? "on" : ""}" data-act="fav" aria-label="收藏">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${fav ? "#ff453a" : "none"}" stroke="${fav ? "#ff453a" : "currentColor"}" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
        </button>
        <button type="button" class="icon-mini" data-act="more" aria-label="更多">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
        </button>
      </div>`;
    row.querySelector(".t").textContent = t.song_name || "未知曲目";
    row.querySelector(".a").textContent = `${t.singers || "未知艺人"}${t.duration ? " · " + t.duration : ""}`;

    row.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act) {
        e.stopPropagation();
        if (act.dataset.act === "fav") toggleFav(t);
        if (act.dataset.act === "more") openTrackMenu(t, opts);
        return;
      }
      let list = opts.list;
      if (typeof opts.getList === "function") list = opts.getList();
      if (!list || !list.length) list = [t];
      const idx = Math.max(0, list.findIndex((x) => sameTrack(x, t)));
      playFromList(list, idx < 0 ? 0 : idx);
    });
    return row;
  }

  function refreshVisibleRows() {
    // lightweight: re-render current page lists
    if (state.page === "search") {
      // update fav icons only
      $$("#search-results .row").forEach((row) => {
        const token = [...state.searchTracks.values()].find((t) => trackKey(t) === row.dataset.key);
        if (!token) return;
        const btn = row.querySelector(".fav-btn");
        if (!btn) return;
        const fav = isFav(token);
        btn.classList.toggle("on", fav);
        const svg = btn.querySelector("svg");
        if (svg) {
          svg.setAttribute("fill", fav ? "#ff453a" : "none");
          svg.setAttribute("stroke", fav ? "#ff453a" : "currentColor");
        }
      });
    }
  }

  function renderTrackList(container, tracks, emptyMsg) {
    container.innerHTML = "";
    if (!tracks.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">♪</div><p>${escapeHtml(emptyMsg)}</p></div>`;
      return;
    }
    const list = tracks;
    for (const t of list) {
      container.appendChild(renderRow(t, { list, getList: () => list }));
    }
  }

  /* ---------- search ---------- */
  function selectedSources() {
    const checked = $$("#sources input:checked").map((i) => i.value);
    if (checked.length) {
      localStorage.setItem(LS_SOURCES, JSON.stringify(checked));
      return checked;
    }
    return state.sources.filter((s) => s.default).map((s) => s.id);
  }

  async function loadSources() {
    const res = await fetch("/api/sources");
    state.sources = await res.json();
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(LS_SOURCES) || "null");
    } catch (_) {}
    els.sources.innerHTML = "";
    for (const s of state.sources) {
      const on = saved ? saved.includes(s.id) : s.default;
      const label = document.createElement("label");
      label.className = "source-chip" + (on ? " on" : "");
      label.innerHTML = `<input type="checkbox" value="${s.id}" ${on ? "checked" : ""} /><span>${s.label}</span>`;
      label.querySelector("input").addEventListener("change", (e) => {
        label.classList.toggle("on", e.target.checked);
        selectedSources();
      });
      els.sources.appendChild(label);
    }
  }

  function ensureChip(sourceId, label) {
    let el = els.sourceChips.querySelector(`[data-s="${sourceId}"]`);
    if (!el) {
      el = document.createElement("span");
      el.className = "chip wait";
      el.dataset.s = sourceId;
      el.textContent = label || sourceId;
      els.sourceChips.appendChild(el);
    }
    return el;
  }

  function sourceLabel(id) {
    const s = state.sources.find((x) => x.id === id);
    return s ? s.label : id;
  }

  function search(q) {
    if (state.searching && state.es) {
      try { state.es.close(); } catch (_) {}
    }
    const sources = selectedSources();
    if (!sources.length) {
      toast("请先选择音源");
      els.sourcesDialog.showModal();
      return;
    }
    state.searching = true;
    state.searchTracks.clear();
    els.searchActions.hidden = false;
    els.resultCount.textContent = "";
    els.metaBar.hidden = false;
    els.metaText.textContent = `正在搜索「${q}」…`;
    els.sourceChips.innerHTML = "";
    els.searchResults.innerHTML = `<div class="empty-state"><div class="empty-icon">♪</div><p>搜索中，结果会陆续出现…</p></div>`;

    const url = `/api/search?q=${encodeURIComponent(q)}&sources=${encodeURIComponent(sources.join(","))}`;
    const es = new EventSource(url);
    state.es = es;

    es.addEventListener("source_start", (ev) => {
      const d = JSON.parse(ev.data);
      ensureChip(d.source, d.label).className = "chip wait";
    });
    es.addEventListener("result", (ev) => {
      const t = JSON.parse(ev.data);
      if (state.searchTracks.has(t.token)) return;
      state.searchTracks.set(t.token, t);
      if (state.searchTracks.size === 1) els.searchResults.innerHTML = "";
      els.searchResults.appendChild(
        renderRow(t, { getList: () => [...state.searchTracks.values()] })
      );
      // fix list refs on each append for play-from-list
      els.resultCount.textContent = `${state.searchTracks.size} 首`;
    });
    es.addEventListener("source_done", (ev) => {
      const d = JSON.parse(ev.data);
      const chip = ensureChip(d.source);
      chip.className = "chip " + (d.timed_out ? "wait" : "ok");
      chip.textContent = `${sourceLabel(d.source)} · ${d.count}${d.timed_out ? " (超时)" : ""}`;
    });
    es.addEventListener("source_error", (ev) => {
      const d = JSON.parse(ev.data);
      const chip = ensureChip(d.source);
      chip.className = "chip err";
      chip.title = d.message || "";
      chip.textContent = `${sourceLabel(d.source)} · 失败`;
    });
    es.addEventListener("done", (ev) => {
      const d = JSON.parse(ev.data);
      state.searching = false;
      es.close();
      state.es = null;
      // rebuild rows with full list reference for correct queue
      const list = [...state.searchTracks.values()];
      renderTrackList(els.searchResults, list, "没有找到结果，换个关键词或音源试试");
      els.metaText.textContent = `搜索完成，共 ${d.count} 首`;
      els.resultCount.textContent = list.length ? `${list.length} 首` : "";
    });
    es.onerror = () => {
      if (!state.searching) return;
      state.searching = false;
      es.close();
      state.es = null;
      els.metaText.textContent = "连接中断，已显示收到的结果";
      const list = [...state.searchTracks.values()];
      if (!list.length) {
        els.searchResults.innerHTML = `<div class="empty-state"><div class="empty-icon">♪</div><p>搜索失败，请稍后重试</p></div>`;
      } else {
        renderTrackList(els.searchResults, list, "");
      }
    };
  }

  /* ---------- favorites / playlists ---------- */
  function renderFavPage() {
    els.favCount.textContent = `${library.favorites.length} 首`;
    renderTrackList(els.favList, library.favorites, "还没有收藏，去搜索里点 ♥ 吧");
  }

  function renderPlaylistsPage() {
    els.playlistGrid.innerHTML = "";
    if (!library.playlists.length) {
      els.playlistGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">♪</div><p>还没有歌单</p><p class="muted small">点上方「新建歌单」，或从搜索结果加入</p></div>`;
      return;
    }
    for (const pl of library.playlists) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "pl-card";
      card.innerHTML = `
        <div class="pl-cover">♫</div>
        <div class="pl-info">
          <div class="pl-name"></div>
          <div class="pl-meta">${(pl.tracks || []).length} 首</div>
        </div>`;
      card.querySelector(".pl-name").textContent = pl.name;
      card.addEventListener("click", () => {
        state.activePlaylistId = pl.id;
        showPage("playlist-detail", { title: pl.name });
      });
      els.playlistGrid.appendChild(card);
    }
  }

  function getActivePlaylist() {
    return library.playlists.find((p) => p.id === state.activePlaylistId);
  }

  function renderPlaylistDetail() {
    const pl = getActivePlaylist();
    if (!pl) {
      showPage("playlists");
      return;
    }
    els.plDetailTitle.textContent = pl.name;
    els.plDetailCount.textContent = `${(pl.tracks || []).length} 首`;
    renderTrackList(els.plDetailList, pl.tracks || [], "歌单是空的，从搜索结果加入歌曲");
  }

  function createPlaylist(name) {
    const pl = { id: uid(), name: name || "新建歌单", tracks: [], created: Date.now() };
    library.playlists.unshift(pl);
    saveLibrary();
    return pl;
  }

  function addToPlaylist(plId, track) {
    const pl = library.playlists.find((p) => p.id === plId);
    if (!pl) return;
    pl.tracks = pl.tracks || [];
    if (pl.tracks.some((x) => sameTrack(x, track))) {
      toast("歌单里已有此曲");
      return;
    }
    pl.tracks.push(cloneTrack(track));
    saveLibrary();
    toast(`已加入「${pl.name}」`);
  }

  function openAddPlaylist(track) {
    state.addPlTrack = track;
    els.addPlList.innerHTML = "";
    if (!library.playlists.length) {
      els.addPlList.innerHTML = `<p class="muted small">还没有歌单，点下方新建</p>`;
    }
    for (const pl of library.playlists) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "add-pl-item";
      btn.textContent = `${pl.name}（${(pl.tracks || []).length}）`;
      btn.addEventListener("click", () => {
        addToPlaylist(pl.id, track);
        els.addPlDialog.close();
      });
      els.addPlList.appendChild(btn);
    }
    els.addPlDialog.showModal();
  }

  function openTrackMenu(t, opts = {}) {
    state.menuTrack = t;
    els.trackMenuTitle.textContent = t.song_name || "曲目";
    els.trackMenuActions.innerHTML = "";
    const items = [
      { label: isFav(t) ? "取消收藏" : "加入收藏", fn: () => toggleFav(t) },
      { label: "加入歌单", fn: () => openAddPlaylist(t) },
      { label: "下一首播放", fn: () => queueNext(t) },
      { label: "下载", fn: () => downloadToken(t.token) },
    ];
    if (opts.list === library.favorites) {
      items.push({
        label: "从收藏移除",
        fn: () => {
          library.favorites = library.favorites.filter((x) => !sameTrack(x, t));
          saveLibrary();
          renderFavPage();
          toast("已移除");
        },
      });
    }
    const pl = getActivePlaylist();
    if (state.page === "playlist-detail" && pl) {
      items.push({
        label: "从歌单移除",
        fn: () => {
          pl.tracks = (pl.tracks || []).filter((x) => !sameTrack(x, t));
          saveLibrary();
          renderPlaylistDetail();
          toast("已移除");
        },
      });
    }
    for (const it of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "menu-item";
      b.textContent = it.label;
      b.addEventListener("click", () => {
        els.trackMenu.close();
        it.fn();
      });
      els.trackMenuActions.appendChild(b);
    }
    els.trackMenu.showModal();
  }

  function queueNext(t) {
    if (!state.queue.length) {
      playFromList([t], 0);
      return;
    }
    state.queue.splice(state.queueIndex + 1, 0, cloneTrack(t));
    toast("已加入下一首");
  }

  /* ---------- playback ---------- */
  function setPlayingUI(playing) {
    for (const btn of [els.btnPlay, els.btnPlayBig]) {
      if (!btn) continue;
      const play = btn.querySelector(".ic-play");
      const pause = btn.querySelector(".ic-pause");
      if (play) play.hidden = playing;
      if (pause) pause.hidden = !playing;
    }
  }

  function updateModeUI() {
    const m = state.mode;
    const map = {
      sequential: ".mode-seq",
      shuffle: ".mode-shuffle",
      "repeat-one": ".mode-one",
      "repeat-all": ".mode-all",
    };
    $$("#btn-mode svg").forEach((s) => (s.hidden = true));
    const sel = map[m] || ".mode-seq";
    const el = $(sel, els.btnMode);
    if (el) el.hidden = false;
    els.btnMode.title = MODE_LABEL[m] || m;
  }

  function cycleMode() {
    const i = MODES.indexOf(state.mode);
    state.mode = MODES[(i + 1) % MODES.length];
    localStorage.setItem(LS_MODE, state.mode);
    updateModeUI();
    toast(MODE_LABEL[state.mode]);
    if (state.mode === "shuffle") rebuildShuffle();
  }

  function rebuildShuffle() {
    const n = state.queue.length;
    state.shuffleOrder = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.shuffleOrder[i], state.shuffleOrder[j]] = [state.shuffleOrder[j], state.shuffleOrder[i]];
    }
    // keep current near front
    if (state.queueIndex >= 0) {
      const idx = state.shuffleOrder.indexOf(state.queueIndex);
      if (idx > 0) {
        state.shuffleOrder.splice(idx, 1);
        state.shuffleOrder.unshift(state.queueIndex);
      }
    }
  }

  function playFromList(list, index) {
    if (!list || !list.length) return;
    state.queue = list.map(cloneTrack);
    state.queueIndex = Math.max(0, Math.min(index, state.queue.length - 1));
    if (state.mode === "shuffle") rebuildShuffle();
    playCurrent();
  }

  function playCurrent() {
    const t = state.queue[state.queueIndex];
    if (!t || !t.token) {
      toast("曲目无效，请重新搜索");
      return;
    }
    els.nowBar.hidden = false;
    document.body.classList.add("has-now");
    els.btnPlay.disabled = false;
    els.btnPlayBig.disabled = false;

    const title = t.song_name || "未知曲目";
    const artist = `${t.singers || "未知艺人"}${t.source_label || t.source ? " · " + (t.source_label || t.source) : ""}`;
    els.nowTitle.textContent = title;
    els.nowArtist.textContent = artist;
    els.sheetTitle.textContent = title;
    els.sheetArtist.textContent = artist;

    const csrc = coverSrc(t);
    if (csrc) {
      els.cover.src = csrc;
      els.cover.hidden = false;
      els.coverPh.hidden = true;
      els.coverMini.src = csrc;
      els.coverMini.hidden = false;
      els.coverMiniPh.hidden = true;
    } else {
      els.cover.hidden = true;
      els.coverPh.hidden = false;
      els.coverMini.hidden = true;
      els.coverMiniPh.hidden = false;
    }

    updateFavButton();
    els.audio.src = `/api/stream/${t.token}`;
    els.audio.play().catch(() => {
      toast("无法播放，可能已过期，请重新搜索");
    });
    setPlayingUI(true);

    els.lyric.textContent = "加载歌词…";
    fetch(`/api/lyric/${t.token}`)
      .then((r) => r.json())
      .then((d) => {
        els.lyric.textContent = d.lyric || "暂无歌词";
      })
      .catch(() => {
        els.lyric.textContent = "暂无歌词";
      });
  }

  function updateFavButton() {
    const t = state.queue[state.queueIndex];
    const on = t && isFav(t);
    const off = els.btnFavNow.querySelector(".heart-off");
    const onEl = els.btnFavNow.querySelector(".heart-on");
    if (off) off.hidden = !!on;
    if (onEl) onEl.hidden = !on;
  }

  function nextIndex(dir) {
    const n = state.queue.length;
    if (!n) return -1;
    if (state.mode === "repeat-one" && dir === 1 && !arguments[1]) {
      // used on ended; for manual next we skip
    }
    if (state.mode === "shuffle") {
      const pos = state.shuffleOrder.indexOf(state.queueIndex);
      let nextPos = pos + dir;
      if (state.mode === "shuffle") {
        if (nextPos >= n) nextPos = 0;
        if (nextPos < 0) nextPos = n - 1;
        return state.shuffleOrder[nextPos];
      }
    }
    let i = state.queueIndex + dir;
    if (state.mode === "repeat-all" || state.mode === "shuffle") {
      if (i >= n) i = 0;
      if (i < 0) i = n - 1;
      return i;
    }
    // sequential
    if (i >= n || i < 0) return -1;
    return i;
  }

  function playNext(manual = false) {
    if (!state.queue.length) return;
    if (!manual && state.mode === "repeat-one") {
      els.audio.currentTime = 0;
      els.audio.play().catch(() => {});
      return;
    }
    const i = (() => {
      const n = state.queue.length;
      if (state.mode === "shuffle") {
        if (!state.shuffleOrder.length) rebuildShuffle();
        const pos = state.shuffleOrder.indexOf(state.queueIndex);
        let nextPos = pos + 1;
        if (nextPos >= n) {
          if (manual || state.mode === "shuffle") {
            rebuildShuffle();
            nextPos = state.shuffleOrder[0] === state.queueIndex && n > 1 ? 1 : 0;
            // after rebuild, pick first that isn't current if possible
            for (let k = 0; k < n; k++) {
              if (state.shuffleOrder[k] !== state.queueIndex) return state.shuffleOrder[k];
            }
            return state.shuffleOrder[0];
          }
          return -1;
        }
        return state.shuffleOrder[nextPos];
      }
      let i = state.queueIndex + 1;
      if (i >= n) {
        if (state.mode === "repeat-all" || manual) return 0;
        return -1;
      }
      return i;
    })();
    if (i < 0) {
      setPlayingUI(false);
      return;
    }
    state.queueIndex = i;
    playCurrent();
  }

  function playPrev() {
    if (!state.queue.length) return;
    if (els.audio.currentTime > 3) {
      els.audio.currentTime = 0;
      return;
    }
    const n = state.queue.length;
    let i;
    if (state.mode === "shuffle") {
      if (!state.shuffleOrder.length) rebuildShuffle();
      const pos = state.shuffleOrder.indexOf(state.queueIndex);
      const prevPos = pos <= 0 ? n - 1 : pos - 1;
      i = state.shuffleOrder[prevPos];
    } else {
      i = state.queueIndex - 1;
      if (i < 0) i = state.mode === "repeat-all" ? n - 1 : 0;
    }
    state.queueIndex = i;
    playCurrent();
  }

  function togglePlay() {
    const a = els.audio;
    if (!a.src) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function updateProgress() {
    if (state.seeking) return;
    const a = els.audio;
    const dur = a.duration || 0;
    const cur = a.currentTime || 0;
    const pct = dur ? (cur / dur) * 100 : 0;
    els.progressFill.style.width = pct + "%";
    els.progressFillBig.style.width = pct + "%";
    els.timeCurBig.textContent = fmtTime(cur);
    els.timeDurBig.textContent = fmtTime(dur);
  }

  function seekFromEvent(ev, trackEl) {
    const a = els.audio;
    if (!a.duration) return;
    const rect = trackEl.getBoundingClientRect();
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
    const ratio = Math.min(1, Math.max(0, x / rect.width));
    a.currentTime = ratio * a.duration;
    updateProgress();
  }

  function bindSeek(trackEl) {
    const onDown = (ev) => {
      state.seeking = true;
      seekFromEvent(ev, trackEl);
      ev.preventDefault();
    };
    const onMove = (ev) => {
      if (!state.seeking) return;
      seekFromEvent(ev, trackEl);
    };
    const onUp = () => {
      state.seeking = false;
    };
    trackEl.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  /* ---------- download ---------- */
  function downloadToken(token) {
    if (!token) {
      toast("无法下载：请重新搜索此曲");
      return Promise.resolve();
    }
    return fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        watchDownload(d.download_id);
        els.playerSheet.hidden = false;
      })
      .catch((e) => {
        toast("下载失败：" + e.message);
      });
  }

  function watchDownload(downloadId) {
    els.dlStatus.innerHTML = `下载中…<div class="bar"><i></i></div>`;
    const bar = els.dlStatus.querySelector("i");
    const es = new EventSource(`/api/download/${downloadId}/progress`);
    es.addEventListener("progress", (ev) => {
      const d = JSON.parse(ev.data);
      if (d.status === "error") {
        els.dlStatus.textContent = "下载失败：" + (d.message || "");
        es.close();
        return;
      }
      const pct = d.total ? Math.min(100, Math.round((d.downloaded / d.total) * 100)) : 0;
      if (bar) bar.style.width = (d.total ? pct : 50) + "%";
      els.dlStatus.childNodes[0].textContent =
        `${d.status === "done" ? "已完成" : "下载中"}：${d.name || ""} ${d.total ? pct + "%" : ""}`;
      if (d.status === "done") {
        if (bar) bar.style.width = "100%";
        const a = document.createElement("a");
        a.href = `/api/file/${downloadId}`;
        a.textContent = " 打开文件";
        a.style.marginLeft = "8px";
        els.dlStatus.appendChild(a);
        toast("下载完成");
        es.close();
      }
    });
    es.onerror = () => es.close();
  }

  async function loadFiles() {
    const res = await fetch("/api/downloads");
    const data = await res.json();
    els.filesDir.textContent = "目录：" + data.dir;
    els.filesList.innerHTML = "";
    if (!data.files.length) {
      els.filesList.innerHTML = "<li class='muted'>还没有下载文件</li>";
      return;
    }
    for (const f of data.files) {
      const li = document.createElement("li");
      const when = new Date(f.mtime * 1000).toLocaleString("zh-CN", { hour12: false });
      li.innerHTML = `<div><div>${escapeHtml(f.rel)}</div><div class="muted small">${fmtBytes(f.size)} · ${when}</div></div>
        <a href="/api/downloads/file?rel=${encodeURIComponent(f.rel)}" download>下载</a>`;
      els.filesList.appendChild(li);
    }
  }

  /* ---------- events ---------- */
  els.audio.addEventListener("play", () => setPlayingUI(true));
  els.audio.addEventListener("pause", () => setPlayingUI(false));
  els.audio.addEventListener("timeupdate", updateProgress);
  els.audio.addEventListener("loadedmetadata", updateProgress);
  els.audio.addEventListener("ended", () => playNext(false));
  els.audio.addEventListener("error", () => {
    toast("播放出错，试试下一首或重新搜索");
  });

  bindSeek(els.progressTrack);
  bindSeek(els.progressTrackBig);
  updateModeUI();

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = els.q.value.trim();
    if (!q) {
      toast("请输入歌名或歌手");
      els.q.focus();
      return;
    }
    showPage("search");
    search(q);
  });

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => showPage(tab.dataset.tab));
  });

  $("#btn-play-all-search").addEventListener("click", () => {
    const list = [...state.searchTracks.values()];
    if (!list.length) return toast("没有可播放的歌曲");
    playFromList(list, 0);
  });
  $("#btn-play-all-fav").addEventListener("click", () => {
    if (!library.favorites.length) return toast("收藏是空的");
    playFromList(library.favorites, 0);
  });
  $("#btn-play-all-pl").addEventListener("click", () => {
    const pl = getActivePlaylist();
    if (!pl || !(pl.tracks || []).length) return toast("歌单是空的");
    playFromList(pl.tracks, 0);
  });

  $("#btn-new-playlist").addEventListener("click", () => {
    const name = prompt("歌单名称", "我的歌单");
    if (name === null) return;
    const pl = createPlaylist(name.trim() || "我的歌单");
    toast(`已创建「${pl.name}」`);
    renderPlaylistsPage();
  });
  $("#btn-back-playlists").addEventListener("click", () => showPage("playlists"));
  $("#btn-rename-pl").addEventListener("click", () => {
    const pl = getActivePlaylist();
    if (!pl) return;
    const name = prompt("重命名歌单", pl.name);
    if (name === null) return;
    pl.name = name.trim() || pl.name;
    saveLibrary();
    els.plDetailTitle.textContent = pl.name;
    els.pageTitle.textContent = pl.name;
    toast("已重命名");
  });
  $("#btn-delete-pl").addEventListener("click", () => {
    const pl = getActivePlaylist();
    if (!pl) return;
    if (!confirm(`删除歌单「${pl.name}」？`)) return;
    library.playlists = library.playlists.filter((p) => p.id !== pl.id);
    saveLibrary();
    state.activePlaylistId = null;
    showPage("playlists");
    toast("已删除");
  });

  $("#btn-add-pl-create").addEventListener("click", () => {
    const name = prompt("新歌单名称", "我的歌单");
    if (name === null) return;
    const pl = createPlaylist(name.trim() || "我的歌单");
    if (state.addPlTrack) addToPlaylist(pl.id, state.addPlTrack);
    els.addPlDialog.close();
  });

  els.btnPlay.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay();
  });
  els.btnPlayBig.addEventListener("click", togglePlay);
  $("#btn-prev-mini").addEventListener("click", (e) => {
    e.stopPropagation();
    playPrev();
  });
  $("#btn-next-mini").addEventListener("click", (e) => {
    e.stopPropagation();
    playNext(true);
  });
  $("#btn-prev").addEventListener("click", playPrev);
  $("#btn-next").addEventListener("click", () => playNext(true));
  els.btnMode.addEventListener("click", cycleMode);
  els.btnFavNow.addEventListener("click", () => {
    const t = state.queue[state.queueIndex];
    if (t) toggleFav(t);
  });
  $("#btn-add-pl-now").addEventListener("click", () => {
    const t = state.queue[state.queueIndex];
    if (t) openAddPlaylist(t);
  });
  $("#btn-dl-sheet").addEventListener("click", () => {
    const t = state.queue[state.queueIndex];
    if (t) downloadToken(t.token);
  });
  $("#btn-expand").addEventListener("click", () => {
    if (state.queueIndex >= 0) els.playerSheet.hidden = false;
  });
  $("#btn-expand-info").addEventListener("click", () => {
    if (state.queueIndex >= 0) els.playerSheet.hidden = false;
  });
  $("#btn-collapse").addEventListener("click", () => {
    els.playerSheet.hidden = true;
  });

  $("#btn-sources").addEventListener("click", () => els.sourcesDialog.showModal());
  $("#btn-files").addEventListener("click", async () => {
    await loadFiles();
    els.filesDialog.showModal();
  });

  // Try merge server library if local empty
  fetch("/api/library")
    .then((r) => r.json())
    .then((d) => {
      if (!library.favorites.length && Array.isArray(d.favorites) && d.favorites.length) {
        library.favorites = d.favorites;
      }
      if (!library.playlists.length && Array.isArray(d.playlists) && d.playlists.length) {
        library.playlists = d.playlists;
      }
      saveLibrary();
    })
    .catch(() => {});

  loadSources().catch((e) => {
    console.error(e);
    toast("音源加载失败");
  });

  // autofocus search on load for mobile clarity
  setTimeout(() => {
    if (state.page === "search") els.q.focus();
  }, 300);
})();
