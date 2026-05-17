/**
 * 20-rust-handler-registration.spec.ts
 *
 * BUG-001 (P1): spec 18 的 Tauri mock 整体拦截 invoke，删 Rust 端命令注册不会让 e2e fail。
 *
 * 这个 spec 用 fs.readFileSync 读取 lib.rs 文本，逐一断言期望注册的命令名出现在
 * tauri::generate_handler! 宏调用范围内。
 *
 * 修法选 A（grep-style spec）：
 *   - 不依赖 cargo，不引入新依赖
 *   - 能咬住"命令名从 generate_handler! 列表里被误删"的最大风险场景
 *   - 无法咬住"注册了但实现错"，但那是单元测试的职责，这里只做注册校验
 *
 * 同时校验 md 关联相关配置（tauri.conf.json / Info.plist / lib.rs 扩展名标识符）。
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIB_RS = path.resolve(
  __dirname,
  "../src-tauri/src/lib.rs",
);
const DOCUMENTS_RS = path.resolve(
  __dirname,
  "../src-tauri/src/documents.rs",
);

const TAURI_CONF = path.resolve(__dirname, "../src-tauri/tauri.conf.json");
const INFO_PLIST = path.resolve(__dirname, "../src-tauri/Info.plist");

function readLibRs(): string {
  return fs.readFileSync(LIB_RS, "utf-8");
}

function getCspDirective(csp: string, name: string): string[] {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  return directive ? directive.split(/\s+/).slice(1) : [];
}

/**
 * 从 lib.rs 文本中提取 tauri::generate_handler![ ... ] 的内容。
 * 先去掉 // 行注释，再提取宏内部字符串，确保被注释掉的命令名不被误识别为已注册。
 */
function extractHandlerBlock(src: string): string {
  // 先去掉所有 // 单行注释（Rust 不支持块注释嵌套，此处只需处理 //）
  const stripped = src
    .split("\n")
    .map((line) => {
      const commentIdx = line.indexOf("//");
      return commentIdx === -1 ? line : line.slice(0, commentIdx);
    })
    .join("\n");

  const start = stripped.indexOf("tauri::generate_handler![");
  if (start === -1) return "";
  const openBracket = stripped.indexOf("[", start);
  let depth = 1;
  let i = openBracket + 1;
  while (i < stripped.length && depth > 0) {
    if (stripped[i] === "[") depth++;
    if (stripped[i] === "]") depth--;
    i++;
  }
  return stripped.slice(openBracket + 1, i - 1);
}

test.describe("Rust invoke_handler 命令注册校验", () => {
  const expectedCommands = [
    "choose_aimd_file",
    "choose_markdown_file",
    "choose_doc_file",
    "choose_image_file",
    "choose_save_aimd_file",
    "choose_save_markdown_file",
    "confirm_discard_changes",
    "confirm_upgrade_to_aimd",
    "confirm_git_config_change",
    "confirm_git_discard_operation",
    "confirm_keep_online_images",
    "reveal_in_finder",
    "initial_open_path",
    "open_aimd",
    "document_file_fingerprint",
    "create_aimd",
    "save_aimd",
    "save_aimd_as",
    "render_markdown",
    "render_markdown_standalone",
    "import_markdown",
    "package_markdown_as_aimd",
    "package_local_images",
    "package_remote_images",
    "convert_md_to_draft",
    "save_markdown",
    "save_markdown_as",
    "create_aimd_draft",
    "delete_draft_file",
    "cleanup_old_drafts",
    "start_url_extraction",
    "web_clip_raw_extracted",
    "web_clip_progress",
    "web_clip_accept",
    "close_extractor_window",
    "extract_complete",
    "show_extractor_window",
    "configure_web_clip_image_proxy",
    "prefetch_web_clip_image_proxy",
    "clear_web_clip_image_proxy",
    "localize_web_clip_images",
    "save_web_clip",
    "refine_markdown",
    "format_markdown",
    "add_image",
    "add_image_bytes",
    "read_image_bytes",
    "list_aimd_assets",
    "read_aimd_asset",
    "replace_aimd_asset",
    "load_settings",
    "save_settings",
    "test_model_connection",
    "get_git_repo_status",
    "get_git_file_diff",
    "git_stage_file",
    "git_unstage_file",
    "git_stage_all",
    "git_unstage_all",
    "git_commit",
    "git_pull",
    "git_push",
    "git_integration_status",
    "git_integration_enable_global",
    "git_integration_disable_global",
    "git_integration_enable_repo",
    "git_integration_disable_repo",
    "git_integration_write_gitattributes",
    "git_integration_doctor",
    "open_in_new_window",
    "open_draft_in_new_window",
    "initial_draft_path",
    "open_settings_window",
    "close_current_window",
    "destroy_current_window",
    "focus_doc_window",
    "register_window_path",
    "unregister_window_path",
    "unregister_current_window_path",
    "update_window_path",
  ];

  test("lib.rs 包含 tauri::generate_handler! 宏调用", () => {
    const src = readLibRs();
    expect(src).toContain("tauri::generate_handler![");
  });

  for (const cmd of expectedCommands) {
    test(`命令 "${cmd}" 已注册到 generate_handler!`, () => {
      const src = readLibRs();
      const handlerBlock = extractHandlerBlock(src);
      expect(
        handlerBlock,
        `"${cmd}" 未出现在 tauri::generate_handler![] 列表中，请检查 lib.rs`,
      ).toContain(cmd);
    });
  }
});

test.describe("MD 文件关联源码校验", () => {
  test('documents.rs 包含 md / markdown / mdx 扩展名标识符', () => {
    const src = fs.readFileSync(DOCUMENTS_RS, "utf-8");
    expect(src, 'documents.rs 缺少 "md" 扩展名标识符').toContain('"md"');
    expect(src, 'documents.rs 缺少 "markdown" 扩展名标识符').toContain('"markdown"');
    expect(src, 'documents.rs 缺少 "mdx" 扩展名标识符').toContain('"mdx"');
  });

  test('tauri.conf.json 包含 Markdown Document 文件关联', () => {
    const src = fs.readFileSync(TAURI_CONF, "utf-8");
    expect(src, 'tauri.conf.json 缺少 "Markdown Document"').toContain('"Markdown Document"');
  });

  test('Info.plist 包含 Markdown Document CFBundleTypeName', () => {
    const src = fs.readFileSync(INFO_PLIST, "utf-8");
    expect(src, 'Info.plist 缺少 CFBundleTypeName>Markdown Document').toContain(
      "<string>Markdown Document</string>",
    );
  });
});

test.describe("Tauri 内容安全策略源码校验", () => {
  test("img-src 允许 HTTPS Markdown 远程图片", () => {
    const conf = JSON.parse(fs.readFileSync(TAURI_CONF, "utf-8"));
    const csp = String(conf?.app?.security?.csp ?? "");
    const imgSrc = getCspDirective(csp, "img-src");

    expect(imgSrc, "CSP 缺少 img-src 指令").not.toHaveLength(0);
    expect(
      imgSrc,
      "Markdown 中的 https:// 图片会被 Tauri CSP 拦截，请在 img-src 中保留 https:",
    ).toContain("https:");
  });
});
