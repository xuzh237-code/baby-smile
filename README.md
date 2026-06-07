# baby-smile

一个轻量的宝宝成长记录网页，支持记录喝奶、排泄、睡眠、补剂，并查看按天趋势。

## 微信小程序版

项目中新增了一个微信小程序适配目录：

- `miniprogram/`

可直接用微信开发者工具打开 `miniprogram/project.config.json` 进行预览。

当前小程序版已适配：

- 喝奶 / 排泄 / 睡眠 / 补剂记录
- 出生信息编辑
- 分类折叠历史记录
- 近 7 / 14 / 30 / 90 / 365 天趋势
- CSV 导入导出
- 本地优先记录
- 微信登录后云端同步

当前仍保留在网页版、未直接迁入小程序版的能力：

- Supabase 邮箱 / Google 登录
- GitHub 链接入口
- 浏览器原生 `SpeechRecognition`

小程序语音识别预留为 `WechatSI` 插件方案。测试号无法使用该插件授权，所以当前小程序版默认不展示语音入口；使用正式 AppID 并在微信公众平台授权插件后，可重新打开 `ENABLE_WECHAT_SI`。

## 在线访问

- GitHub Pages: [https://xuzh237-code.github.io/baby-smile/](https://xuzh237-code.github.io/baby-smile/)

## GitHub 仓库

- Repository: [https://github.com/xuzh237-code/baby-smile](https://github.com/xuzh237-code/baby-smile)
- Release: [https://github.com/xuzh237-code/baby-smile/releases/tag/v1.1.8](https://github.com/xuzh237-code/baby-smile/releases/tag/v1.1.8)

## 当前版本

- Version: `1.1.8`
- Release Date: `2026-06-07`

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

Web 版已经接入 Supabase：

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

## 小程序微信同步配置

小程序版默认本地可用。需要微信登录同步时：

1. 在微信开发者工具中开启「云开发」，创建云环境。
2. 在 `miniprogram/utils/cloudConfig.js` 中填入 `CLOUD_ENV_ID`。
3. 在云开发数据库中新建集合 `baby_smile_sync`。
4. 将集合权限设置为“仅创建者可读写”。
5. 发布后用户点击「微信登录」，本地数据会与云端合并；换手机后使用同一个微信登录即可恢复数据。
