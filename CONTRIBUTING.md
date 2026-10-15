# 贡献指南

感谢关注 Clarity！PR 欢迎，提交前请过一遍：

## 开发环境

```bash
git clone https://github.com/jovanzhang6/clarity.git
cd clarity
npm install        # 国内网络自动走 .npmrc 里的 electron 镜像
npm test           # 必须全绿
```

系统要求：Windows 10 19041+，Node.js 22+，PATH 中有 ffmpeg / ffplay。

## 提交前检查

1. `npm test` 全绿（纯逻辑单元测试）；
2. 涉及采集/保存链路的改动：跑一次 `npm run selftest`（13 步全过，含系统声音响度校验）；
3. 涉及 UI 的改动：附截图；涉及布局的改动跑一次布局断言
   （`--remote-debugging-port=9222` 启动后 `node tools/check-layout.mjs 9222`）。

## 约定

- 零构建依赖：渲染端 vanilla JS，不引入打包器/框架；
- 声音采集相关改动请先读 `renderer/capture.js` 顶部注释（三条铁律）；
- 错误提示一律走应用内 uiConfirm/uiAlert，禁用原生弹窗；
- 界面文案：通用录屏工具视角，不预设具体使用场景。

## 提交信息

用一行说清"改了什么、为什么"，中文英文均可。
