# baby-smile

一个轻量的宝宝成长记录网页，支持记录喝奶、排泄、睡眠、补剂，并查看按天趋势。

## 在线访问

- GitHub Pages: [https://xuzh237-code.github.io/baby-smile/](https://xuzh237-code.github.io/baby-smile/)

## GitHub 仓库

- Repository: [https://github.com/xuzh237-code/baby-smile](https://github.com/xuzh237-code/baby-smile)
- Release: [https://github.com/xuzh237-code/baby-smile/releases/tag/v1.1.1](https://github.com/xuzh237-code/baby-smile/releases/tag/v1.1.1)

## 当前版本

- Version: `1.1.1`
- Release Date: `2026-05-10`

## 功能概览

- 喝奶记录
- 排泄记录
- 睡眠记录
- 夜间睡眠清醒时段
- 补剂记录（上午 AD、午间 D3）
- 邮箱登录
- Google 登录
- Supabase 云端数据同步（多设备查看）
- 趋势比对（7天 / 14天 / 30天 / 90天 / 365天）
- CSV 导入导出

## 本地使用

直接打开 `index.html`，或者在项目目录启动一个本地静态服务后访问。

## 云端同步配置

当前项目已经接入 Supabase：

- Supabase Project URL: `https://osclgqcupdgwhndoytgu.supabase.co`
- GitHub Pages: [https://xuzh237-code.github.io/baby-smile/](https://xuzh237-code.github.io/baby-smile/)

为了让邮箱确认和 Google 登录正常工作，还需要在 Supabase 控制台补齐以下配置：

1. Authentication -> URL Configuration
   - Site URL:
     - `https://xuzh237-code.github.io/baby-smile/`
   - Redirect URLs:
     - `https://xuzh237-code.github.io/baby-smile/`
     - `http://localhost:8000/`

2. Authentication -> Providers -> Google
   - 开启 Google Provider
   - 在 Google Cloud Console 中配置 OAuth Client
   - Authorized redirect URI:
     - `https://osclgqcupdgwhndoytgu.supabase.co/auth/v1/callback`

## 数据表

云端记录表为 `public.baby_records`，已开启 RLS，仅允许登录用户访问和修改自己的记录。
