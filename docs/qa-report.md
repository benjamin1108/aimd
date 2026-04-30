---
title: AIMD 桌面版 QA 报告 — 自动压缩反复触发
date: 2026-04-30
scope: 修复 BUG-026（每次打开文档都弹"已自动压缩 X 张图片，节省 NkB"，反复打开持续衰减画质）
---

## 摘要

用户反馈：每次打开同一个 .aimd 文档都会看到 toast"已自动压缩 N 张图片，节省 1kB"，反复打开就反复节省、反复衰减。这是真正的衰减——不是幻觉。

**根因**：`triggerOptimizeOnOpen()` 在每次 `openDocument` 时无条件执行；判定"压缩有效"的阈值是"哪怕新版本只小 1 字节就写回"；而 `compressImageBytes()` 内部固定走 `canvas.toBlob("image/jpeg", 0.85)`——**有损 JPEG 重编码**——每跑一次都会让 JPEG 再缩 1KB 左右、画质进一步退化。结果就是：每打开一次文档，所有大图都被有损二压一次，无限循环直到画质烂到不可挽救。

---

## P0：自动图片压缩反复触发，画质持续衰减（BUG-026）

**严重度**：P0（数据破坏 + 用户骚扰，比单纯 toast 烦人更严重，本质是无声地搞坏图片）

### 复现步骤

1. 新建 .aimd 文档，粘贴一张 ≥ 300KB 的 PNG（触发首次压缩，落盘为 JPEG）。
2. 关闭文档，再打开 → toast："已自动压缩 1 张图片，节省 1KB"。
3. 再次关闭、再次打开 → 继续 toast 并继续节省 1KB。
4. 重复 10 次后图片可见画质损失（块效应、色带）。

### 涉及代码

- `apps/desktop-tauri/src/document/lifecycle.ts:132` —— `void triggerOptimizeOnOpen(doc.path)` 无条件触发，没有"已优化标记"短路。
- `apps/desktop-tauri/src/document/optimize.ts:36` —— `skipTypes` 只跳 gif/svg/webp，**JPEG 没跳**。
- `apps/desktop-tauri/src/document/optimize.ts:53` —— 判定 `compressed.data.byteLength >= rawBuf.byteLength` 才放弃；只要小 1 字节就写回。
- `apps/desktop-tauri/src/editor/images.ts:56-65` —— `compressImageBytes()` 输出 MIME 固定为 `image/jpeg`、quality 0.85，是**有损重编码**。

### 修复方向（推荐方案，dev 可微调）

**核心改动只有两处**，无需改 manifest schema、无需 Go 侧改动：

1. **把 `image/jpeg` 加入 `optimize.ts:36` 的 `skipTypes`。**
   - JPEG 是有损格式，再次有损编码必然衰减；
   - `insertImage` 路径首次插入图片时已经压缩过一次，结果就是 JPEG → 下次打开自然跳过，幂等达成；
   - PNG/BMP 首次被压成 JPEG 后 MIME 变更，第二次打开也会被跳过；
   - **这一条改完已经能让用户报的现象彻底消失**。

2. **加最小收益阈值兜底**：把 `optimize.ts:53` 的判定改为"必须节省至少 10% **且** 至少 50KB（具体数值 dev 自定，但要超过 JPEG 二压典型的 1-2KB 噪声）"才写回。
   - 兜住"用户从外部直接塞进 .aimd 一张超大 JPEG"的边缘场景；
   - 兜住未来如果再加 webp/avif 输出格式时同类问题。

3. **toast 措辞修正**：当 `optimized > 0` 但用户其实并没插入新图（即都是重复触发的"省 1KB"）时不应当 success 提示。结合 1+2 之后这个状况自然消失，但出于稳健，建议把 success toast 的触发条件提到 `savedBytes >= 100KB`（或类似阈值）下才显示，否则降级到 idle，避免给用户"频繁优化"错觉。

### 验收标准（必须新增 e2e 钉死回归）

项目硬规则"修了 bug 就主动补 e2e"，请新增/扩展 spec：

- **case A**：新建文档插入一张大 PNG → 关闭 → 重开 → **不应**出现"已自动压缩"toast；assert `replace_aimd_asset` 在第二次打开时调用次数为 0。
- **case B**：连续打开同一文档 5 次，每次结束后取出 assets/ 文件字节哈希，**第 1 次到第 5 次哈希应当一致**（证明无二次写入）。
- **case C**：直接构造一份只含一张 1MB JPEG 的 .aimd（绕过 insertImage 路径），打开 → 验证不会因为节省 < 阈值而被有损重编码。
- **case D**：放一张 1MB PNG（首次会被合法压成 JPEG），打开 → 验证第一次确实压缩并 toast 一次；再次打开 → 不再 toast、不再写回。

Playwright 既有用例风格参考 `apps/desktop-tauri/e2e/` 目录里现有 spec。`window.__aimd_e2e_disable_auto_optimize` 这个开关已存在（见 optimize.ts:15），但本轮 e2e **不要** set 它——我们要测的就是真实自动优化路径。

---

## 其他

无新发现。本轮报告仅覆盖 BUG-026。
