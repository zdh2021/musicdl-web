(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const state = {
    sources: [],
    tracks: new Map(),
    selected: new Set(),
    current: null,
    searching: false,
    seeking: false,
  };

  const els = {
    form: $("#search-form"),
    q: $("#q"),
    sources: $("#sources"),
    results: $("#results"),
    metaBar: $("#meta-bar"),
    metaText: $("#meta-text"),
    sourceChips: $("#source-chips"),
    resultCount: $("#result-count"),
    toolbar: $("#toolbar"),
    selAll: $("#sel-all"),
    btnDlSelected: $("#btn-dl-selected"),
    badge: $("#status-badge"),
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
    btnDlNow: $("#btn-dl-now"),
    btnDlSheet: $("#btn-dl-sheet"),
    btnPlay: $("#btn-play"),
    btnPlayBig: $("#btn-play-big"),
    lyric: $("#lyric"),
    dlStatus: $("#dl-status"),
    btnFiles: $("#btn-files"),
    btnSources: $("#btn-sources"),
    filesDialog: $("#files-dialog"),
    sourcesDialog: $("#sources-dialog"),
    filesList: $("#files-list"),
    filesDir: $("#files-dir"),
    playerSheet: $("#player-sheet"),
    progressFill: $("#progress-fill"),
    progressFillBig: $("#progress-fill-big"),
    progressTrack: $("#progress-track"),
    progressTrackBig: $("#progress-track-big"),
    timeCur: $("#time-cur"),
    timeDur: $("#time-dur"),
    timeCurBig: $("#time-cur-big"),
    timeDurBig: $("#time-dur-big"),
  };

  function setBadge(text, cls = "") {
    els.badge.textContent = text;
    els.badge.className = "badge" + (cls ? " " + cls : "");
  }

  function fmtBytes(n) {
    if (!n || n <= 0) return "";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(i ? 1 : 0) + " " + u[i];
  }

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ":" + String(r).padStart(2, "0");
  }

  function setPlayingUI(playing) {
    for (const btn of [els.btnPlay, els.btnPlayBig]) {
      const play = btn.querySelector(".ic-play");
      const pause = btn.querySelector(".ic-pause");
      if (play) play.hidden = playing;
      if (pause) pause.hidden = !playing;
    }
  }

  function updateProgress() {
    if (state.seeking) return;
    const a = els.audio;
    const dur = a.duration || 0;
    const cur = a.currentTime || 0;
    const pct = dur ? (cur / dur) * 100 : 0;
    els.progressFill.style.width = pct + "%";
    els.progressFillBig.style.width = pct + "%";
    els.timeCur.textContent = fmtTime(cur);
    els.timeCurBig.textContent = fmtTime(cur);
    els.timeDur.textContent = fmtTime(dur);
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
    const onUp = () => { state.seeking = false; };
    trackEl.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  async function loadSources() {
    const res = await fetch("/api/sources");
    state.sources = await res.json();
    els.sources.innerHTML = "";
    for (const s of state.sources) {
      const label = document.createElement("label");
      label.className = "source-chip" + (s.default ? " on" : "");
      label.innerHTML = `<input type="checkbox" value="${s.id}" ${s.default ? "checked" : ""} />
        <span>${s.label}</span>`;
      label.querySelector("input").addEventListener("change", (e) => {
        label.classList.toggle("on", e.target.checked);
      });
      els.sources.appendChild(label);
    }
  }

  function selectedSources() {
    return $$("#sources input:checked").map((i) => i.value);
  }

  function renderRow(t) {
    const row = document.createElement("div");
    row.className = "row";
    row.dataset.token = t.token;
    const coverSrc = t.cover_url ? `/api/cover/${t.token}` : "";
    row.innerHTML = `
      <input type="checkbox" class="pick" />
      ${coverSrc
        ? `<img class="thumb" src="${coverSrc}" alt="" loading="lazy" />`
        : `<div class="thumb-ph">♪</div>`}
      <div class="info">
        <div class="t"></div>
        <div class="a"></div>
      </div>
      <div class="meta">
        <span class="tag">${t.source}</span>
        <span>${t.duration || ""}</span>
        <span class="tag ${t.lossless ? "hi" : ""}">${(t.ext || "").toUpperCase()}${t.file_size ? " · " + t.file_size : ""}</span>
      </div>`;
    row.querySelector(".t").textContent = t.song_name;
    row.querySelector(".a").textContent = `${t.singers}${t.album ? " · " + t.album : ""}`;
    const pick = row.querySelector(".pick");
    pick.addEventListener("click", (e) => e.stopPropagation());
    pick.addEventListener("change", () => {
      if (pick.checked) state.selected.add(t.token);
      else state.selected.delete(t.token);
      els.btnDlSelected.disabled = state.selected.size === 0;
    });
    row.addEventListener("click", () => playTrack(t.token));
    return row;
  }

  function appendTrack(t) {
    if (state.tracks.has(t.token)) return;
    state.tracks.set(t.token, t);
    if (els.results.classList.contains("empty")) {
      els.results.classList.remove("empty");
      els.results.innerHTML = "";
    }
    els.results.appendChild(renderRow(t));
    els.resultCount.textContent = `共 ${state.tracks.size} 首`;
    els.toolbar.hidden = false;
  }

  function playTrack(token) {
    const t = state.tracks.get(token);
    if (!t) return;
    state.current = token;
    $$(".row").forEach((r) => r.classList.toggle("active", r.dataset.token === token));
    els.nowBar.hidden = false;
    document.body.style.paddingBottom = "";

    const title = t.song_name;
    const artist = `${t.singers}${t.album ? " · " + t.album : ""} · ${t.source_label || t.source}`;
    els.nowTitle.textContent = title;
    els.nowArtist.textContent = artist;
    els.sheetTitle.textContent = title;
    els.sheetArtist.textContent = artist;
    els.btnDlNow.disabled = false;
    els.btnDlSheet.disabled = false;
    els.btnPlay.disabled = false;
    els.btnPlayBig.disabled = false;

    if (t.cover_url) {
      const src = `/api/cover/${token}`;
      els.cover.src = src;
      els.cover.hidden = false;
      els.coverPh.hidden = true;
      els.coverMini.src = src;
      els.coverMini.hidden = false;
      els.coverMiniPh.hidden = true;
    } else {
      els.cover.hidden = true;
      els.coverPh.hidden = false;
      els.coverMini.hidden = true;
      els.coverMiniPh.hidden = false;
    }

    els.audio.src = `/api/stream/${token}`;
    els.audio.play().catch(() => {});
    setPlayingUI(true);

    els.lyric.textContent = "加载歌词…";
    fetch(`/api/lyric/${token}`)
      .then((r) => r.json())
      .then((d) => { els.lyric.textContent = d.lyric || "暂无歌词"; })
      .catch(() => { els.lyric.textContent = "暂无歌词"; });
  }

  function togglePlay() {
    const a = els.audio;
    if (!a.src) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function openSheet() {
    if (!state.current) return;
    els.playerSheet.hidden = false;
  }
  function closeSheet() {
    els.playerSheet.hidden = true;
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

  function SUPPORTED_LABEL(id) {
    const s = state.sources.find((x) => x.id === id);
    return s ? s.label : id;
  }

  function search(q) {
    if (state.searching) return;
    const sources = selectedSources();
    if (!sources.length) {
      alert("请至少选择一个音源");
      els.sourcesDialog.showModal();
      return;
    }
    state.searching = true;
    state.tracks.clear();
    state.selected.clear();
    els.btnDlSelected.disabled = true;
    els.selAll.checked = false;
    els.results.classList.add("empty");
    els.results.innerHTML = `<div class="empty-state"><div class="empty-icon">♪</div><p>搜索中，结果会陆续出现…</p></div>`;
    els.resultCount.textContent = "";
    els.toolbar.hidden = false;
    els.metaBar.hidden = false;
    els.metaText.textContent = `正在搜索「${q}」`;
    els.sourceChips.innerHTML = "";
    setBadge("搜索中…", "busy");

    const url = `/api/search?q=${encodeURIComponent(q)}&sources=${encodeURIComponent(sources.join(","))}`;
    const es = new EventSource(url);

    es.addEventListener("source_start", (ev) => {
      const d = JSON.parse(ev.data);
      ensureChip(d.source, d.label).className = "chip wait";
    });
    es.addEventListener("result", (ev) => {
      appendTrack(JSON.parse(ev.data));
    });
    es.addEventListener("source_done", (ev) => {
      const d = JSON.parse(ev.data);
      const chip = ensureChip(d.source);
      chip.className = "chip " + (d.timed_out ? "wait" : "ok");
      chip.textContent = `${SUPPORTED_LABEL(d.source)} · ${d.count}${d.timed_out ? " (超时)" : ""}`;
    });
    es.addEventListener("source_error", (ev) => {
      const d = JSON.parse(ev.data);
      const chip = ensureChip(d.source);
      chip.className = "chip err";
      chip.title = d.message || "";
      chip.textContent = `${SUPPORTED_LABEL(d.source)} · 失败`;
    });
    es.addEventListener("done", (ev) => {
      const d = JSON.parse(ev.data);
      state.searching = false;
      es.close();
      setBadge("就绪");
      els.metaText.textContent = `搜索完成，共 ${d.count} 首`;
      if (!d.count) {
        els.results.classList.add("empty");
        els.results.innerHTML = `<div class="empty-state"><div class="empty-icon">♪</div><p>没有找到结果，可换关键词或换音源试试</p></div>`;
      }
    });
    es.onerror = () => {
      if (!state.searching) return;
      state.searching = false;
      es.close();
      setBadge("搜索中断", "err");
      els.metaText.textContent = "连接中断，已显示已收到的结果";
      if (!state.tracks.size) {
        els.results.classList.add("empty");
        els.results.innerHTML = `<div class="empty-state"><div class="empty-icon">♪</div><p>搜索失败，请稍后重试</p></div>`;
      }
    };
  }

  function downloadToken(token) {
    return fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        watchDownload(d.download_id, token);
        openSheet();
      })
      .catch((e) => {
        els.dlStatus.textContent = "下载失败：" + e.message;
        setBadge("下载失败", "err");
        openSheet();
      });
  }

  function watchDownload(downloadId, token) {
    const t = state.tracks.get(token);
    setBadge("下载中…", "busy");
    els.dlStatus.innerHTML = `正在下载：${t ? t.song_name : downloadId}<div class="bar"><i></i></div>`;
    const bar = els.dlStatus.querySelector("i");
    const es = new EventSource(`/api/download/${downloadId}/progress`);
    es.addEventListener("progress", (ev) => {
      const d = JSON.parse(ev.data);
      if (d.status === "error") {
        els.dlStatus.textContent = "下载失败：" + (d.message || "");
        setBadge("下载失败", "err");
        es.close();
        return;
      }
      const pct = d.total ? Math.min(100, Math.round((d.downloaded / d.total) * 100)) : 0;
      if (bar) bar.style.width = (d.total ? pct : 50) + "%";
      const speed = d.speed ? ` · ${(d.speed / 1024).toFixed(0)} KB/s` : "";
      els.dlStatus.childNodes[0].textContent =
        `${d.status === "done" ? "已完成" : "下载中"}：${d.name || ""} ${d.total ? pct + "%" : ""}${speed}`;
      if (d.status === "done") {
        setBadge("下载完成");
        if (bar) bar.style.width = "100%";
        const a = document.createElement("a");
        a.href = `/api/file/${downloadId}`;
        a.textContent = " 打开文件";
        a.style.marginLeft = "8px";
        els.dlStatus.appendChild(a);
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Audio events
  els.audio.addEventListener("play", () => setPlayingUI(true));
  els.audio.addEventListener("pause", () => setPlayingUI(false));
  els.audio.addEventListener("timeupdate", updateProgress);
  els.audio.addEventListener("loadedmetadata", updateProgress);
  els.audio.addEventListener("ended", () => setPlayingUI(false));

  bindSeek(els.progressTrack);
  bindSeek(els.progressTrackBig);

  els.btnPlay.addEventListener("click", (e) => { e.stopPropagation(); togglePlay(); });
  els.btnPlayBig.addEventListener("click", togglePlay);
  els.btnDlNow.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.current) downloadToken(state.current);
  });
  els.btnDlSheet.addEventListener("click", () => {
    if (state.current) downloadToken(state.current);
  });

  $("#btn-expand").addEventListener("click", openSheet);
  $("#btn-expand-info").addEventListener("click", openSheet);
  $("#btn-collapse").addEventListener("click", closeSheet);

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = els.q.value.trim();
    if (q) search(q);
  });

  els.selAll.addEventListener("change", () => {
    const on = els.selAll.checked;
    state.selected.clear();
    $$(".row .pick").forEach((c) => {
      c.checked = on;
      if (on) state.selected.add(c.closest(".row").dataset.token);
    });
    els.btnDlSelected.disabled = state.selected.size === 0;
  });

  els.btnDlSelected.addEventListener("click", async () => {
    for (const token of [...state.selected]) {
      await downloadToken(token);
    }
  });

  els.btnFiles.addEventListener("click", async () => {
    await loadFiles();
    els.filesDialog.showModal();
  });

  els.btnSources.addEventListener("click", () => {
    els.sourcesDialog.showModal();
  });

  loadSources().catch((e) => {
    setBadge("初始化失败", "err");
    console.error(e);
  });
})();
