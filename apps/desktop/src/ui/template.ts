import { ICONS } from "../core/state";

export const APP_HTML = `
  <div class="app-frame">
    <div class="panel" id="panel" data-shell="launch">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-hr-resizer" id="sidebar-hr-resizer" aria-label="调整侧边栏宽度"></div>
        <header class="sidebar-head">
          <div class="brand">
            <span class="brand-mark">A</span>
            <span class="brand-name">AIMD</span>
          </div>
        </header>

        <nav class="sidebar-body" id="sidebar-body">
          <section class="nav-section workspace-section" id="workspace-section">
            <div class="section-label workspace-label">
              <span id="workspace-root-label">项目</span>
              <button id="workspace-collapse" class="section-toggle" type="button" title="折叠项目" aria-expanded="true">⌃</button>
            </div>
            <div class="workspace-actions" aria-label="项目操作">
              <button id="workspace-open" class="icon-btn" type="button" title="打开目录">${ICONS.folder}</button>
              <button id="workspace-refresh" class="icon-btn" type="button" title="刷新项目" disabled>${ICONS.refresh}</button>
              <button id="workspace-new-doc" class="icon-btn" type="button" title="在项目中新建文档" disabled>${ICONS.document}</button>
              <button id="workspace-new-folder" class="icon-btn" type="button" title="新建文件夹" disabled>${ICONS.plus}</button>
              <button id="workspace-close" class="icon-btn" type="button" title="关闭项目" disabled>${ICONS.close}</button>
            </div>
            <div class="section-content workspace-scroll">
              <div id="workspace-tree" class="workspace-tree"></div>
            </div>
          </section>
        </nav>

        <footer class="sidebar-foot" id="sidebar-foot">
          <button id="sidebar-save" class="secondary-btn" type="button" hidden>
            <span class="secondary-btn-icon">${ICONS.save}</span>
            <span>保存</span>
          </button>
          <button id="sidebar-new" class="secondary-btn" type="button">
            <span class="secondary-btn-icon">${ICONS.plus}</span>
            <span>新建</span>
          </button>
          <button id="sidebar-open" class="secondary-btn" type="button">
            <span class="secondary-btn-icon">${ICONS.folder}</span>
            <span>打开</span>
          </button>
        </footer>
      </aside>

      <main class="workspace">
        <header class="workspace-head">
          <div class="doc-meta">
            <h1 id="doc-title" class="doc-title">AIMD Desktop</h1>
            <div id="doc-path" class="doc-path">未打开文档</div>
            <div id="doc-state-badges" class="doc-state-badges" aria-label="当前文档状态" hidden></div>
          </div>

          <div class="starter-actions" id="starter-actions">
            <button id="head-new" class="secondary-btn" type="button">
              <span class="secondary-btn-icon">${ICONS.plus}</span>
              <span>新建</span>
            </button>
            <button id="head-open" class="secondary-btn" type="button">
              <span class="secondary-btn-icon">${ICONS.folder}</span>
              <span>打开</span>
            </button>
          </div>

          <div class="head-actions" id="doc-actions" hidden>
            <button id="save" class="primary-btn" type="button" disabled>
              <span class="primary-btn-icon">${ICONS.save}</span>
              <span id="save-label">保存</span>
            </button>
            <div class="more-menu-wrap">
              <button id="more-menu-toggle" class="ghost-btn icon-only" type="button" title="当前文档操作" aria-haspopup="menu" aria-expanded="false">⋯</button>
              <div id="more-menu" class="action-menu" role="menu" hidden>
                <button id="save-as" class="action-menu-item" type="button" disabled>
                  <span class="action-menu-icon">${ICONS.folder}</span>
                  <span>另存为...</span>
                </button>
                <button id="format-document" class="action-menu-item" type="button" disabled>
                  <span class="action-menu-icon">${ICONS.sparkle}</span>
                  <span>一键格式化</span>
                </button>
                <button id="package-local-images" class="action-menu-item" type="button" disabled>
                  <span class="action-menu-icon">${ICONS.image}</span>
                  <span>保存为 AIMD</span>
                </button>
                <button id="web-import" class="action-menu-item" type="button" disabled>
                  <span class="action-menu-icon">${ICONS.link}</span>
                  <span>从网页导入</span>
                </button>
                <button id="health-check" class="action-menu-item" type="button" disabled>
                  <span class="action-menu-icon">${ICONS.info}</span>
                  <span>检查当前文档资源</span>
                </button>
                <hr class="action-menu-divider" role="separator">
                <button id="export-markdown" class="action-menu-item" type="button" disabled>
                  <span class="action-menu-icon">${ICONS.source}</span>
                  <span>导出 Markdown</span>
                </button>
                <button id="export-html" class="action-menu-item" type="button" disabled>
                  <span class="action-menu-icon">${ICONS.document}</span>
                  <span>导出 HTML</span>
                </button>
                <button id="export-pdf" class="action-menu-item" type="button" disabled>
                  <span class="action-menu-icon">${ICONS.document}</span>
                  <span>导出 PDF</span>
                </button>
                <hr class="action-menu-divider" role="separator">
                <button id="close" class="action-menu-item" type="button" disabled>
                  <span class="action-menu-icon">${ICONS.close}</span>
                  <span>关闭当前标签页</span>
                </button>
                <hr class="action-menu-divider" role="separator">
                <button id="new-window" class="action-menu-item" type="button">
                  <span class="action-menu-icon">${ICONS.plus}</span>
                  <span>新建窗口</span>
                </button>
                <button id="check-updates" class="action-menu-item" type="button">
                  <span class="action-menu-icon">${ICONS.refresh}</span>
                  <span>检查更新</span>
                </button>
                <button id="about-aimd" class="action-menu-item" type="button">
                  <span class="action-menu-icon">${ICONS.info}</span>
                  <span>关于 AIMD</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        <div class="tab-bar" id="tab-bar" hidden>
          <div class="open-tabs" id="open-tabs" role="tablist" aria-label="打开的文档"></div>
        </div>

        <div class="doc-toolbar" id="doc-toolbar" hidden>
          <div class="toolbar-group toolbar-group--mode">
            <div class="mode-switch" role="tablist">
              <button id="mode-read" class="mode-btn" role="tab" aria-selected="true" type="button" disabled>
                <span>预览</span>
              </button>
              <button id="mode-edit" class="mode-btn" role="tab" aria-selected="false" type="button" disabled>
                <span>可视编辑</span>
              </button>
              <button id="mode-source" class="mode-btn" role="tab" aria-selected="false" type="button" disabled>
                <span>Markdown</span>
              </button>
            </div>
          </div>

          <div class="doc-toolbar-spacer"></div>

          <button id="find-toggle" class="secondary-btn sm" type="button" disabled>
            <span>查找</span>
          </button>

          <div id="find-bar" class="find-bar" hidden>
            <input id="find-input" class="find-input" type="search" placeholder="查找" autocomplete="off" />
            <input id="replace-input" class="find-input replace-input" type="text" placeholder="替换" autocomplete="off" />
            <span id="find-count" class="find-count">0/0</span>
            <button id="find-prev" class="find-icon-btn" type="button" title="上一个" aria-label="上一个">↑</button>
            <button id="find-next" class="find-icon-btn" type="button" title="下一个" aria-label="下一个">↓</button>
            <button id="replace-one" class="secondary-btn sm" type="button">替换</button>
            <button id="replace-all" class="secondary-btn sm" type="button">全部</button>
            <button id="find-close" class="find-icon-btn" type="button" title="关闭">${ICONS.close}</button>
          </div>
        </div>

        <div class="format-toolbar" id="format-toolbar" hidden>
          <div class="ft-group">
            <button class="ft-btn" data-cmd="bold" type="button" title="粗体 (⌘B)">${ICONS.bold}</button>
            <button class="ft-btn" data-cmd="italic" type="button" title="斜体 (⌘I)">${ICONS.italic}</button>
            <button class="ft-btn" data-cmd="strike" type="button" title="删除线">${ICONS.strike}</button>
          </div>
          <span class="ft-sep"></span>
          <div class="ft-group">
            <button class="ft-btn" data-cmd="h1" type="button" title="标题 1">${ICONS.h1}</button>
            <button class="ft-btn" data-cmd="h2" type="button" title="标题 2">${ICONS.h2}</button>
            <button class="ft-btn" data-cmd="h3" type="button" title="标题 3">${ICONS.h3}</button>
            <button class="ft-btn ft-btn--text" data-cmd="paragraph" type="button" title="正文">正文</button>
          </div>
          <span class="ft-sep"></span>
          <div class="ft-group">
            <button class="ft-btn" data-cmd="ul" type="button" title="无序列表">${ICONS.ul}</button>
            <button class="ft-btn" data-cmd="ol" type="button" title="有序列表">${ICONS.ol}</button>
            <button class="ft-btn" data-cmd="quote" type="button" title="引用">${ICONS.quote}</button>
          </div>
          <span class="ft-sep"></span>
          <div class="ft-group">
            <button class="ft-btn" data-cmd="code" type="button" title="行内代码">${ICONS.code}</button>
            <button class="ft-btn" data-cmd="codeblock" type="button" title="代码块">${ICONS.source}</button>
            <button class="ft-btn" data-cmd="table" type="button" title="插入表格">${ICONS.table}</button>
            <button class="ft-btn" data-cmd="task" type="button" title="任务列表">${ICONS.check}</button>
            <button class="ft-btn" data-cmd="link" type="button" title="链接">${ICONS.link}</button>
            <button class="ft-btn" data-cmd="image" type="button" title="插入图片">${ICONS.image}</button>
            <button class="ft-btn ft-btn--text" data-cmd="image-alt" type="button" title="图片 alt">Alt</button>
          </div>
        </div>

        <!-- BUG-013: 自定义链接输入浮层，替代 WKWebView 不支持的 window.prompt -->
        <div id="link-popover" class="link-popover" hidden>
          <label class="link-popover-label" for="link-popover-input" id="link-popover-title">链接地址</label>
          <input id="link-popover-input" class="link-popover-input" type="url" placeholder="https://" />
          <div class="link-popover-actions">
            <button id="link-popover-unlink" class="secondary-btn sm danger-btn" type="button" hidden>删除链接</button>
            <button id="link-popover-cancel" class="secondary-btn sm" type="button">取消</button>
            <button id="link-popover-confirm" class="primary-btn sm" type="button">确定</button>
          </div>
        </div>

        <div id="image-alt-popover" class="link-popover" hidden>
          <label class="link-popover-label" for="image-alt-input">图片 alt 文本</label>
          <input id="image-alt-input" class="link-popover-input" type="text" />
          <div class="link-popover-actions">
            <button id="image-alt-cancel" class="secondary-btn sm" type="button">取消</button>
            <button id="image-alt-confirm" class="primary-btn sm" type="button">确定</button>
          </div>
        </div>

        <div id="web-clip-panel" class="web-clip-panel" hidden>
          <div class="web-clip-panel-head">
            <div>
              <div class="web-clip-title">从网页导入</div>
              <div id="web-clip-message" class="web-clip-message">从网页创建未保存草稿</div>
            </div>
            <button id="web-clip-close" class="ft-btn" type="button" title="关闭">${ICONS.close}</button>
          </div>
          <label class="web-clip-field" for="web-clip-url">
            <span>网页 URL</span>
            <input id="web-clip-url" type="url" placeholder="https://example.com/article" autocomplete="off" spellcheck="false" />
          </label>
          <div id="web-clip-error" class="web-clip-error" hidden></div>
          <div class="web-clip-actions">
            <button id="web-clip-fallback" class="secondary-btn sm" type="button" hidden>在提取窗口中打开</button>
            <button id="web-clip-cancel" class="secondary-btn sm" type="button">取消</button>
            <button id="web-clip-submit" class="primary-btn sm" type="button">提取</button>
          </div>
        </div>

        <div id="format-preview-panel" class="format-preview-panel" hidden>
          <div class="format-preview-head">
            <div>
              <div class="format-preview-title">一键格式化</div>
              <div class="format-preview-sub">确认后替换当前文档内容</div>
            </div>
            <button id="format-preview-cancel-x" class="ft-btn" type="button" title="关闭">${ICONS.close}</button>
          </div>
          <pre id="format-preview-text" class="format-preview-text"></pre>
          <div class="format-preview-actions">
            <button id="format-cancel" class="secondary-btn sm" type="button">取消</button>
            <button id="format-apply" class="primary-btn sm" type="button">应用</button>
          </div>
        </div>

        <div id="save-format-panel" class="format-preview-panel save-format-panel" hidden>
          <div class="format-preview-head">
            <div>
              <div class="format-preview-title">选择保存格式</div>
              <div class="format-preview-sub">保存为 Markdown 或 AIMD</div>
            </div>
            <button id="save-format-cancel-x" class="ft-btn" type="button" title="关闭">${ICONS.close}</button>
          </div>
          <div class="save-format-options">
            <button id="save-format-markdown" class="save-format-option" type="button">
              <strong>Markdown (.md)</strong>
              <span>写出 YAML frontmatter 和正文；有内嵌资源时导出 assets 目录并改写相对路径。</span>
            </button>
            <button id="save-format-aimd" class="save-format-option" type="button">
              <strong>AIMD (.aimd)</strong>
              <span>保留 Markdown、YAML 元信息和内嵌资源，适合长期归档。</span>
            </button>
          </div>
        </div>

        <div id="update-panel" class="update-panel" data-surface="update" data-phase="idle" hidden aria-live="polite" aria-labelledby="update-title">
          <div class="update-panel-head">
            <div>
              <div id="update-title" class="update-title">AIMD 更新</div>
              <div id="update-message" class="update-message"></div>
            </div>
            <button id="update-later" class="ghost-btn icon-only update-close" type="button" title="关闭" aria-label="关闭">${ICONS.close}</button>
          </div>

          <div id="about-body" class="updater-about-body" hidden>
            <div class="about-version-lines">
              <div id="about-version" class="about-version">版本</div>
              <div id="about-platform" class="about-platform">平台</div>
            </div>
            <div id="about-update-summary" class="about-update-summary">更新状态：未检查</div>
            <div id="about-copy-status" class="about-copy-status" hidden></div>
            <div class="about-actions">
              <button id="about-check-updates" class="secondary-btn sm" type="button">检查更新</button>
              <button id="about-install" class="primary-btn sm" type="button" hidden>下载并安装</button>
              <button id="about-copy-version" class="secondary-btn sm" type="button">复制版本信息</button>
              <button id="about-release" class="secondary-btn sm" type="button">发布页面</button>
            </div>
          </div>

          <div id="update-body" class="updater-update-body">
            <div id="update-notes" class="update-notes" hidden></div>
            <div id="update-progress-wrap" class="update-progress-wrap" hidden>
              <div id="update-progress-bar" class="update-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="更新下载进度">
                <div id="update-progress-fill" class="update-progress-fill"></div>
              </div>
              <div class="update-progress-meta">
                <span id="update-progress" class="update-progress"></span>
                <span id="update-progress-detail" class="update-progress-detail"></span>
              </div>
            </div>
            <div class="update-actions">
              <button id="update-release" class="secondary-btn sm" type="button" hidden>发布说明</button>
              <button id="update-copy-diagnostics" class="secondary-btn sm" type="button" hidden>复制诊断</button>
              <button id="update-focus-dirty" class="secondary-btn sm" type="button" hidden>定位文档</button>
              <button id="update-background" class="secondary-btn sm" type="button" hidden>后台继续</button>
              <button id="update-remind-later" class="secondary-btn sm" type="button" hidden>稍后提醒</button>
              <button id="update-retry" class="secondary-btn sm" type="button" hidden>重新检查</button>
              <button id="update-install" class="primary-btn sm" type="button" hidden>下载并安装</button>
            </div>
          </div>
        </div>

        <section class="workspace-body">
          <article id="empty" class="empty-state">
            <header class="launch-head">
              <div class="empty-mark">${ICONS.document}</div>
              <div class="launch-head-text">
                <h2>开始</h2>
                <p>新建文档、打开 AIMD / Markdown，或打开项目目录。</p>
              </div>
            </header>

            <div class="launch-actions">
              <button id="empty-new" class="primary-btn" type="button">
                <span class="primary-btn-icon">${ICONS.plus}</span>
                <span>新建文档</span>
              </button>
              <button id="empty-open" class="secondary-btn" type="button">
                <span class="secondary-btn-icon">${ICONS.folder}</span>
                <span>打开文档</span>
              </button>
              <button id="empty-open-workspace" class="secondary-btn" type="button">
                <span class="secondary-btn-icon">${ICONS.folder}</span>
                <span>打开目录</span>
              </button>
              <button id="empty-import-web" class="secondary-btn" type="button">
                <span class="secondary-btn-icon">${ICONS.link}</span>
                <span>从网页导入</span>
              </button>
              <button id="empty-import-md-project" class="secondary-btn" type="button">
                <span class="secondary-btn-icon">${ICONS.source}</span>
                <span>导入 Markdown 文件夹</span>
              </button>
            </div>

            <section class="recent-section" id="recent-section" hidden>
              <div class="recent-head">
                <div class="recent-title">最近打开</div>
                <button id="clear-recent" class="text-btn" type="button">清空</button>
              </div>
              <div id="recent-list" class="recent-list"></div>
            </section>

            <div class="empty-hint">⌘N 新建 · ⌘O 打开 · ⇧⌘S 另存为 · 拖入 .aimd / Markdown 即可打开</div>
          </article>

          <article id="git-diff-view" class="git-diff-view" hidden>
            <div id="git-diff-content" class="git-diff-content"></div>
          </article>

          <article id="reader" class="reader aimd" hidden></article>

          <article id="inline-editor"
                   class="reader aimd inline-editor"
                   contenteditable="true"
                   spellcheck="false"
                   hidden></article>

          <div id="editor-wrap" class="editor-split" hidden>
            <div class="editor-pane">
              <div id="source-banner" class="source-banner" hidden>
                <span class="source-banner-icon">${ICONS.info}</span>
                <span class="source-banner-text" id="source-banner-text"></span>
              </div>
              <div class="pane-tag">Markdown</div>
              <div class="source-editor-shell">
                <pre id="markdown-highlight" class="markdown-highlight" aria-hidden="true"></pre>
                <textarea id="markdown" spellcheck="false" wrap="soft"></textarea>
              </div>
            </div>
            <div class="preview-pane">
              <div class="pane-tag">预览</div>
              <div id="preview" class="reader aimd preview"></div>
            </div>
          </div>
        </section>

        <footer class="workspace-foot">
          <button id="debug-indicator" class="debug-indicator" type="button" hidden aria-label="打开调试控制台">
            <span class="debug-indicator-dot" aria-hidden="true"></span>
            <span class="debug-indicator-label">调试</span>
            <span id="debug-indicator-count" class="debug-indicator-count">0</span>
          </button>
          <span class="status-pill" id="status-pill" data-tone="idle">
            <span class="status-dot"></span>
            <span id="status">就绪</span>
          </span>
        </footer>
      </main>

      <aside class="inspector" id="inspector" aria-label="当前文档检查器">
        <div class="inspector-hr-resizer" id="inspector-hr-resizer" aria-label="调整检查器宽度"></div>
        <section class="nav-section nav-section--inspector" id="outline-section" hidden>
          <div class="inspector-owner" id="inspector-owner">未打开文档</div>
          <div class="doc-panel-tabs" id="doc-panel-tabs" role="tablist" aria-label="当前文档检查器">
            <button id="sidebar-tab-outline" class="doc-panel-tab is-active" type="button" role="tab" aria-selected="true" aria-controls="outline-panel">大纲</button>
            <button id="sidebar-tab-assets" class="doc-panel-tab" type="button" role="tab" aria-selected="false" aria-controls="asset-panel">资源</button>
            <button id="sidebar-tab-git" class="doc-panel-tab" type="button" role="tab" aria-selected="false" aria-controls="git-panel" hidden>Git</button>
            <button id="sidebar-tab-health" class="doc-panel-tab" type="button" role="tab" aria-selected="false" aria-controls="health-panel">健康</button>
            <button id="doc-panel-collapse" class="section-toggle" type="button" title="折叠检查器" aria-expanded="true">⌃</button>
          </div>
          <div class="section-content inspector-scroll">
            <div id="outline-panel" role="tabpanel">
              <div id="outline-list" class="outline-list"></div>
            </div>
            <div id="asset-panel" role="tabpanel" hidden>
              <section class="asset-inspector-section" id="asset-section" hidden>
                <div id="asset-list" class="asset-list"></div>
              </section>
            </div>
            <div id="git-panel" class="git-panel" role="tabpanel" hidden>
              <div id="git-content" class="git-content"></div>
            </div>
            <div id="health-panel" class="health-panel health-panel--inspector" role="tabpanel" hidden>
              <div class="health-panel-head">
                <div>
                  <div class="health-title">资源健康</div>
                  <div id="health-summary" class="health-summary">未检查</div>
                </div>
                <button id="health-close" class="ft-btn" type="button" title="关闭">${ICONS.close}</button>
              </div>
              <div id="health-list" class="health-list"></div>
              <div class="health-actions">
                <button id="health-clean-unused" class="secondary-btn sm" type="button">清理未引用资源</button>
                <button id="health-package-local" class="secondary-btn sm" type="button">嵌入本地图片</button>
              </div>
            </div>
          </div>
        </section>

        <button class="sb-resizer" id="sb-resizer-workspace-doc" hidden
                data-above="#workspace-section" data-below="#outline-section"
                aria-label="调整项目与检查器高度"></button>
        <button class="sb-resizer" id="sb-resizer-outline-asset" hidden
                data-above="#outline-section" data-below="#asset-section"
                aria-label="调整大纲与资源高度"></button>
      </aside>
    </div>
  </div>
`;
