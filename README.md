# ypm-plugin-youtube-music

A third-party YouTube Music plugin for [YesPlayMusic](https://github.com/qier222/YesPlayMusic).

> Not affiliated with or endorsed by YouTube or Google. Uses YouTube Music's web API, which may change at any time.

## Features

- **Browse & Stream (No Sign-In Required)**: Home feed, search (songs, albums, artists, playlists), search suggestions, album/artist/playlist pages, synced lyrics, and direct playback.
- **Account Sign-In**: Sign in via **Settings → Plugins → YouTube Music → Sign in** in an isolated window to access your Liked Songs and playlists. Signing out clears stored cookies immediately. *(Note: using third-party clients with your Google account carries a risk of account restriction.)*
- **`yt-dlp` Fallback**: When YouTube requires sign-in or bot verification for audio streams, the plugin can fall back to `yt-dlp` if installed locally (e.g. `brew install yt-dlp`, with `deno`, `node`, or `bun`) and enabled in **Settings → Plugins → YouTube Music → Allow running local programs**. Cookies are passed over `stdin`, never in command-line arguments.

## Installation

1. Open YesPlayMusic and go to **Settings → Plugins → Install plugin**.
2. Enter `lucas-tk1/ypm-plugin-youtube-music` (or `https://github.com/lucas-tk1/ypm-plugin-youtube-music`).
3. Review the requested permissions and click **Install**. Future updates can be checked or installed automatically from the plugin list.

---

## 中文说明

YouTube Music 的 [YesPlayMusic](https://github.com/qier222/YesPlayMusic) 第三方插件。

> 本插件与 YouTube / Google 无官方关联，基于 YouTube Music Web 接口实现，接口随时可能变动。

### 功能特性

- **免登录浏览与播放**：支持首页推荐、搜索（歌曲 / 专辑 / 歌手 / 歌单）、搜索联想、专辑、歌手、歌单、滚动歌词及直接播放。
- **账号登录**：可在「设置 → 插件 → YouTube Music → 登录」通过独立窗口登录 Google 账号以访问红心歌曲与歌单；退出即清除本地 Cookie（请注意第三方客户端登录存在账号风控风险）。
- **`yt-dlp` 辅助解析**：当 YouTube 要求登录或人机验证才能获取音频流时，若本机已安装 `yt-dlp`（如 `brew install yt-dlp`，配合 `deno` / `node` / `bun`）并在插件设置中开启了「允许运行本机程序」，插件会自动通过标准输入传递 Cookie 调用 `yt-dlp` 获取播放地址。

### 安装方法

1. 打开 YesPlayMusic，进入 **设置 → 插件 → 安装插件**。
2. 输入 `lucas-tk1/ypm-plugin-youtube-music`（或完整仓库地址 `https://github.com/lucas-tk1/ypm-plugin-youtube-music`）。
3. 确认权限后点击安装即可，后续支持在插件列表内一键检查或自动更新。

## License

[MIT](LICENSE)
