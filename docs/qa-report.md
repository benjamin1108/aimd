# QA 报告 — 2026-04-29 第十轮复检（BUG-001~006 独立变异验证）

> 复检范围：dev 第十轮报告（BUG-001 P1 假绿 / BUG-002 P1 假绿 / BUG-003 P2 capture / BUG-004 P3 草稿图片 / BUG-005 P3 normalize 抖动 / BUG-006 P3 非 macOS Finder）
> 执行时间：2026-04-29

---

## 裁决：有 P2（变异存活），无 P0/P1

BUG-001、BUG-002、BUG-006 独立变异验证全部通过。BUG-003 发现测试覆盖漏洞（变异存活，P2）。BUG-004 confirm 路径无测试覆盖（P2）。BUG-005 接受（视觉 P3，e2e 难覆盖，确认 lightNormalize 实现逻辑正确）。

---

## 静态检查

| 检查项 | 结果 |
|--------|------|
| typecheck (`tsc --noEmit`) | PASS |
| build:web | PASS（59.76 kB JS / 23.15 kB CSS）|
| go vet ./... | PASS |
| cargo check | 未独立运行（git diff 显示 dev 修改已在上轮通过）|

---

## e2e 回归

```
134 passed / 0 failed（1 worker，1.3 分钟）
```

所有 20 个 spec 文件全部绿灯，与 dev 自报 134/134 一致。

---

## BUG-001 复检（P1 — Rust 注册校验 spec 假绿）

**修复方式**：新建 `e2e/20-rust-handler-registration.spec.ts`，用 `fs.readFileSync` 读 lib.rs，先去除 `//` 行注释再提取 `generate_handler![]` 宏内容，逐一断言 20 个命令名。

**独立变异 1（正向）**：注释 `lib.rs` 第 409 行 `reveal_in_finder,` 注册行
- 结果：spec 20 第 20 条 fail（"reveal_in_finder 未出现在列表中"），其余 20 条 pass
- 判定：PASS — 变异敏感

**独立变异 2（反向，关键校验）**：在 lib.rs 顶部加 `// reveal_in_finder` 注释行，同时真正删掉注册行
- 结果：spec 20 第 20 条仍然 fail
- 判定：PASS — 去注释逻辑正确，顶部伪注释不会误导 spec 通过

**代码走查**：`extractHandlerBlock` 处理 `//` 行注释，但不处理 `/* */` 块注释。若用块注释注释掉注册行，spec 20 会误判为已注册。这是已知局限，接受（P3，Rust 代码库实践中较少用块注释注册行）。

**裁决：BUG-001 修复有效，独立验证通过。**

---

## BUG-002 复检（P1 — heading Enter 测试不敏感）

**修复方式**：将 spec 18 第 3 组前两条改为 `dispatchEvent + ev.defaultPrevented` 模式，断言 `prevented === true`。

**独立变异**：注释 `main.ts:1147` 的 `event.preventDefault()`
- 结果：4 条 fail（spec 18 第 3 组第 1/2 条 + spec 19 A 组第 1/2 条）
- 精确数量与 dev 自报吻合（4 fail）
- 判定：PASS — 变异敏感

**裁决：BUG-002 修复有效，独立验证通过。**

---

## BUG-003 复检（P2 — contextmenu capture 顺序）

**修复方式**：全局 capture listener 加 `closest("[data-file-item]")` 放行；`.recent-item` 按钮加 `data-file-item="true"` 属性；删除文件项 handler 中冗余的 `stopPropagation()`。

**独立变异**：注释 `main.ts:557` 的 `if ((e.target as HTMLElement)?.closest("[data-file-item]")) return;`
- 结果：spec 18 第 4 组第 14 条（文件项测试）和第 15 条（非文件项测试）**全部通过，0 fail**
- 判定：FAIL — 变异存活，测试不敏感

### [NEW-P2-001] BUG-003 测试覆盖漏洞：`closest` 检查变异存活

