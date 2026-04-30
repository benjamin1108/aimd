# Dev Report — 图片孤儿资源清理（2026-04-30）

## 本轮修复

本轮实施图片 GC 方案 A + B + C，分三步独立完成。未修 QA 报告中的其他 bug（BUG-012~015），本轮任务聚焦在资源膨胀问题。

---

### 第一步：A —— 保存时 GC（兜底）

**位置**：
- `internal/aimd/rewrite.go`：新增 `GCUnreferenced bool` 字段到 `RewriteOptions`；新增 `assetIDPattern` 正则和 `ReferencedAssetIDs()` 导出函数（第 34–53 行）；在 `Rewrite()` 内当 `GCUnreferenced == true` 时，扫描 markdown 提取引用集合，不在集合里的资源跳过写入（第 63–76 行）
- `internal/desktop/desktop.go:Save()`：调用 `Rewrite` 时传 `GCUnreferenced: true`（约第 193 行）
- `internal/desktop/desktop.go:SaveAs()`：在手动 Create 路径里调用 `aimd.ReferencedAssetIDs()` 过滤未引用资源（约第 237 行）

**正则覆盖范围**（`asset://([A-Za-z0-9._-]+)`）：
- `![alt](asset://id)` — Markdown 图片
- `[text](asset://id)` — Markdown 链接
- `<img src="asset://id">` — HTML 双引号
- `<img src='asset://id'>` — HTML 单引号
- 属性乱序：`<img alt="y" src="asset://id" width="200">` — 正则只匹配 `asset://` 前缀，不依赖属性顺序

**新增 Go 单测**（`internal/aimd/rewrite_test.go`）：
- `TestReferencedAssetIDs`：9 个子用例，覆盖所有引用形式、去重、无引用情况
- `TestRewriteGCUnreferenced`：粘了 img-001 + img-002，markdown 只引用 img-001，GC 后 img-002 消失
- `TestRewriteGCRemovesAllWhenNoRefs`：markdown 无引用，GC 后资源清单为空

**Go 单测结果**：3 个测试，全部 PASS

---

### 第二步：B —— 写入侧 hash 去重

**位置**：`internal/desktop/desktop.go:AddImage()`（约第 285–395 行）

**新增辅助函数**：
- `sha256Hex(data []byte) string`：计算字节的 SHA-256 hex 摘要
- `findAssetByHash(r *aimd.Reader, wantHash string) (string, error)`：遍历现有资源逐个读出计算 hash，命中返回已有 id

**改动逻辑**：
1. 读取待写入字节，计算 `incomingHash`
2. 打开文件后，调用 `findAssetByHash` 检索现有资源
3. 命中 → 直接返回已有资源的 DTO，不执行 `Rewrite`（不写新副本）
4. 未命中 → 走原有写入路径

**选择简单方案理由**：资源数量通常 <100 张，每次 AddImage 时逐个读出计算 hash 耗时可接受（单次 IO 通常 <10ms）；无需修改 manifest schema，向后兼容。

**注意**：`desktop.go` 已有 `crypto/sha256` 和 `encoding/hex` import，未引入新依赖。

---

### 第三步：C —— 编辑时增量清理

**位置**：`apps/desktop-tauri/src/editor/inline.ts`

**改动**：
- 新增 `gcInlineAssets(markdown: string)` 函数：过滤 `state.doc.assets`，移除 id 在 markdown 中找不到 `asset://<id>` 的项
- 在 `flushInline()` 的 `if (md !== state.doc.markdown)` 分支末尾调用 `gcInlineAssets(md)`
- 仅改内存中的 `state.doc.assets`，不触发磁盘写入

**字符串匹配方式**：`markdown.includes(ASSET_URI_PREFIX + a.id)` — 简单快速，无需正则，因为 id 本身不含特殊字符。

**影响**：
- autosave / crash recovery 读出的 `state.doc.assets` 已经是精简状态
- 未来相同图片再次粘贴时，B 的去重能更快命中（前端资产列表已清理）
- 不影响源码模式（source mode 不走 `flushInline`）；source 模式下的孤儿由 A 在保存时兜底清除

---

### 新增 e2e（`apps/desktop-tauri/e2e/32-image-gc.spec.ts`）

3 个用例：

| 用例 | 验证目标 | 结果 |
|------|---------|------|
| [A] 粘图 → 删图 → 保存后资源清单为空 | 保存时 GC 正常移除孤儿 | PASS |
| [C] flushInline 后 state.doc.assets 同步清除未引用图片 | 编辑时增量清理 | PASS |
| [B] 连续粘贴同一图片保存后资产去重 | mock 模拟后端 hash dedup + GC | PASS |

---

## 偏离原方案的决策

**B 的 mock 设计调整**：e2e 中的 `save_aimd` mock 在过滤引用资源时增加了按 id 去重逻辑（`Set<string>` 去重），以准确模拟后端 hash dedup 的效果。这不是实现层偏离，只是测试 mock 的精确化。

**`SaveAs` 手动 Create 路径**：原方案只提到 `Save()`，`SaveAs()` 在 srcFile == destFile 时会走 `Save()`（已覆盖），但 srcFile != destFile 时走自己的 Create 路径，同样需要 GC。已同步加入 `ReferencedAssetIDs` 过滤，避免"另存为"时把孤儿资源复制到新文件。

---

## 构建状态

- `go vet ./...`: PASS
- `go build ./...`: PASS
- `go test ./internal/aimd/...`（新增单测）: 3 passed
- typecheck (`tsc --noEmit`): PASS
- `npm run build:web`: PASS（65.92 kB JS / 24.61 kB CSS）
- `npm run test:e2e`（全量）: **201 passed / 0 failed**（含新增 3 个用例，约 2.1 分钟）
- tauri build (full): 跳过 ⏭（无打包需求）

---

## 给 QA 的回归提示

**重点回归场景**：
1. **粘图 → 立即保存**：图片应正常出现在文档中（确认 GC 没把刚粘入的图误删）
2. **粘图 → Cmd+Z → 保存**：撤销后再保存，资产清单应为空（A 兜底）
3. **粘同一张图 3 次 → 保存**：文档中应有 3 个图片显示，但 .aimd 文件内只有 1 份字节（B 去重）
4. **粘图 → 在编辑器里选中 img 按 Delete → 不保存**：资源面板（侧栏）应立即更新，图片缩略图消失（C 增量清理）
5. **另存为**：孤儿资源不应被复制到新文件（已加 GC 过滤）

**BUG-012 / 013 / 014 / 015**：本轮未修，仍为待处理状态。
