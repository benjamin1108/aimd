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
          <section class="nav-section" id="outline-section" hidden>
            <div class="section-label">
              <span>大纲</span>
              <span class="section-count" id="outline-count">0</span>
            </div>
            <div class="section-content">
              <div id="outline-list" class="outline-list"></div>
            </div>
          </section>

          <section class="nav-section nav-section--tour" id="docutour-section" hidden>
            <div class="section-label">
              <span>导读</span>
              <span class="section-count" id="docutour-count">0</span>
            </div>
            <div class="section-content">
              <div id="docutour-panel" class="docutour-panel">
                <header class="docutour-panel-head">
                  <div>
                    <div class="docutour-kicker">AI 导读</div>
                    <div class="docutour-counter"></div>
                  </div>
                  <button class="docutour-exit" data-tour-exit type="button">退出</button>
                </header>
                <div class="docutour-progress" aria-hidden="true"><span></span></div>
                <div class="docutour-content">
                  <div class="docutour-meta"></div>
                  <div class="docutour-step-title"></div>
                  <div class="docutour-why"></div>
                  <div class="docutour-insight"></div>
                  <div class="docutour-next"></div>
                </div>
                <div class="docutour-sidebar-actions">
                  <button class="docutour-control-btn" data-tour-prev type="button">上一步</button>
                  <button class="docutour-control-btn" data-tour-next type="button">下一步</button>
                </div>
                <div class="docutour-keyhint">← / → 切换步骤</div>
              </div>
            </div>
          </section>

          <button class="sb-resizer" id="sb-resizer-outline-asset" hidden
                  data-above="#outline-section" data-below="#asset-section"
                  aria-label="调整大纲与资源高度"></button>

          <section class="nav-section" id="asset-section" hidden>
            <div class="section-label">
              <span>资源</span>
              <span class="section-count" id="asset-count">0</span>
            </div>
            <div class="section-content">
              <div id="asset-list" class="asset-list"></div>
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
            <div id="doc-path" class="doc-path">正文、图片和元信息始终在一起</div>
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
              <button id="more-menu-toggle" class="ghost-btn icon-only" type="button" title="更多文档操作" aria-haspopup="menu" aria-expanded="false">⋯</button>
              <div id="more-menu" class="action-menu" role="menu" hidden>
                <button id="save-as" class="action-menu-item" type="button" disabled>
                  <span class="action-menu-icon">${ICONS.folder}</span>
                  <span>另存为...</span>
                </button>
                <button id="new-window" class="action-menu-item" type="button">
                  <span class="action-menu-icon">${ICONS.plus}</span>
                  <span>新窗口打开</span>
                </button>
                <hr class="action-menu-sep" role="separator">
                <button id="close" class="action-menu-item" type="button" disabled>
                  <span class="action-menu-icon">${ICONS.close}</span>
                  <span>关闭文档</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        <div class="doc-toolbar" id="doc-toolbar" hidden>
          <div class="toolbar-group toolbar-group--mode">
            <div class="mode-switch" role="tablist">
              <button id="mode-read" class="mode-btn" role="tab" aria-selected="true" type="button" disabled>
                <span>阅读</span>
              </button>
              <button id="mode-edit" class="mode-btn" role="tab" aria-selected="false" type="button" disabled>
                <span>编辑</span>
              </button>
              <button id="mode-source" class="mode-btn" role="tab" aria-selected="false" type="button" disabled>
                <span>源码</span>
              </button>
            </div>
          </div>

          <div class="doc-toolbar-spacer"></div>

          <div class="toolbar-group toolbar-group--tour" id="tour-actions">
            <button id="docutour-play" class="secondary-btn" type="button" hidden>
              <span class="secondary-btn-icon">${ICONS.play}</span>
              <span>播放导览</span>
            </button>
            <button id="docutour-generate" class="ghost-btn" type="button" disabled>
              <span class="secondary-btn-icon">${ICONS.sparkle}</span>
              <span id="docutour-generate-label">生成导览</span>
            </button>
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
            <button class="ft-btn" data-cmd="link" type="button" title="链接">${ICONS.link}</button>
            <button class="ft-btn" data-cmd="image" type="button" title="插入图片">${ICONS.image}</button>
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

        <section class="workspace-body">
          <article id="empty" class="empty-state">
            <header class="launch-head">
              <div class="empty-mark">${ICONS.document}</div>
              <div class="launch-head-text">
                <h2>开始</h2>
                <p>新建文档、打开 .aimd 或导入 Markdown。</p>
              </div>
            </header>

            <div class="launch-actions">
              <button id="empty-new" class="primary-btn" type="button">
                <span class="primary-btn-icon">${ICONS.plus}</span>
                <span>新建文档</span>
              </button>
              <button id="empty-open" class="secondary-btn" type="button">
                <span class="secondary-btn-icon">${ICONS.folder}</span>
                <span>打开 .aimd</span>
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
              <textarea id="markdown" spellcheck="false"></textarea>
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
    </div>
  </div>
`;