- **位置**：`apps/desktop-tauri/e2e/18-finder-and-import.spec.ts:444-467`（第 4 组第 14 条）
- **发现方式**：独立变异验证（删掉 closest 检查后测试仍然全部通过）
- **现象**：spec 18 第 4 组第 14 条只断言自定义菜单 `[data-file-ctx-menu]` 是否可见，不检查 `defaultPrevented` 的语义正确性。因为 `e.preventDefault()` 不阻止 JS 事件传播，即使全局 capture listener 不放行（抢先 prevent），文件项的 bubble handler 仍然运行并显示自定义菜单，测试因此始终通过。
- **根因**：`preventDefault()` 只阻止浏览器默认行为（系统右键菜单），不阻止 JS 监听器继续执行。无论全局 capture 是否放行文件项，菜单都会显示，所以测试无法区分两种代码路径。
- **影响**：BUG-003 的核心修复（`closest` 检查）没有被 e2e 咬住。如果未来有人误删这一行，测试不会报警。
- **建议根因**：测试应验证非文件项区域触发 contextmenu 时，文件项区域**内部**触发的 contextmenu 是否调用了文件项自己的 handler（而非通过 `defaultPrevented` 区分，因为两种情况结果相同）。更有效的测试方式是：在文件项上触发 contextmenu 并检查 `ev.defaultPrevented` 的调用者（无法用现有 API），或者记录哪个处理器先 prevent（需要 spy）。
- **附注**：BUG-003 的**功能正确性**本身可通过静态走读确认（修法语义正确），只是测试层面无法用现有模式量化；`data-file-item` 属性目前只加在 `.recent-item`，其他文件入口（若未来新增）需同步加属性。

**裁决：BUG-003 修复代码逻辑正确（静态走读确认），但 e2e 覆盖有漏洞（P2）。**

---

## BUG-004 复检（P3 — 草稿粘贴图片 confirm）

**修复方式**：`pasteImageFiles` 在草稿态调 `window.confirm()` 询问用户，取消则直接 return。

**独立变异**：将 `window.confirm(...)` 替换为 `true`（无视用户选择）
- 结果：所有 134 条测试全部通过，0 fail
- 判定：FAIL — 变异存活，无任何 spec 覆盖 confirm 路径

### [KNOWN-P2-002] BUG-004 confirm 路径无 e2e 覆盖

- **位置**：`apps/desktop-tauri/src/main.ts:1070-1073`
- **发现方式**：独立变异验证
- **现象**：`window.confirm` 被替换为直接返回 `true` 后，134 条测试全部通过，没有任何用例验证"用户点取消时文档仍保持草稿状态"或"confirm 对话框出现"。
- **影响**：confirm 路径如果未来被移除或误改，测试不会报警。
- **代码走查正面**：取消后 `return`（不残留 loading 状态）、`saveDocumentAs()` 后如果用户再次取消路径选择也有 `if (!state.doc?.path) return` 保护 — 逻辑正确。
- **附注**：dev 报告中已标注 BUG-004 选 A（内存资产管理）留作 P3 后续，本轮选 B 已有明显 UX 改善。

**裁决：BUG-004 修复代码逻辑正确，但 e2e 无覆盖（P2 测试覆盖债）。**

---

## BUG-005 复检（P3 — normalize 抖动 700ms）

**修复方式**：新增 `lightNormalize` 函数，在 `onInlineInput` 里同步调用（快速清除块级 style），然后 700ms 防抖再走完整 `flushInline`。

**独立变异**：让 `lightNormalize` 立即 `return`（不清除 style）
- 结果：所有相关 spec 全部通过
- 判定：接受 — 视觉抖动问题无法通过 e2e 量化，符合 P3 预期

**代码走查**：
- `lightNormalize` 只选 `h1-h6[style]` 和 `p[style]`，不动 `span`、`em`、`strong` 等 inline 元素 — 正确保留用户格式
- `li[style]`、`blockquote[style]` 未在 lightNormalize 中处理，打字时要等 700ms 才清除 — 轻微不完整（P3，不影响本轮修复）

**裁决：BUG-005 修复逻辑正确，e2e 覆盖受视觉特性限制，接受。**

---

## BUG-006 复检（P3 — 非 macOS Finder 静默）

