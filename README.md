# Gemini Anti-Truncation

一个基于 Cloudflare Workers 的 Gemini API 防截断代理服务，通过智能重试机制解决 Gemini API 响应被截断的问题。

## 功能特性

- 🔄 **智能重试机制**: 自动检测响应截断并重试请求
- 🎯 **精确续写**: 使用特殊标记确保响应完整性
- 📡 **流式支持**: 同时支持流式和非流式请求
- 🧠 **思维链处理**: 智能处理 Gemini 的思维过程
- 🔧 **灵活配置**: 支持多种配置选项
- 🌐 **CORS 支持**: 完整的跨域请求支持

## 项目结构

```
├── src/
│   ├── index.js          # 主入口文件
│   ├── handlers.js       # 请求处理器
│   ├── core.js          # 核心逻辑
│   ├── utils.js         # 工具函数
│   └── constants.js     # 常量定义
├── public/
│   └── index.html       # 静态资源
├── test/
│   └── index.spec.ts    # 测试文件
├── wrangler.jsonc       # Wrangler 配置文件
└── package.json         # 项目依赖
```

## 工作原理

1. **请求拦截**: 拦截发往 Gemini API 的请求
2. **标记注入**: 在系统提示中注入开始和结束标记
3. **响应检测**: 检查响应是否包含完整的结束标记
4. **智能重试**: 如果响应不完整，自动构建续写请求
5. **内容清理**: 移除标记并返回干净的响应

## 环境配置

在 `wrangler.toml` 中配置以下环境变量：

```toml
[vars]
# 上游 Gemini API 地址 (必填)
UPSTREAM_URL_BASE = "https://generativelanguage.googleapis.com"
# 或使用 GPTLoad 代理: "https://<你的gptload地址>/proxy/gemini"

# 单次请求的最大重试次数
MAX_RETRIES = 20

# 调试模式
DEBUG_MODE = "true"

# 思维链引导词
START_OF_THOUGHT = "Here's a"
```

### 配置说明

- **UPSTREAM_URL_BASE**: 上游 Gemini API 地址，支持官方 API 或 GPTLoad 代理
- **MAX_RETRIES**: 最大重试次数 (推荐: 20，提高防截断效果)
- **DEBUG_MODE**: 调试模式，生产环境建议设为 "false"
- **START_OF_THOUGHT**: 思维链引导词 (默认: "Here's a")

## 开发环境设置

### 前置要求
- Node.js (推荐 18.x 或更高版本)
- npm 或 yarn
- Cloudflare 账户

### 安装依赖
```bash
npm install
```

### 本地开发
启动开发服务器：
```bash
npm run dev
```

服务器将在 `http://localhost:8787` 启动。

## 使用方法

### 基本用法

将你的 Gemini API 请求指向代理服务器：

```javascript
// 原始请求
const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=YOUR_API_KEY', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(requestBody)
});

// 使用代理
const response = await fetch('https://your-worker.your-subdomain.workers.dev/v1beta/models/gemini-1.5-pro:generateContent?key=YOUR_API_KEY', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(requestBody)
});
```

### 支持的模型

- `gemini-2.0-flash-exp`
- `gemini-1.5-pro`
- `gemini-1.5-flash`

### 特殊功能

#### 思维链控制
通过 `thinkingBudget` 参数控制思维过程：
- 设为 `0`: 禁用思维链
- 设为其他值: 启用思维链 (自动规范到 128-32768 范围)

#### 结构化输出
结构化输出请求会直接透传，不进行防截断处理。

## 部署

### 准备部署

1. **配置环境变量**
   ```bash
   # 复制配置模板
   cp wrangler.toml.example wrangler.toml
   
   # 编辑配置文件，设置你的上游 API 地址
   # 如果使用 GPTLoad，请替换 UPSTREAM_URL_BASE
   ```

2. **登录 Cloudflare**
   ```bash
   npx wrangler login
   ```

3. **预览部署**
   ```bash
   npx wrangler deploy --dry-run
   ```

### 部署到 Cloudflare Workers
```bash
npm run deploy
```

### 部署后配置

1. **设置自定义域名** (可选)
   - 在 Cloudflare Dashboard 中配置自定义域名
   - 更新 `wrangler.toml` 中的路由配置

2. **生产环境优化**
   ```toml
   [env.production]
   name = "gemini-anti-truncation-prod"
   vars = { DEBUG_MODE = "false" }
   ```

3. **监控和日志**
   - 在 Cloudflare Dashboard 中查看 Worker 日志
   - 监控请求量和错误率

### 运行测试
```bash
npm run test
```

## 调试

启用调试模式后，Worker 会在控制台输出详细的处理日志，包括：
- 请求类型识别
- 重试次数和原因
- 响应完整性检查
- 错误信息

## 注意事项

1. **API 密钥**: 确保在请求中包含有效的 Gemini API 密钥
2. **速率限制**: 遵守 Gemini API 的速率限制
3. **成本控制**: 重试机制可能增加 API 调用次数
4. **网络延迟**: 代理会增加一定的网络延迟

## 故障排除

### 常见问题

1. **403 Forbidden**: 检查 API 密钥是否正确
2. **500 Internal Server Error**: 查看 Worker 日志
3. **响应不完整**: 检查重试次数配置
4. **CORS 错误**: 确保正确处理预检请求

## 参考

本项目基于以下实现：
- [原始实现](https://linux.do/t/topic/879281)

## 联系支持

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Gemini API 文档](https://ai.google.dev/docs)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
