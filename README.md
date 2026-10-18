# musicdl-web

基于 [CharlesPikachu/musicdl](https://github.com/CharlesPikachu/musicdl) 的手机优先在线音乐播放器。

## 功能

- 多音源搜索（SSE 流式结果）
- 收藏 / 自建歌单（浏览器 localStorage + 可选服务端 `/api/library` 同步）
- 播放队列：上一首 / 下一首
- 播放模式：顺序、随机、单曲循环、列表循环
- 迷你播放条 + 全屏播放器
- 下载到服务器 `downloads/`

仅供个人学习，请遵守版权与各平台条款。

## 本地运行

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

打开 http://127.0.0.1:8765

## Docker / SnapDeploy

见 `Dockerfile`。环境变量：`PORT`、`MUSICDL_DATA`、`MUSICDL_SEARCH_SIZE`、`MUSICDL_COOKIES`。