**静态验证**：
- `lib.rs:130-134`：`#[cfg(not(target_os = "macos"))]` 分支存在，返回 `Err("在 Finder 中显示仅支持 macOS，Windows/Linux 版本将在后续版本中添加")` — 存在
- `main.ts:2157-2159`：`invoke("reveal_in_finder", { path }).catch((err) => { setStatus(String(err), "warn"); })` — 存在，status bar 显示错误

**裁决：BUG-006 修复代码正确，静态验证通过。当前环境为 macOS，无法直接运行非 macOS 分支，已接受静态验证为充分依据。**

---

## 新发现问题

无新增 P0/P1。P2 测试覆盖漏洞已在 BUG-003 和 BUG-004 复检节中详细说明。

---

## 已验证通过项

| Bug | 状态 | 变异验证 |
|-----|------|---------|
| BUG-001 P1 Rust 注册校验 | PASS | 正向变异 1 fail / 反向变异 1 fail（正确） |
| BUG-002 P1 heading Enter 敏感性 | PASS | 注释 preventDefault → 4 fail |
| BUG-003 P2 capture 顺序 | 代码 PASS / 测试覆盖 P2 | 变异存活 0 fail（测试漏洞） |
| BUG-004 P3 草稿图片 confirm | 代码 PASS / 测试覆盖 P2 | 变异存活 0 fail（测试漏洞） |
| BUG-005 P3 normalize 抖动 | PASS（接受） | 变异存活（视觉问题，e2e 难覆盖）|
| BUG-006 P3 非 macOS Finder | PASS | 静态验证 |

---

## 仍未做的项

1. **inline editor 深度场景**：撤销/重做、跨块选删、IME 切模式 — dev 第九轮自查清单列出但第十轮未动，留后续轮次
2. **BUG-004 选 A**（内存资产管理 pendingAssets）— dev 已标注 P3 后续
3. **BUG-003 data-file-item 覆盖范围**：当前只有 `.recent-item` 加了 `data-file-item`，若未来新增"收藏夹"或其他文件列表，需同步加属性，否则右键自定义菜单会被全局 capture 拦截
4. **BUG-005 `li[style]` / `blockquote[style]`**：lightNormalize 未覆盖，700ms 延迟仍存在 — P3 后续
5. **spec 20 块注释缺陷**：`extractHandlerBlock` 不处理 `/* */` 块注释，P3

---

## Beta 清单

- [x] 新建 / 打开 / 保存 / 另存为 — e2e spec 02/13 覆盖
- [x] 导入 .md 为草稿 — e2e spec 18 覆盖
- [x] 三种模式切换（read/edit/source）— e2e spec 03 覆盖
- [x] 格式工具栏（Bold/Italic/H1-H3/UL/OL/Quote/Code/Link）— e2e spec 04 覆盖
- [x] 大纲导航 + resizer 拖动 — e2e spec 06 覆盖
- [x] 粘贴图片压缩 — e2e spec 14 覆盖
- [x] 文档图片资产优化 — e2e spec 15 覆盖
- [x] 最近文件右键菜单（reveal_in_finder / 复制路径 / 从列表移除）— e2e spec 18 覆盖
- [x] Rust 命令注册完整性（20 条）— e2e spec 20 覆盖
- [x] heading Enter 正确插入 p — e2e spec 18/19 覆盖
- [x] 窄屏布局 < 760px — e2e spec 07 覆盖
- [x] 粘贴内容 XSS 清理 — e2e spec 08 覆盖
- [~] 草稿粘贴图片弹 confirm — 代码正确，无 e2e 覆盖
- [~] 非 macOS reveal_in_finder Err + status bar — 静态验证，无 e2e 覆盖（macOS 环境）
- [ ] BUG-003 closest 检查 e2e 覆盖不足 — 测试变异存活
- [ ] BUG-004 confirm 路径 e2e 覆盖 — 测试变异存活

---

## 本轮新增 vs 上轮残留

- 新发现：NEW-P2-001（BUG-003 测试覆盖漏洞）、KNOWN-P2-002（BUG-004 confirm 路径无测试）
- 已验证修复并通过独立变异验证：BUG-001、BUG-002
- 静态验证通过：BUG-005、BUG-006
- 仍残留测试覆盖问题：BUG-003 closest 变异存活、BUG-004 confirm 变异存活
