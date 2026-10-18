# musicdl-web

基于 [CharlesPikachu/musicdl](https://github.com/CharlesPikachu/musicdl) 的**本地 Web 界面**：关键词搜索、多音源、试听、下载到本机文件夹。

> 仅供个人学习与合法个人使用。请尊重版权及各音乐平台服务条款。本应用不托管、不分发任何盗版音源。

## 快速启动

```bash
cd /workspace/musicdl-web
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

浏览器打开：**http://127.0.0.1:8765**

可选环境变量：

| 变量 | 默认 | 说明 |
|------|------|------|
| `MUSICDL_PORT` | `8765` | 监听端口 |
| `MUSICDL_HOST` | `0.0.0.0` | 监听地址 |
| `MUSICDL_SEARCH_SIZE` | `8` | 每个音源最多解析条数 |
| `MUSICDL_SOURCE_TIMEOUT` | `35` | 单音源超时（秒） |
| `MUSICDL_COOKIES` | 空 | JSON，为指定客户端注入 Cookie |

Cookie 示例（QQ 音乐 VIP）：

```bash
export MUSICDL_COOKIES='{"QQMusicClient":{"default_search_cookies":"你的Cookie","default_download_cookies":"你的Cookie"}}'
python app.py
```

## 功能

- 关键词搜索（SSE 流式出结果，不用干等）
- 多音源勾选：Jamendo / FMA / Audius / ccMixter / B 站，以及咪咕、网易云、QQ、酷我、千千、酷狗
- 列表展示：歌名、歌手、专辑、时长、格式、音源
- 点击试听、查看歌词（若有）
- 单曲 / 批量下载到 `downloads/`，进度条 + 已下载文件列表

## 默认音源说明

启动后**默认勾选**一般无需 Cookie / 额外 CLI 工具的源：

- Jamendo、FMA、Audius、Bilibili

国内平台（咪咕 / 网易云 / QQ / 酷我等）在界面里可勾选；部分 VIP 曲目需配置 Cookie。Apple Music / TIDAL / YouTube 等需要 FFmpeg、Node、N_m3u8DL-RE 等工具，本 Web 未默认接入，请用 musicdl CLI。

## 目录结构

```
musicdl-web/
  app.py              # Flask 后端
  requirements.txt
  README.md
  static/             # 前端
  downloads/          # 下载文件（按音源分子目录）
```

## 致谢

- 核心库：[musicdl](https://github.com/CharlesPikachu/musicdl)
- 流式搜索思路参考官方示例 `examples/claudeai-modern-web-music-player`
