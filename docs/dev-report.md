# Dev Report — 第 10 轮 (2026-04-30 16:00)

## 本轮修复

### [BUG-026] 每次打开文档都触发自动图片压缩、JPEG 反复有损重编码导致画质衰减

- **位置**: `apps/desktop-tauri/src/document/optimize.ts`
- **根因**: `skipTypes` 未包含 `image/jpeg`，导致已压缩成 JPEG 的资产在每次打开文档时都被 `compressImageBytes`（输出固定 JPEG）重新有损编码一次；判定"有效压缩"的阈值仅为"新版本小 1 字节即写回"，JPEG 二压典型产生 1-2KB 噪声，导致每次打开都触发写回和 toast。
- **修复**:
  1. 将 `"image/jpeg"` 加入 `optimize.ts` 的 `skipTypes`，JPEG 资产直接跳过，根本性幂等保证。
  2. 引入三个常量：`OPTIMIZE_MIN_SAVING_RATIO = 0.10`（最小节省比例 10%）、`OPTIMIZE_MIN_SAVING_BYTES = 50 * 1024`（最小节省字节 50KB），两个条件必须同时满足才写回；兜住边缘场景（如外部直接塞入超大 JPEG）和未来新增输出格式时的同类问题。
  3. 引入 `OPTIMIZE_TOAST_THRESHOLD = 100 * 1024`，仅当 `savedBytes >= 100KB` 时显示 success toast，否则降级到 idle，避免"省 1KB"的骚扰提示。
- **影响面**: 仅 `triggerOptimizeOnOpen` 和 `optimizeDocumentAssets` 两个函数逻辑，不改 manifest schema、不动 Go/Rust 侧。`insertImage` 路径（首次插入时压缩 PNG → JPEG）不受影响，首次压缩仍正常运作。

## 新增 e2e

新增文件: `apps/desktop-tauri/e2e/34-idempotent-optimize.spec.ts`

覆盖 QA 报告 case A/B/C/D（4 个用例）：

| Case | 描述 | 关键 Assert |
|------|------|------------|
| A | JPEG 资产在第二次打开时 `replace_aimd_asset` 调用次数为 0 | `replaceLog.length === 0` |
| B | 连续打开同一文档 5 次，资产字节哈希始终一致（无重复写入） | 5 次 SHA-256 全等，`replaceLog.length === 0` |
| C | 直接构造含 1MB JPEG 的 .aimd（绕过 insertImage），打开不触发重编码 | `replaceLog.length === 0` |
| D | 大 PNG 首次打开确实压缩（replaceLog 长度 1）；第二次调用 optimize 时 mime 已变为 jpeg，跳过，不再写回 | 一次写回 → 清空日志 → 第二次 0 次写回 |

## 未修的 bug 与原因

无。本轮报告仅包含 BUG-026，已全部修复。

## 构建状态

- typecheck: ✅ (0 errors)
- npm run build:web: ✅ (vite build 158ms，无警告)
- cargo check: ✅ (Finished dev profile in 2.33s)
- go vet: ✅ (0 输出，无错误)
- npm run test:e2e: 216 passed / 0 failed（含 4 个新用例）
- tauri build (full): 跳过 ⏭（本轮仅前端 TS 改动，不涉及打包问题）

## 给 QA 的回归提示

- 重点回归 BUG-026 主路径：新建文档 → 插入大 PNG → 保存 → 关闭 → 重新打开，验证第二次打开不出现"已自动压缩"toast。
- 验证边缘场景：用文件管理器直接向 .aimd 压缩包内塞一张超大 JPEG，打开后不应触发压缩（因为 JPEG 在 skipTypes 里）。
- 验证首次压缩仍正常：插入一张 ≥ 300KB 的 PNG，第一次打开含该图的文档时，若节省 ≥ 50KB 且 ≥ 10% 应有 toast；若大 PNG 实际压缩收益很小（如纯色图已被 PNG 高度压缩）则不 toast，这属于正常行为。
