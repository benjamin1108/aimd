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
          <section class="nav-section nav-section--doc" id="doc-section">
            <div class="section-label">文档</div>
            <div class="section-content">
              <div id="doc-card" class="doc-card" data-state="empty">
                <span class="doc-card-icon">${ICONS.document}</span>
                <div class="doc-card-text">
                  <div class="doc-card-title">未打开文档</div>
                  <div class="doc-card-meta">点击下方打开 .aimd</div>
                </div>
              </div>
            </div>
          </section>

          <button class="sb-resizer" id="resizer-1" hidden
                  data-above="#doc-section" data-below="#outline-section"
                  aria-label="调整文档与大纲高度"></button>

          <section class="nav-section" id="outline-section" hidden>
            <div class="section-label">
              <span>大纲</span>
              <span class="section-count" id="outline-count">0</span>
            </div>
            <div class="section-content">
              <div id="outline-list" class="outline-list"></div>
            </div>
          </section>

          <button class="sb-resizer" id="resizer-2" hidden
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
            <button id="head-import" class="secondary-btn" type="button">
              <span class="secondary-btn-icon">${ICONS.document}</span>
              <span>打开 Markdown</span>
            </button>
          </div>

          <div class="head-actions" id="doc-actions" hidden>
            <div class="mode-switch" role="tablist">
              <button id="mode-read" class="mode-btn" role="tab" aria-selected="true" type="button" disabled>
                <span class="mode-btn-icon">${ICONS.read}</span>
                <span>阅读</span>
              </button>
              <button id="mode-edit" class="mode-btn" role="tab" aria-selected="false" type="button" disabled>
                <span class="mode-btn-icon">${ICONS.edit}</span>
                <span>编辑</span>
              </button>
              <button id="mode-source" class="mode-btn" role="tab" aria-selected="false" type="button" disabled>
                <span class="mode-btn-icon">${ICONS.source}</span>
                <span>源码</span>
              </button>
            </div>

            <div class="quick-actions">
              <button id="save" class="primary-btn" type="button" disabled>
                <span class="primary-btn-icon">${ICONS.save}</span>
                <span id="save-label">保存</span>
              </button>
              <button id="save-as" class="secondary-btn" type="button" disabled>
                <span class="secondary-btn-icon">${ICONS.folder}</span>
                <span>另存为</span>
              </button>
              <button id="close" class="secondary-btn" type="button" disabled>
                <span class="secondary-btn-icon">${ICONS.close}</span>
                <span>关闭文档</span>
              </button>
            </div>
          </div>
        </header>

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
            <div class="launch-hero">
              <div class="empty-mark">${ICONS.document}</div>
              <div class="launch-eyebrow">AIMD Desktop</div>
              <h2>把图文文档装进一个文件</h2>
              <p>正文、图片和元信息始终在一起。发给别人，不丢图；换个目录，也能完整打开。</p>
              <div class="launch-actions">
                <button id="empty-new" class="primary-btn lg" type="button">
                  <span class="primary-btn-icon">${ICONS.plus}</span>
                  <span>新建文档</span>
                </button>
                <button id="empty-open" class="secondary-btn lg" type="button">
                  <span class="secondary-btn-icon">${ICONS.folder}</span>
                  <span>打开文件</span>
                </button>
                <button id="empty-import" class="secondary-btn lg" type="button">
                  <span class="secondary-btn-icon">${ICONS.document}</span>
                  <span>打开 Markdown</span>
                </button>
              </div>
              <div class="empty-hint">⌘N 新建 · ⌘O 打开 · ⇧⌘S 另存为 · 拖入 .aimd 可直接打开</div>
            </div>

            <section class="recent-section" id="recent-section" hidden>
              <div class="recent-head">
                <div class="recent-title">最近打开</div>
                <button id="clear-recent" class="text-btn" type="button">清空</button>
              </div>
              <div id="recent-list" class="recent-list"></div>
            </section>
          </article>

          <article id="reader" class="reader aimd" hidden></article>

          <article id="inline-editor"
                   class="reader aimd inline-editor"
                   contenteditable="true"
                   spellcheck="false"
                   hidden></article>

          <div id="editor-wrap" class="editor-split" hidden>
            <div class="editor-pane">
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
          <span class="status-pill" id="status-pill" data-tone="idle">
            <span class="status-dot"></span>
            <span id="status">就绪</span>
          </span>
        </footer>
      </main>
    </div>
  </div>
`;
