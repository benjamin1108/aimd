# Beta 手动冒烟清单

> 沙箱内迭代已结束（3 轮 QA + 2 轮 Dev，e2e 36/36 全绿）。剩余 5 项只能在真机环境手动验收，请按下面顺序操作。任何一项失败都阻塞 beta，回到主对话报告即可启动新一轮 dispatcher。

产物：`apps/desktop-tauri/src-tauri/target/release/bundle/dmg/AIMD Desktop_0.1.0_aarch64.dmg`（8.44 MB，arm64）

---

## 1. 安装与冷启动

- [ ] 双击 .dmg，把 `AIMD Desktop.app` 拖入 `/Applications`
- [ ] 从 Launchpad 启动：窗口正常出现，未崩溃
- [ ] 退出后再启动：状态干净，无残留

**失败信号**：拒绝运行（gatekeeper）/ 崩溃 / 空白窗口

## 2. 文件关联（双击打开）

- [ ] 在 Finder 选一份现有 `.aimd`（如 `examples/notes/sample.aimd`），右键 → 打开方式 → AIMD Desktop
- [ ] **双击** .aimd 文件直接在 AIMD Desktop 中打开
- [ ] 文档标题、路径、内容都正确显示

**失败信号**：双击没反应 / 用别的应用打开 / 启动后没加载

## 3. ⌘O 真实文件 dialog

- [ ] 应用启动后按 ⌘O，macOS 文件选择器弹出
- [ ] 选一份 .aimd → 内容渲染、大纲填充
- [ ] 取消选择不留 dirty 状态

## 4. 含空格 / 中文路径

- [ ] 把 .aimd 移到 `~/Desktop/中文 文件夹/笔记 测试.aimd`
- [ ] ⌘O 打开 → 渲染正常
- [ ] 编辑后 ⌘S → 路径 hint 仍正确，磁盘文件确实更新（可用 `stat` 看 mtime）
- [ ] 重新打开 → 修改还在

**失败信号**：路径乱码 / 保存到错位置 / 打开报错

## 5. 大文件（10MB+ 嵌入资源）

- [ ] 用 `cmd/aimd` CLI 或 Desktop 内 "插入图片" 把一张 10MB+ 的高清图嵌进 .aimd
  ```bash
  ./bin/aimd add-image ~/big.aimd /path/to/large.jpg
  ```
- [ ] 用 Desktop 打开这份 .aimd
- [ ] 切到编辑模式 → 切回阅读 → 切到源码 → 来回 5 次
- [ ] 观察是否卡顿、是否崩溃、内存占用是否爆
- [ ] ⌘S 保存，记录耗时

**性能基线**：单图 10MB，模式切换 < 500ms 可接受；> 2s 触发 BUG-003 重新评级

---

## 通过后

把这份清单的 `[ ]` 全部 mark 成 `[x]`，回到主对话说"冒烟通过"。我作为 dispatcher 会输出：

```
DECISION: ship
RATIONALE: 所有 beta 门槛达标，可以打 v0.1-beta tag。
```

## 任何一项失败

回到主对话发"冒烟失败：第 N 项 — 现象描述"。我会启动新一轮：

- 失败属代码 bug → call dev
- 失败属配置/打包 → 我自己改 tauri.conf.json 或相关配置
- 失败需复现观察 → call qa 写复现 spec
