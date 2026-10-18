#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
musicdl-web — 本地音乐搜索 / 下载 Web 界面
基于 CharlesPikachu/musicdl，仅供个人学习与合法个人使用。
"""
from __future__ import annotations

import json
import os
import queue
import re
import threading
import time
import uuid
from pathlib import Path

import requests
from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context

from musicdl import musicdl

# ---------------------------------------------------------------------------
# 路径与配置
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
STATIC_DIR = HERE / "static"
DOWNLOAD_DIR = HERE / "downloads"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# 默认优先「无需 Cookie / 额外工具」的源；国内平台可勾选（本地网络通常更好用）
SUPPORTED_SOURCES = {
    "JamendoMusicClient": {"label": "Jamendo", "short": "Jamendo", "default": True, "note": "免费可下"},
    "FMAMusicClient": {"label": "FMA 自由音乐", "short": "FMA", "default": True, "note": "免费可下"},
    "AudiusMusicClient": {"label": "Audius", "short": "Audius", "default": True, "note": "免费可下"},
    "CCMixterMusicClient": {"label": "ccMixter", "short": "ccMixter", "default": False, "note": "混音社区"},
    "BilibiliMusicClient": {"label": "Bilibili 音乐", "short": "B站", "default": True, "note": "音频区"},
    "MiguMusicClient": {"label": "咪咕音乐", "short": "咪咕", "default": False, "note": "国内"},
    "NeteaseMusicClient": {"label": "网易云音乐", "short": "网易云", "default": False, "note": "国内"},
    "QQMusicClient": {"label": "QQ 音乐", "short": "QQ", "default": False, "note": "国内；VIP 可配 Cookie"},
    "KuwoMusicClient": {"label": "酷我音乐", "short": "酷我", "default": False, "note": "国内"},
    "QianqianMusicClient": {"label": "千千音乐", "short": "千千", "default": False, "note": "国内"},
    "KugouMusicClient": {"label": "酷狗音乐", "short": "酷狗", "default": False, "note": "国内"},
}

SOURCE_ORDER = list(SUPPORTED_SOURCES.keys())

SEARCH_SIZE_PER_SOURCE = int(os.environ.get("MUSICDL_SEARCH_SIZE", "8"))
PER_SOURCE_TIMEOUT = int(os.environ.get("MUSICDL_SOURCE_TIMEOUT", "35"))
HOST = os.environ.get("MUSICDL_HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT") or os.environ.get("MUSICDL_PORT", "8765"))

MIME = {
    "mp3": "audio/mpeg",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "m4a": "audio/mp4",
    "aac": "audio/aac",
    "ape": "audio/x-ape",
    "ogg": "audio/ogg",
}

# 可选：从环境变量注入 Cookie（JSON 字符串）
# 例: MUSICDL_COOKIES='{"QQMusicClient":{"default_search_cookies":"...","default_download_cookies":"..."}}'
def _load_cookie_cfg() -> dict:
    raw = os.environ.get("MUSICDL_COOKIES", "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# musicdl 客户端
# ---------------------------------------------------------------------------
class ClientManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._mc = None

    def _build(self):
        cookie_cfg = _load_cookie_cfg()
        cfg = {}
        for sid in SUPPORTED_SOURCES:
            cfg[sid] = {
                "search_size_per_source": SEARCH_SIZE_PER_SOURCE,
                "disable_print": True,
                "work_dir": str(DOWNLOAD_DIR / SUPPORTED_SOURCES[sid]["short"]),
            }
            if sid in cookie_cfg and isinstance(cookie_cfg[sid], dict):
                cfg[sid].update(cookie_cfg[sid])
        return musicdl.MusicClient(
            music_sources=list(SUPPORTED_SOURCES.keys()),
            init_music_clients_cfg=cfg,
        )

    def client(self, source: str):
        with self._lock:
            if self._mc is None:
                self._mc = self._build()
            return self._mc.music_clients[source]

    def music_client(self):
        with self._lock:
            if self._mc is None:
                self._mc = self._build()
            return self._mc


MANAGER = ClientManager()


class TrackRegistry:
    def __init__(self):
        self._lock = threading.Lock()
        self._tracks = {}

    def add(self, song_info, source: str) -> str:
        token = uuid.uuid4().hex[:16]
        client = MANAGER.client(source)
        headers = dict(getattr(client, "default_download_headers", {}) or {})
        headers.update(dict(getattr(song_info, "default_download_headers", {}) or {}))
        cookies = dict(getattr(client, "default_download_cookies", {}) or {})
        cookies.update(dict(getattr(song_info, "default_download_cookies", {}) or {}))
        with self._lock:
            self._tracks[token] = {
                "song_info": song_info,
                "source": source,
                "headers": headers,
                "cookies": cookies,
            }
        return token

    def get(self, token: str):
        with self._lock:
            return self._tracks.get(token)


REGISTRY = TrackRegistry()


class _NullProgress:
    def add_task(self, *a, **k):
        return 0

    def update(self, *a, **k):
        pass

    def advance(self, *a, **k):
        pass

    def __getattr__(self, _):
        return lambda *a, **k: None


def _s(v) -> str:
    return "" if v is None else str(v)


def _track_payload(song_info, token: str) -> dict:
    ext = _s(song_info.ext).lower().lstrip(".")
    src = _s(song_info.source)
    meta = SUPPORTED_SOURCES.get(src, {})
    return {
        "token": token,
        "source": meta.get("short", src),
        "source_id": src,
        "source_label": meta.get("label", src),
        "song_name": _s(song_info.song_name) or "未知曲目",
        "singers": _s(song_info.singers) or "未知艺人",
        "album": _s(song_info.album),
        "ext": ext,
        "file_size": _s(song_info.file_size),
        "duration": _s(song_info.duration),
        "cover_url": _s(song_info.cover_url),
        "has_lyric": bool(getattr(song_info, "lyric", None)),
        "lossless": ext in {"flac", "wav", "ape", "alac"},
        "has_url": isinstance(getattr(song_info, "download_url", None), str)
        and str(song_info.download_url).startswith("http"),
    }


# ---------------------------------------------------------------------------
# 流式搜索（SSE）
# ---------------------------------------------------------------------------
def search_stream(keyword: str, sources: list[str]):
    out: queue.Queue = queue.Queue()
    seen: set = set()
    seen_lock = threading.Lock()
    active = {"n": 0}

    def emit(event: str, data: dict):
        out.put(f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n")

    def run_source(source: str):
        try:
            client = MANAGER.client(source)
            progress = _NullProgress()
            try:
                search_urls = client._constructsearchurls(
                    keyword=keyword, rule={}, request_overrides={}
                )
            except Exception as err:
                emit("source_error", {"source": source, "message": str(err)})
                return
            if not search_urls:
                emit("source_done", {"source": source, "count": 0, "timed_out": False})
                return

            buckets = [[] for _ in search_urls]
            threads = []
            for i, url in enumerate(search_urls):
                t = threading.Thread(
                    target=_safe_search,
                    args=(client, keyword, url, buckets[i], progress),
                    daemon=True,
                )
                t.start()
                threads.append(t)

            deadline = time.time() + PER_SOURCE_TIMEOUT
            cursors = [0] * len(buckets)
            count = 0
            while True:
                count += _drain(buckets, cursors, source, seen, seen_lock, emit)
                alive = any(t.is_alive() for t in threads)
                if not alive or time.time() > deadline:
                    break
                time.sleep(0.12)
            count += _drain(buckets, cursors, source, seen, seen_lock, emit)
            timed_out = any(t.is_alive() for t in threads)
            emit("source_done", {"source": source, "count": count, "timed_out": timed_out})
        except Exception as err:
            emit("source_error", {"source": source, "message": str(err)})
        finally:
            with seen_lock:
                active["n"] -= 1
                if active["n"] == 0:
                    out.put(None)

    valid = [s for s in SOURCE_ORDER if s in sources]
    if not valid:
        yield 'event: done\ndata: {"count": 0}\n\n'
        return

    active["n"] = len(valid)
    for source in valid:
        emit(
            "source_start",
            {"source": source, "label": SUPPORTED_SOURCES[source]["label"]},
        )
        threading.Thread(target=run_source, args=(source,), daemon=True).start()

    total = 0
    while True:
        msg = out.get()
        if msg is None:
            break
        if msg.startswith("event: result"):
            total += 1
        yield msg
    yield f'event: done\ndata: {{"count": {total}}}\n\n'


def _safe_search(client, keyword, url, bucket, progress):
    try:
        client._search(
            keyword=keyword,
            search_url=url,
            request_overrides={},
            song_infos=bucket,
            progress=progress,
        )
    except Exception:
        pass


def _drain(buckets, cursors, source, seen, lock, emit):
    emitted = 0
    for i, bucket in enumerate(buckets):
        while cursors[i] < len(bucket):
            song_info = bucket[cursors[i]]
            cursors[i] += 1
            try:
                ident = str(getattr(song_info, "identifier", None) or id(song_info))
                with lock:
                    if ident in seen:
                        continue
                    seen.add(ident)
                token = REGISTRY.add(song_info, source)
                emit("result", _track_payload(song_info, token))
                emitted += 1
            except Exception:
                continue
    return emitted


# ---------------------------------------------------------------------------
# 下载
# ---------------------------------------------------------------------------
DOWNLOADS: dict = {}
DL_LOCK = threading.Lock()


def _safe_name(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]', "_", name or "track").strip()
    return name[:120] or "track"


def _set_dl(download_id: str, **fields):
    with DL_LOCK:
        rec = DOWNLOADS.setdefault(download_id, {})
        rec.update(fields)
        rec["updated"] = time.time()


def _get_dl(download_id: str) -> dict:
    with DL_LOCK:
        return dict(DOWNLOADS.get(download_id, {}))


def run_download(download_id: str, token: str):
    entry = REGISTRY.get(token)
    if not entry:
        _set_dl(download_id, status="error", message="曲目已过期，请重新搜索")
        return
    song = entry["song_info"]
    url = getattr(song, "download_url", None)
    if not isinstance(url, str) or not url.startswith("http"):
        # 回退：让 musicdl 自己下载
        try:
            _set_dl(download_id, status="downloading", downloaded=0, total=0, name=_s(song.song_name))
            src = entry["source"]
            short = SUPPORTED_SOURCES.get(src, {}).get("short", src)
            work = DOWNLOAD_DIR / short
            work.mkdir(parents=True, exist_ok=True)
            song.work_dir = str(work)
            MANAGER.client(src).download(song_infos=[song])
            path = getattr(song, "save_path", None) or getattr(song, "_save_path", None)
            if path and os.path.exists(path):
                _set_dl(
                    download_id,
                    status="done",
                    downloaded=os.path.getsize(path),
                    total=os.path.getsize(path),
                    name=os.path.basename(path),
                    path=path,
                    speed=0,
                )
            else:
                _set_dl(download_id, status="error", message="下载完成但未找到文件")
        except Exception as err:
            _set_dl(download_id, status="error", message=str(err))
        return

    source = entry["source"]
    sub = DOWNLOAD_DIR / SUPPORTED_SOURCES.get(source, {}).get("short", source)
    sub.mkdir(parents=True, exist_ok=True)
    ext = (_s(song.ext) or "mp3").lstrip(".")
    fname = f"{_safe_name(_s(song.song_name))} - {_safe_name(_s(song.singers))}.{ext}"
    path = str(sub / fname)

    try:
        with requests.get(
            url,
            headers=entry["headers"],
            cookies=entry["cookies"],
            stream=True,
            timeout=(10, 60),
            verify=False,
        ) as resp:
            resp.raise_for_status()
            total = int(float(resp.headers.get("Content-Length", 0) or 0))
            if total <= 0:
                total = int(getattr(song, "file_size_bytes", 0) or 0)
            _set_dl(
                download_id,
                status="downloading",
                total=total,
                downloaded=0,
                name=fname,
                path=path,
            )
            done = 0
            last = time.time()
            last_bytes = 0
            tmp = path + ".part"
            with open(tmp, "wb") as fp:
                for chunk in resp.iter_content(chunk_size=256 * 1024):
                    if not chunk:
                        continue
                    fp.write(chunk)
                    done += len(chunk)
                    now = time.time()
                    if now - last >= 0.25:
                        speed = (done - last_bytes) / (now - last)
                        _set_dl(download_id, downloaded=done, total=total, speed=speed)
                        last, last_bytes = now, done
            os.replace(tmp, path)
            _set_dl(
                download_id,
                status="done",
                downloaded=done,
                total=total or done,
                speed=0,
                name=fname,
                path=path,
            )
    except Exception as err:
        _set_dl(download_id, status="error", message=str(err))


# ---------------------------------------------------------------------------
# Flask
# ---------------------------------------------------------------------------
app = Flask(__name__, static_folder=None)
try:
    requests.packages.urllib3.disable_warnings()
except Exception:
    pass


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/static/<path:fname>")
def static_files(fname):
    return send_from_directory(STATIC_DIR, fname)


@app.route("/api/sources")
def api_sources():
    return jsonify(
        [
            {
                "id": sid,
                "label": SUPPORTED_SOURCES[sid]["label"],
                "short": SUPPORTED_SOURCES[sid]["short"],
                "default": SUPPORTED_SOURCES[sid]["default"],
                "note": SUPPORTED_SOURCES[sid].get("note", ""),
            }
            for sid in SOURCE_ORDER
        ]
    )


@app.route("/api/search")
def api_search():
    keyword = (request.args.get("q") or "").strip()
    raw_sources = (request.args.get("sources") or "").strip()
    sources = [s for s in raw_sources.split(",") if s in SUPPORTED_SOURCES]
    if not sources:
        sources = [s for s in SOURCE_ORDER if SUPPORTED_SOURCES[s]["default"]]
    if not keyword:
        return jsonify({"error": "请输入搜索关键词"}), 400

    @stream_with_context
    def generate():
        yield "retry: 10000\n\n"
        for msg in search_stream(keyword, sources):
            yield msg

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/stream/<token>")
def api_stream(token):
    entry = REGISTRY.get(token)
    if not entry:
        return "expired", 404
    song = entry["song_info"]
    url = getattr(song, "download_url", None)
    if not isinstance(url, str) or not url.startswith("http"):
        return "no audio url", 404

    upstream_headers = dict(entry["headers"])
    range_header = request.headers.get("Range")
    if range_header:
        upstream_headers["Range"] = range_header

    try:
        up = requests.get(
            url,
            headers=upstream_headers,
            cookies=entry["cookies"],
            stream=True,
            timeout=(10, 30),
            verify=False,
        )
    except Exception as err:
        return f"upstream error: {err}", 502

    ext = (_s(song.ext) or "mp3").lstrip(".").lower()
    resp_headers = {
        "Content-Type": MIME.get(ext, "application/octet-stream"),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
    }
    for h in ("Content-Length", "Content-Range"):
        if h in up.headers:
            resp_headers[h] = up.headers[h]

    def generate():
        try:
            for chunk in up.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk
        finally:
            up.close()

    return Response(stream_with_context(generate()), status=up.status_code, headers=resp_headers)


@app.route("/api/cover/<token>")
def api_cover(token):
    entry = REGISTRY.get(token)
    if not entry:
        return "", 404
    url = getattr(entry["song_info"], "cover_url", None)
    if not isinstance(url, str) or not url.startswith("http"):
        return "", 404
    try:
        up = requests.get(
            url,
            headers={"User-Agent": entry["headers"].get("User-Agent", "Mozilla/5.0")},
            timeout=(10, 20),
            verify=False,
        )
        return Response(
            up.content,
            status=up.status_code,
            headers={
                "Content-Type": up.headers.get("Content-Type", "image/jpeg"),
                "Cache-Control": "public, max-age=86400",
            },
        )
    except Exception:
        return "", 502


@app.route("/api/lyric/<token>")
def api_lyric(token):
    entry = REGISTRY.get(token)
    if not entry:
        return jsonify({"lyric": ""})
    return jsonify({"lyric": getattr(entry["song_info"], "lyric", "") or ""})


@app.route("/api/download", methods=["POST"])
def api_download():
    data = request.get_json(force=True, silent=True) or {}
    token = data.get("token")
    entry = REGISTRY.get(token)
    if not entry:
        return jsonify({"error": "曲目已过期，请重新搜索"}), 404
    download_id = uuid.uuid4().hex[:16]
    _set_dl(
        download_id,
        status="starting",
        downloaded=0,
        total=0,
        name=_s(entry["song_info"].song_name),
    )
    threading.Thread(target=run_download, args=(download_id, token), daemon=True).start()
    return jsonify({"download_id": download_id})


@app.route("/api/download/<download_id>/progress")
def api_download_progress(download_id):
    @stream_with_context
    def generate():
        yield "retry: 10000\n\n"
        while True:
            rec = _get_dl(download_id)
            if not rec:
                yield 'event: error\ndata: {"message":"unknown download"}\n\n'
                return
            # path 不暴露绝对路径给前端以外的用途时仍可给文件名
            safe = {k: v for k, v in rec.items() if k != "path"}
            if rec.get("path"):
                safe["filename"] = os.path.basename(rec["path"])
            yield f"event: progress\ndata: {json.dumps(safe, ensure_ascii=False)}\n\n"
            if rec.get("status") in ("done", "error"):
                return
            time.sleep(0.3)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/file/<download_id>")
def api_file(download_id):
    rec = _get_dl(download_id)
    if not rec or rec.get("status") != "done" or not rec.get("path"):
        return "not ready", 404
    path = rec["path"]
    return send_from_directory(
        os.path.dirname(path), os.path.basename(path), as_attachment=True
    )


@app.route("/api/downloads")
def api_downloads_list():
    files = []
    for root, _, names in os.walk(DOWNLOAD_DIR):
        for name in names:
            if name.endswith(".part"):
                continue
            full = os.path.join(root, name)
            try:
                st = os.stat(full)
            except OSError:
                continue
            rel = os.path.relpath(full, DOWNLOAD_DIR)
            files.append(
                {
                    "name": name,
                    "rel": rel.replace("\\", "/"),
                    "size": st.st_size,
                    "mtime": st.st_mtime,
                }
            )
    files.sort(key=lambda x: x["mtime"], reverse=True)
    return jsonify({"files": files, "dir": str(DOWNLOAD_DIR)})


@app.route("/api/downloads/file")
def api_downloads_file():
    rel = (request.args.get("rel") or "").strip()
    if not rel or ".." in rel or rel.startswith("/"):
        return "bad path", 400
    full = (DOWNLOAD_DIR / rel).resolve()
    if not str(full).startswith(str(DOWNLOAD_DIR.resolve())) or not full.is_file():
        return "not found", 404
    return send_from_directory(full.parent, full.name, as_attachment=True)


@app.route("/api/health")
def api_health():
    return jsonify({"ok": True, "musicdl": "2.x", "sources": len(SUPPORTED_SOURCES)})


if __name__ == "__main__":
    print(f"\n  🎵 musicdl-web 已启动 → http://127.0.0.1:{PORT}\n")
    print(f"  下载目录: {DOWNLOAD_DIR}")
    print("  仅供个人学习使用，请尊重版权与各平台服务条款。\n")
    app.run(host=HOST, port=PORT, threaded=True, debug=False)
