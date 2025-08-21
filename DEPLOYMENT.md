# 部署检查清单

## 部署前准备

### ✅ 必需步骤

1. **配置文件准备**
   - [ ] 复制 `wrangler.toml.example` 为 `wrangler.toml`
   - [ ] 设置正确的 `UPSTREAM_URL_BASE`
     - 官方 API: `https://generativelanguage.googleapis.com`
     - GPTLoad 代理: `https://<你的gptload地址>/proxy/gemini`
   - [ ] 根据需要调整 `MAX_RETRIES` (推荐: 20)
   - [ ] 生产环境设置 `DEBUG_MODE = "false"`

2. **Cloudflare 账户准备**
   - [ ] 确保有有效的 Cloudflare 账户
   - [ ] 登录 Wrangler CLI: `npx wrangler login`
   - [ ] 验证登录状态: `npx wrangler whoami`

3. **代码验证**
   - [ ] 运行本地测试: `npm run dev`
   - [ ] 验证配置: `npx wrangler deploy --dry-run`

### 🔧 可选配置

4. **高级配置**
   - [ ] 设置自定义域名 (在 Cloudflare Dashboard)
   - [ ] 配置生产环境变量
   - [ ] 设置监控和告警

## 部署命令

```bash
# 1. 预览部署 (推荐)
npx wrangler deploy --dry-run

# 2. 正式部署
npm run deploy
# 或
npx wrangler deploy

# 3. 部署到特定环境
npx wrangler deploy --env production
```

## 部署后验证

### ✅ 功能测试

1. **基本连通性**
   - [ ] Worker 正常启动
   - [ ] 健康检查通过
   - [ ] 日志输出正常

2. **API 功能测试**
   - [ ] 非流式请求正常工作
   - [ ] 流式请求正常工作
   - [ ] 防截断机制生效
   - [ ] CORS 请求正常

3. **错误处理**
   - [ ] 无效 API Key 返回 403
   - [ ] 网络错误正确重试
   - [ ] 超过重试次数正确处理

## 监控和维护

### 📊 监控指标

- **请求量**: 监控每日/每小时请求数
- **错误率**: 监控 4xx/5xx 错误比例
- **重试率**: 监控防截断重试频率
- **响应时间**: 监控平均响应延迟

### 🔧 维护任务

- **日志清理**: 定期检查和清理日志
- **配置更新**: 根据使用情况调整重试次数
- **性能优化**: 监控和优化代码性能
- **安全更新**: 定期更新依赖和配置

## 故障排除

### 常见问题

1. **部署失败**
   ```bash
   # 检查配置文件语法
   npx wrangler validate
   
   # 检查账户权限
   npx wrangler whoami
   ```

2. **运行时错误**
   ```bash
   # 查看实时日志
   npx wrangler tail
   
   # 查看历史日志
   # 在 Cloudflare Dashboard 中查看
   ```

3. **性能问题**
   - 检查重试次数设置
   - 监控上游 API 响应时间
   - 优化请求处理逻辑

### 回滚步骤

如果部署出现问题，可以快速回滚：

```bash
# 回滚到上一个版本
npx wrangler rollback

# 或重新部署已知良好的版本
git checkout <good-commit>
npm run deploy
```

## 联系支持

- **Cloudflare Workers 文档**: https://developers.cloudflare.com/workers/
- **Wrangler CLI 文档**: https://developers.cloudflare.com/workers/wrangler/
- **Gemini API 文档**: https://ai.google.dev/docs
