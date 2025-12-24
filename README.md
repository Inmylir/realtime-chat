# Cloudflare Workers 一键部署：实时聊天（WebSocket）+ 密码登录 + 图片/视频 + 永久保存

> 技术栈：Workers + Durable Objects（实时 WebSocket 广播）+ D1（消息永久存储）+ R2（图片/视频存储）+ Workers Static Assets（前端静态文件）

## 1) 前置条件
- 已安装 Node.js (18+)
- 已登录 Cloudflare：`npx wrangler login`
- 你需要在 Cloudflare 控制台创建：
  - 一个 D1 数据库：`chat-db`
  - 一个 R2 bucket：`chat-media`

## 2) 初始化
```bash
npm i
```

### 创建 D1
```bash
npx wrangler d1 create chat-db
# 把输出的 database_id 复制到 wrangler.toml 里的 database_id
```

### 应用数据库迁移（创建表）
```bash
npx wrangler d1 migrations apply chat-db
```

### 创建 R2 bucket
```bash
npx wrangler r2 bucket create chat-media
```

### 设置 JWT_SECRET（用于签发登录 token）
```bash
npx wrangler secret put JWT_SECRET
```

## 3) 本地开发
```bash
npm run dev
```
打开提示的本地地址即可。

## 4) 一键部署到线上
```bash
npm run deploy
```

## 5) 生产安全建议
- 生产环境建议把 wrangler.toml 里 `ALLOW_REGISTER` 改为 `"false"`，只由管理员预置账号（你也可以写一个仅管理员可用的创建用户接口）。
- 媒体默认“需要登录才能访问”（/media/** 需要 cookie），这样外链不会被随便盗用。
- 大视频上传：Workers 有内存/请求限制，虽然本项目用流式 PUT 到 R2 避免了 multipart 缓冲，但超大文件依旧可能遇到限制；更专业的视频分发建议用 Cloudflare Stream 或直接给 R2 绑定自定义域/签名 URL 策略。

## 6) 结构
- `src/index.ts`：HTTP API + 静态资源 + WebSocket 路由
- `src/chatRoom.ts`：Durable Object（WebSocket 连接管理 + 广播 + 写入 D1）
- `migrations/`：D1 schema
- `public/`：前端页面
