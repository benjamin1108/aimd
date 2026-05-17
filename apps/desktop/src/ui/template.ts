import { ICONS } from "../core/state";
import { APP_TOPBAR_HTML } from "./topbar-template";

export const APP_HTML = `
  <div class="app-frame">
    <div class="panel" id="panel" data-shell="launch">
${APP_TOPBAR_HTML}

      <aside class="sidebar" id="sidebar">
        <div class="sidebar-hr-resizer" id="sidebar-hr-resizer" aria-label="调整侧边栏宽度"></div>

        <nav class="sidebar-body" id="sidebar-body">
          <section class="nav-section workspace-section" id="workspace-section">
            <div class="section-label workspace-label">
              <span id="workspace-root-label">项目</span>
              <button id="project-rail-collapse" class="section-toggle rail-collapse-toggle" type="button" title="折叠项目栏" aria-label="折叠项目栏" aria-expanded="true">${ICONS.sidePanelClose}</button>
            </div>
            <div class="workspace-actions" aria-label="项目操作">
              <button id="workspace-open" class="icon-btn" type="button" title="打开项目目录" aria-label="打开项目目录">${ICONS.folder}</button>
              <button id="workspace-refresh" class="icon-btn" type="button" title="刷新项目目录" aria-label="刷新项目目录" disabled>${ICONS.refresh}</button>
              <div class="project-menu-wrap">
                <button id="workspace-new-doc" class="icon-btn" type="button" title="新建项目文件" aria-label="新建项目文件" aria-haspopup="menu" aria-expanded="false" disabled>${ICONS.plus}</button>
                <div id="project-create-menu" class="action-menu project-create-menu" role="menu" hidden>
                  <div class="action-menu-title">项目文件</div>
                  <button id="project-new-aimd" class="action-menu-item" type="button">
                    <span class="action-menu-icon">${ICONS.plus}</span>
                    <span>新建 AIMD 文档</span>
                    <small>.aimd</small>
                  </button>
                  <button id="project-new-markdown" class="action-menu-item" type="button">
                    <span class="action-menu-icon">${ICONS.source}</span>
                    <span>新建 Markdown 文档</span>
                    <small>.md</small>
                  </button>
                  <button id="project-new-folder" class="action-menu-item" type="button">
                    <span class="action-menu-icon">${ICONS.folder}</span>
                    <span>新建文件夹</span>
                  </button>
                </div>
              </div>
              <button id="workspace-close" class="icon-btn" type="button" title="关闭项目" aria-label="关闭项目" disabled>${ICONS.close}</button>
            </div>
            <div class="section-content workspace-scroll">
              <div id="workspace-tree" class="workspace-tree"></div>
            </div>
          </section>
        </nav>

        <footer class="sidebar-foot" id="sidebar-foot" hidden></footer>
      </aside>

      <main class="workspace">
        <div class="document-meta-probe" aria-hidden="true">
          <span id="doc-title">AIMD Desktop</span>
          <span id="doc-path">未打开文档</span>
        </div>
        <div id="doc-state-badges" class="doc-state-badges" aria-label="当前文档状态" hidden></div>
        <div class="starter-actions" id="starter-actions" hidden></div>

        <header class="document-tab-strip" id="document-tab-strip" hidden>
          <div class="tab-bar" id="tab-bar">
            <div class="open-tabs" id="open-tabs" role="tablist" aria-label="打开的文档"></div>
            <div class="tab-nav-controls" aria-label="标签页切换">
              <button class="tab-nav-btn tab-nav-btn--prev" id="open-tabs-prev" type="button" title="切换到上一个标签页" aria-label="切换到上一个标签页" hidden>${ICONS.chevron}</button>
              <button class="tab-nav-btn tab-nav-btn--next" id="open-tabs-next" type="button" title="切换到下一个标签页" aria-label="切换到下一个标签页" hidden>${ICONS.chevron}</button>
            </div>
          </div>
        </header>

        <header class="document-command-strip" id="document-command-strip" hidden>
          <div class="doc-toolbar" id="doc-toolbar">
            <div class="format-toolbar" id="format-toolbar" hidden>
              <div class="ft-group">
                <button class="ft-btn" data-cmd="bold" data-tooltip="粗体 (⌘B)" type="button" aria-label="粗体">${ICONS.bold}</button>
                <button class="ft-btn" data-cmd="italic" data-tooltip="斜体 (⌘I)" type="button" aria-label="斜体">${ICONS.italic}</button>
                <button class="ft-btn" data-cmd="strike" data-tooltip="删除线" type="button" aria-label="删除线">${ICONS.strike}</button>
              </div>
              <span class="ft-sep" role="separator" aria-orientation="vertical"></span>
              <div class="ft-group">
                <button class="ft-btn" data-cmd="h1" data-tooltip="标题 1" type="button" aria-label="标题 1">${ICONS.h1}</button>
                <button class="ft-btn" data-cmd="h2" data-tooltip="标题 2" type="button" aria-label="标题 2">${ICONS.h2}</button>
                <button class="ft-btn" data-cmd="h3" data-tooltip="标题 3" type="button" aria-label="标题 3">${ICONS.h3}</button>
                <button class="ft-btn ft-btn--text" data-cmd="paragraph" type="button">正文</button>
              </div>
              <span class="ft-sep" role="separator" aria-orientation="vertical"></span>
              <div class="ft-group">
                <button class="ft-btn" data-cmd="ul" data-tooltip="无序列表" type="button" aria-label="无序列表">${ICONS.ul}</button>
                <button class="ft-btn" data-cmd="ol" data-tooltip="有序列表" type="button" aria-label="有序列表">${ICONS.ol}</button>
                <button class="ft-btn" data-cmd="quote" data-tooltip="引用" type="button" aria-label="引用">${ICONS.quote}</button>
              </div>
              <span class="ft-sep" role="separator" aria-orientation="vertical"></span>
              <div class="ft-group">
                <button class="ft-btn" data-cmd="code" data-tooltip="行内代码" type="button" aria-label="行内代码">${ICONS.code}</button>
                <button class="ft-btn" data-cmd="codeblock" data-tooltip="代码块" type="button" aria-label="代码块">${ICONS.source}</button>
                <button class="ft-btn" data-cmd="table" data-tooltip="插入表格" type="button" aria-label="插入表格">${ICONS.table}</button>
                <button class="ft-btn" data-cmd="task" data-tooltip="任务列表" type="button" aria-label="任务列表">${ICONS.check}</button>
                <button class="ft-btn" data-cmd="link" data-tooltip="链接" type="button" aria-label="链接">${ICONS.link}</button>
                <button class="ft-btn" data-cmd="image" data-tooltip="插入图片" type="button" aria-label="插入图片">${ICONS.image}</button>
                <button class="ft-btn ft-btn--text" data-cmd="image-alt" data-tooltip="编辑图片描述" type="button" aria-label="编辑图片描述">描述</button>
              </div>
            </div>

            <div class="command-icon-cluster" aria-label="文档视图工具">
              <div id="mode-tool-slot" class="mode-tool-slot">
                <button id="edit-pane-swap" class="ghost-btn icon-only edit-pane-swap-btn" type="button" aria-label="对调源码与预览" aria-hidden="true" data-visible="false" hidden disabled>${ICONS.swapPanes}</button>

                <div id="viewport-width-cluster" class="viewport-width-cluster" hidden>
                  <button id="viewport-width-toggle" class="ghost-btn icon-only viewport-width-toggle" type="button" title="视口宽度" aria-label="视口宽度" aria-controls="viewport-width-popover" aria-expanded="false" disabled>
                    <span class="secondary-btn-icon">${ICONS.viewportWidth}</span>
                  </button>
                  <div id="viewport-width-popover" class="viewport-width-popover" role="radiogroup" aria-label="选择文档视口宽度" hidden>
                    <button id="width-normal" class="viewport-width-option" data-width-option="normal" type="button" role="radio" aria-checked="true">窄</button>
                    <button id="width-wide" class="viewport-width-option" data-width-option="wide" type="button" role="radio" aria-checked="false">中</button>
                    <button id="width-ultra" class="viewport-width-option" data-width-option="ultra" type="button" role="radio" aria-checked="false">宽</button>
                  </div>
                </div>
              </div>

              <div class="find-cluster">
                <button id="find-toggle" class="ghost-btn icon-only command-find-btn" type="button" aria-label="查找" title="查找" aria-controls="find-bar" aria-expanded="false" disabled>
                  <span class="secondary-btn-icon">${ICONS.search}</span>
                </button>

                <div id="find-bar" class="find-bar" role="search" hidden>
                  <div class="find-row">
                    <span class="find-bar-icon" aria-hidden="true">${ICONS.search}</span>
                    <input id="find-input" class="find-input" type="search" placeholder="查找" autocomplete="off" />
                    <span id="find-count" class="find-count">0/0</span>
                    <span class="find-nav" aria-hidden="true"></span>
                    <button id="find-prev" class="find-icon-btn" type="button" title="上一个" aria-label="上一个">${ICONS.chevronUp}</button>
                    <button id="find-next" class="find-icon-btn" type="button" title="下一个" aria-label="下一个">${ICONS.chevronDown}</button>
                    <button id="find-close" class="find-icon-btn find-close-btn" type="button" title="关闭" aria-label="关闭">${ICONS.close}</button>
                  </div>
                  <div class="find-replace-group" hidden>
                    <input id="replace-input" class="find-input replace-input" type="text" placeholder="替换" autocomplete="off" />
                    <button id="replace-one" class="find-text-btn" type="button">替换</button>
                    <button id="replace-all" class="find-text-btn" type="button">全部</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="toolbar-group toolbar-group--mode">
              <div class="mode-switch" role="tablist">
                <button id="mode-read" class="mode-btn" role="tab" aria-selected="true" type="button" disabled>
                  <span>阅读</span>
                </button>
                <button id="mode-edit" class="mode-btn" role="tab" aria-selected="false" type="button" disabled>
                  <span>编辑</span>
                </button>
              </div>
            </div>

            <div class="head-actions command-actions" id="doc-actions" hidden>
              <div class="more-menu-wrap">
                <button id="more-menu-toggle" class="ghost-btn icon-only document-menu-btn" type="button" title="当前文档操作" aria-label="当前文档操作" aria-haspopup="menu" aria-expanded="false">
                  <span class="vertical-dots" aria-hidden="true"><span></span><span></span><span></span></span>
                </button>
                <div id="more-menu" class="action-menu" role="menu" hidden>
                  <div class="action-menu-title">文档</div>
                  <button id="save" class="action-menu-item" type="button" disabled>
                    <span class="action-menu-icon">${ICONS.save}</span>
                    <span id="save-label">保存</span>
                    <small>⌘S</small>
                  </button>
                  <button id="save-as" class="action-menu-item" type="button" disabled>
                    <span class="action-menu-icon">${ICONS.save}</span>
                    <span>另存为...</span>
                    <small>⇧⌘S</small>
                  </button>
                  <button id="format-document" class="action-menu-item" type="button" disabled>
                    <span class="action-menu-icon">${ICONS.sparkle}</span>
                    <span>一键格式化</span>
                    <small>AI</small>
                  </button>
                  <button id="package-local-images" class="action-menu-item" type="button" disabled>
                    <span class="action-menu-icon">${ICONS.image}</span>
                    <span>嵌入本地图片 / 保存为 AIMD</span>
                    <small>资源</small>
                  </button>
                  <button id="health-check" class="action-menu-item" type="button" disabled hidden>
                    <span class="action-menu-icon">${ICONS.info}</span>
                    <span>检查当前文档资源</span>
                  </button>
                  <hr class="action-menu-divider" role="separator">
                  <button id="export-markdown" class="action-menu-item" type="button" disabled>
                    <span class="action-menu-icon">${ICONS.source}</span>
                    <span>导出 Markdown</span>
                    <small>.md</small>
                  </button>
                  <button id="export-html" class="action-menu-item" type="button" disabled>
                    <span class="action-menu-icon">${ICONS.htmlDocument}</span>
                    <span>导出 HTML</span>
                    <small>.html</small>
                  </button>
                  <button id="export-pdf" class="action-menu-item" type="button" disabled>
                    <span class="action-menu-icon">${ICONS.pdfDocument}</span>
                    <span>导出 PDF</span>
                    <small>.pdf</small>
                  </button>
                  <hr class="action-menu-divider" role="separator">
                  <button id="close" class="action-menu-item" type="button" disabled>
                    <span class="action-menu-icon">${ICONS.close}</span>
                    <span>关闭当前标签页</span>
                    <small>⌘W</small>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

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
          <label class="link-popover-label" for="image-alt-input">图片描述</label>
          <input id="image-alt-input" class="link-popover-input" type="text" placeholder="可留空" />
          <div class="link-popover-actions">
            <button id="image-alt-cancel" class="secondary-btn sm" type="button">取消</button>
            <button id="image-alt-confirm" class="primary-btn sm" type="button">确定</button>
          </div>
        </div>

        <div id="ui-tooltip" class="ui-tooltip" role="tooltip" hidden></div>

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
            <div class="launch-grid">
              <div class="launch-main launch-intro">
                <h2>继续处理文档</h2>
                <p class="launch-copy">从最近打开的文档继续，或开始新的内容。</p>
              </div>

              <div class="launch-command-block">
                <div class="launch-group-label">创建</div>
                <div class="launch-command-list">
                  <button id="empty-new" class="launch-command-card" type="button">
                    <span class="launch-card-icon">${ICONS.plus}</span>
                    <span class="launch-card-copy">
                      <span class="launch-card-title">空白 AIMD 草稿</span>
                      <span class="launch-card-meta">从一页空白文档开始</span>
                    </span>
                  </button>
                  <button id="empty-import-web" class="launch-command-card" type="button">
                    <span class="launch-card-icon">${ICONS.link}</span>
                    <span class="launch-card-copy">
                      <span class="launch-card-title">从网页导入</span>
                      <span class="launch-card-meta">提取网页内容为草稿</span>
                    </span>
                  </button>
                </div>

                <div class="launch-group-label">打开</div>
                <div class="launch-command-list">
                  <button id="empty-open" class="launch-command-card" type="button">
                    <span class="launch-card-icon">${ICONS.openDocument}</span>
                    <span class="launch-card-copy">
                      <span class="launch-card-title">打开 AIMD / Markdown</span>
                      <span class="launch-card-meta">选择本地文档继续编辑</span>
                    </span>
                  </button>
                  <button id="empty-open-workspace" class="launch-command-card" type="button">
                    <span class="launch-card-icon">${ICONS.folder}</span>
                    <span class="launch-card-copy">
                      <span class="launch-card-title">打开项目目录</span>
                      <span class="launch-card-meta">浏览并编辑项目文件</span>
                    </span>
                  </button>
                </div>
              </div>

              <div class="launch-side">
                <section class="recent-section" id="recent-section" hidden>
                  <div class="recent-head">
                    <div class="recent-title">最近打开</div>
                    <button id="clear-recent" class="text-btn" type="button">清空</button>
                  </div>
                  <div id="recent-list" class="recent-list"></div>
                </section>
              </div>
            </div>
          </article>

          <article id="git-diff-view" class="git-diff-view" hidden>
            <div id="git-diff-content" class="git-diff-content"></div>
          </article>

          <article id="reader" class="reader aimd" hidden></article>

          <div id="editor-wrap" class="editor-split" data-edit-pane-order="source-first" hidden>
            <div class="editor-pane">
              <div id="source-banner" class="source-banner" hidden>
                <span class="source-banner-icon">${ICONS.info}</span>
                <span class="source-banner-text" id="source-banner-text"></span>
              </div>
              <div class="pane-tag">源码</div>
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
          <div class="inspector-title-row">
            <div class="inspector-owner" id="inspector-owner">未打开文档</div>
            <button id="doc-panel-collapse" class="section-toggle" type="button" title="折叠检查器" aria-expanded="true">${ICONS.sidePanelClose}</button>
          </div>
          <div class="doc-panel-head">
            <div class="doc-panel-tabs" id="doc-panel-tabs" role="tablist" aria-label="当前文档检查器">
              <button id="sidebar-tab-outline" class="doc-panel-tab is-active" type="button" role="tab" aria-selected="true" aria-controls="outline-panel">大纲</button>
              <button id="sidebar-tab-git" class="doc-panel-tab" type="button" role="tab" aria-selected="false" aria-controls="git-panel">Git</button>
              <button id="sidebar-tab-assets" class="doc-panel-tab" type="button" role="tab" aria-selected="false" aria-controls="asset-panel">资源</button>
              <button id="sidebar-tab-health" class="doc-panel-tab" type="button" role="tab" aria-selected="false" aria-controls="health-panel" hidden>健康</button>
            </div>
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
