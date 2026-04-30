# AIMD 进阶配方

只在用户的需求超出 SKILL.md 三种常见工作流时再读这份文档。

## 配方 1：复制再修改（保持原文档不变）

```bash
cp report.aimd report-edit.aimd
python3 $SCRIPT read report-edit.aimd > /tmp/body.md
# 编辑 /tmp/body.md
python3 $SCRIPT write report-edit.aimd -i /tmp/body.md
```

`write` 是原地操作。要保留原文件就先 `cp`。

## 配方 2：批量从 Markdown 仓库打包

```bash
for md in posts/*.md; do
  out="dist/$(basename "${md%.md}").aimd"
  python3 $SCRIPT new "$out" -i "$md"
done
```

每个 `.md` 文件的本地图片会按文件目录解析。

## 配方 3：从 `.aimd` 中提取所有图片

```bash
mkdir -p extracted
python3 $SCRIPT manifest report.aimd \
  | python3 -c '
import json,sys,subprocess,os
mf=json.load(sys.stdin)
for a in mf.get("assets",[]):
    out=os.path.join("extracted",os.path.basename(a["path"]))
    subprocess.run(["python3","'$SCRIPT'","extract","report.aimd",a["id"],"-o",out],check=True)
    print(out)
'
```

或者直接用 `unzip` 取（仅读取，不要写回）：
```bash
unzip -j report.aimd 'assets/*' -d extracted/
```

## 配方 4：替换某张图片（保留 id 和引用）

```bash
# 先记下要换的 id
python3 $SCRIPT list report.aimd
# 删旧的，加新的（id 复用需要在 add-asset 时显式指定）
python3 $SCRIPT remove-asset report.aimd chart-001
python3 $SCRIPT add-asset report.aimd new-chart.png --id chart-001 --name chart.png
# 正文里的 ![alt](asset://chart-001) 引用不需要改
```

注意：`asset://chart-001` 的稳定性来自 id 而不是 filename。只要 id 不变，正文不需要改。

## 配方 5：合并两个 `.aimd`

没有内置 merge 命令。手动做法：

```bash
# 1. 先读两份正文
python3 $SCRIPT read a.aimd > /tmp/a.md
python3 $SCRIPT read b.aimd > /tmp/b.md
cat /tmp/a.md /tmp/b.md > /tmp/merged.md

# 2. 拷贝 a.aimd 作为基底
cp a.aimd merged.aimd
python3 $SCRIPT write merged.aimd -i /tmp/merged.md

# 3. 把 b 的资源也搬过去
mkdir -p /tmp/b-assets
python3 $SCRIPT manifest b.aimd | python3 -c '
import json,sys
for a in json.load(sys.stdin).get("assets",[]):
    print(a["id"],a["path"])
' | while read id path; do
  python3 $SCRIPT extract b.aimd "$id" -o "/tmp/b-assets/$(basename "$path")"
  python3 $SCRIPT add-asset merged.aimd "/tmp/b-assets/$(basename "$path")" --id "$id"
done
```

如果两边有 id 冲突，第二个会被自动加序号——这意味着 b 的 `asset://` 引用会失效。需要时先扫一遍 b 的 manifest，把冲突 id 改写到 /tmp/merged.md 中再写回。

## 配方 6：把 `.aimd` 解开成普通的 Markdown 项目

`aimd_io.py` 没有 unpack（因为我们的写流程都是原地编辑）。这种场景请用官方 Go CLI：

```bash
# 如果安装了 aimd
aimd unpack report.aimd -o report-out/
# 输出目录里 main.md 的 asset:// 会被改写回 ./assets/<file> 的相对路径
```

或纯解 ZIP 方式（保持 `asset://` 引用不变）：
```bash
unzip report.aimd -d report-out/
```

## 配方 7：与官方 Go CLI 互操作

`aimd_io.py` 写出的文件可以被 `aimd inspect`、`aimd view`、`aimd preview`、`aimd seal` 直接打开。反之，`aimd pack` 生成的文件也能被 `aimd_io.py` 读写。

如果发现 mismatch：
1. `aimd inspect FILE` 看 SHA-256 校验状态
2. `python3 $SCRIPT manifest FILE > /tmp/m.json` 看完整 manifest
3. 二者均报错 → 文件确实损坏；其中一个报 OK → 报告作者修工具

## 配方 8：在 sidecar / pipeline 里调用

`aimd_io.py` 的子命令都遵循 Unix 风格（成功 exit 0、失败 exit 非 0、错误写到 stderr）。可以直接接到 shell pipeline 里：

```bash
# 把 .aimd 正文喂给 LLM 总结，再写回
python3 $SCRIPT read report.aimd \
  | claude -p "总结成 200 字摘要并加在文末" \
  | python3 $SCRIPT write report.aimd

# JSON 流：列出所有图片资源的 size
python3 $SCRIPT manifest report.aimd \
  | jq -r '.assets[] | "\(.id)\t\(.size)"'
```

## 调试

- `python3 $SCRIPT manifest FILE | jq .` — 完整 manifest
- `unzip -l FILE` — ZIP 中的实际文件列表（应当与 manifest.assets 一致 + 多 `manifest.json` 和 `main.md`）
- 写完之后用 `aimd inspect FILE`（如果可用）做端到端校验

## 何时不要用本 skill

- 用户拿到的是 `.md` + `images/` 目录、且不想要 `.aimd` 容器 → 直接用 Read/Edit/Write 普通 Markdown 即可。
- 用户要把 `.aimd` 转成 PDF / DOCX / sealed HTML → 用官方 `aimd seal` / `aimd export html`，本 skill 不覆盖渲染管线。
- 用户要在浏览器或桌面 app 中打开预览 → `aimd preview` / `aimd view`，本 skill 不启服务。
