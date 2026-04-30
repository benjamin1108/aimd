# AIMD v0.1 格式深入

只有当 SKILL.md 里的子命令不够用、需要直接理解或定制 manifest 时，再读这份文档。

## 容器结构

`.aimd` 是一个标准 ZIP，必含：

```
manifest.json     # UTF-8 JSON，缩进 2 空格
main.md           # Markdown 正文（manifest.entry 指向它，默认 main.md）
assets/<...>      # 0..N 个资源文件
```

ZIP 内文件名使用 POSIX 斜杠，UTF-8 编码。资源目录可以有子目录，但 v0.1 工具默认平铺在 `assets/` 下。

## manifest.json schema

权威定义在 `internal/manifest/manifest.go`。字段如下：

```jsonc
{
  "format": "aimd",                       // 必填，固定值 "aimd"
  "version": "0.1",                       // 必填，spec 版本
  "title": "AI 日报｜2026-04-30",          // 可选，文档标题（无则用 H1 或文件名）
  "entry": "main.md",                     // 必填，正文文件名（约定 main.md）
  "createdAt": "2026-04-29T16:21:59.096Z", // RFC3339 UTC
  "updatedAt": "2026-04-30T06:05:39.326Z", // RFC3339 UTC，每次写入刷新
  "authors": [                            // 可选
    { "name": "Claude", "type": "ai" },   // type: "human" | "ai"
    { "name": "添毅",   "type": "human" }
  ],
  "generatedBy": {                        // 可选，AI 出处溯源
    "type": "ai",                         // 通常 "ai"
    "model": "claude-opus-4-7",
    "provider": "anthropic",
    "prompt": "..."                       // 可选，提示词
  },
  "assets": [
    {
      "id": "chart-001",                  // 必填，[A-Za-z0-9._-]+
      "path": "assets/chart.png",         // 必填，相对 ZIP root
      "mime": "image/png",                // 可选，建议填
      "size": 12345,                      // 字节数（未压缩）
      "sha256": "abc...",                 // 64 字符小写 hex
      "role": "content-image"             // content-image | cover | attachment
    }
  ],
  "rendering": {                          // 可选，渲染提示
    "theme": "default",
    "style": "..."
  }
}
```

### Asset role 的语义

| role | 含义 |
|---|---|
| `content-image` | 正文中通过 `![alt](asset://id)` 引用的图片（默认） |
| `cover` | 文档封面图 |
| `attachment` | 不在正文渲染、但随文档分发的附件 |

## 资源引用

正文中的资源使用 `asset://<id>` 协议，**不要用相对路径**。三种形式都被识别：

```markdown
![alt](asset://chart-001)
[下载附件](asset://annex-001)
<img src="asset://logo-001" alt="logo">
```

`aimd_io.py gc` 会扫描这些引用确定哪些 asset 是“被引用的”。

## SHA-256 完整性

`assets[].sha256` 存储未压缩字节的 SHA-256。`aimd_io.py` 在写资源时会重算并填充该字段。任何外部工具读取 `.aimd` 时都可以用它做防篡改校验。

`aimd inspect FILE` 会对每个资源做 `ok` / `MISMATCH` / `missing` / `no-hash` 标记。

## 时间戳约定

- 都是 UTC，RFC3339 格式。
- `createdAt` 由 `new` 创建时设置，之后不再更新。
- `updatedAt` 在每次写入时刷新（精度毫秒，Z 结尾）。

## 兼容与扩展性

- 解析器应当忽略未知 manifest 字段。
- 需要扩展时，把自定义元数据放在自己的命名空间下（例如 `x-myorg-...`），避免占用未来的官方字段。
- v0.2 之后可能引入：签名（`signature`）、内容引用（`citations`）、目录（`outline`）。`aimd_io.py` 在写入时使用 `dict(manifest)` 复制原 manifest，因此未知字段会被原样保留。

## 与 Go CLI 的字段一致性

`aimd_io.py` 与 `internal/manifest/manifest.go` 输出**字段同源**。差异仅在：

- Python 版用 `now.isoformat()` 风格的 `Z` 时间戳；Go 版用 `time.Time.MarshalJSON`，两者均符合 RFC3339。
- Python 版在重写已有 asset 时会重新计算 size 与 sha256（即使 manifest 原本与字节不符）。这通常是好事——文件保持一致——但若你需要对“原始 manifest 报告的 size”做考古，请先 `aimd_io.py manifest FILE` 备份再写入。
