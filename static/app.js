(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const state = {
    sources: [],
    tracks: new Map(), // token -> track
    selected: new Set(),
    current: null,
    searching: false,
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
    selAll: $("#sel-all"),
    btnDlSelected: $("#btn-dl-selected"),
    badge: $("#status-badge"),
    audio: $("#audio"),
    cover: $("#cover"),
    coverPh: $("#cover-ph"),
    nowTitle: $("#now-title"),
    nowArtist: $("#now-artist"),
    btnDlNow: $("#btn-dl-now"),
    lyric: $("#lyric"),
    dlStatus: $("#dl-status"),
    btnFiles: $("#btn-files"),
    filesDialog: $("#files-dialog"),
    filesList: $("#files-list"),
    filesDir: $("#files-dir"),
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
      ${coverSrc ? `<img src="${coverSrc}" alt="" loading="lazy" />` : `<div class="cover-ph" style="width:48px;height:48px;font-size:18px;opacity:.4;display:grid;place-items:center;background:#111;border-radius:10px">♪</div>`}
      <div>
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
  }

  function playTrack(token) {
    const t = state.tracks.get(token);
    if (!t) return;
    state.current = token;
    $$(".row").forEach((r) => r.classList.toggle("active", r.dataset.token === token));
    els.nowTitle.textContent = t.song_name;
    els.nowArtist.textContent = `${t.singers}${t.album ? " · " + t.album : ""} · ${t.source_label}`;
    els.btnDlNow.disabled = false;
    if (t.cover_url) {
      els.cover.src = `/api/cover/${token}`;
      els.cover.hidden = false;
      els.coverPh.hidden = true;
    } else {
      els.cover.hidden = true;
      els.coverPh.hidden = false;
    }
    els.audio.src = `/api/stream/${token}`;
    els.audio.play().catch(() => {});
    els.lyric.textContent = "加载歌词…";
    fetch(`/api/lyric/${token}`)
      .then((r) => r.json())
      .then((d) => { els.lyric.textContent = d.lyric || "暂无歌词"; })
      .catch(() => { els.lyric.textContent = "暂无歌词"; });
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

  function search(q) {
    if (state.searching) return;
    const sources = selectedSources();
    if (!sources.length) {
      alert("请至少选择一个音源");
      return;
    }
    state.searching = true;
    state.tracks.clear();
    state.selected.clear();
    els.btnDlSelected.disabled = true;
    els.selAll.checked = false;
    els.results.classList.add("empty");
    els.results.textContent = "搜索中，结果会陆续出现…";
    els.resultCount.textContent = "";
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
        els.results.textContent = "没有找到结果，可换关键词或勾选更多音源试试";
      }
    });
    es.onerror = () => {
      if (!state.searching) return;
      state.searching = false;
      es.close();
      setBadge("搜索中断", "err");
      els.metaText.textContent = "连接中断，已显示已收到的结果";
      if (!state.tracks.size) {
        els.results.textContent = "搜索失败，请稍后重试";
      }
    };
  }

  function SUPPORTED_LABEL(id) {
    const s = state.sources.find((x) => x.id === id);
    return s ? s.label : id;
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
      })
      .catch((e) => {
        els.dlStatus.textContent = "下载失败：" + e.message;
        setBadge("下载失败", "err");
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

  els.btnDlNow.addEventListener("click", () => {
    if (state.current) downloadToken(state.current);
  });

  els.btnFiles.addEventListener("click", async () => {
    await loadFiles();
    els.filesDialog.showModal();
  });

  loadSources().catch((e) => {
    setBadge("初始化失败", "err");
    console.error(e);
  });
})();
