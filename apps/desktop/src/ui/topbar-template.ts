import { ICONS } from "../core/state";

export const APP_TOPBAR_HTML = `
      <header class="app-topbar" id="app-topbar">
        <div class="brand app-brand">
          <span class="brand-mark">A</span>
          <span class="brand-name">AIMD</span>
        </div>
        <div class="app-scope" aria-label="当前位置">
          <strong id="app-scope-primary">主页</strong>
          <span class="app-scope-sep">/</span>
          <span id="app-scope-secondary">新建、打开、最近文档</span>
        </div>
        <div class="app-actions" aria-label="常用操作">
          <div class="app-menu-wrap">
            <button id="global-new-toggle" class="secondary-btn app-action-btn" type="button" aria-haspopup="menu" aria-expanded="false">
              <span class="secondary-btn-icon">${ICONS.plus}</span>
              <span>新建</span>
            </button>
            <div id="global-new-menu" class="action-menu global-menu" role="menu" hidden>
              <div class="action-menu-title">新建</div>
              <button id="global-new-draft" class="action-menu-item" type="button">
                <span class="action-menu-icon">${ICONS.document}</span>
                <span>空白 AIMD 草稿</span>
                <small>⌘N</small>
              </button>
              <button id="global-new-project-aimd" class="action-menu-item" type="button" disabled>
                <span class="action-menu-icon">${ICONS.plus}</span>
                <span>在项目中新建 AIMD</span>
                <small>.aimd</small>
              </button>
              <button id="global-new-project-markdown" class="action-menu-item" type="button" disabled>
                <span class="action-menu-icon">${ICONS.source}</span>
                <span>在项目中新建 Markdown</span>
                <small>.md</small>
              </button>
              <hr class="action-menu-divider" role="separator">
              <button id="web-import" class="action-menu-item" type="button">
                <span class="action-menu-icon">${ICONS.link}</span>
                <span>从网页导入</span>
                <small>URL</small>
              </button>
              <button id="global-import-md-project" class="action-menu-item" type="button">
                <span class="action-menu-icon">${ICONS.folder}</span>
                <span>导入 Markdown 文件夹</span>
              </button>
            </div>
          </div>

          <div class="app-menu-wrap">
            <button id="global-open-toggle" class="secondary-btn app-action-btn" type="button" aria-haspopup="menu" aria-expanded="false">
              <span class="secondary-btn-icon">${ICONS.folder}</span>
              <span>打开</span>
            </button>
            <div id="global-open-menu" class="action-menu global-menu" role="menu" hidden>
              <div class="action-menu-title">打开</div>
              <button id="global-open-document" class="action-menu-item" type="button">
                <span class="action-menu-icon">${ICONS.openDocument}</span>
                <span>打开文档</span>
                <small>⌘O</small>
              </button>
              <button id="global-open-workspace" class="action-menu-item" type="button">
                <span class="action-menu-icon">${ICONS.folder}</span>
                <span>打开项目目录</span>
              </button>
            </div>
          </div>

          <div class="app-menu-wrap">
            <button id="app-menu-toggle" class="secondary-btn app-action-btn" type="button" aria-haspopup="menu" aria-expanded="false">
              <span class="secondary-btn-icon">${ICONS.more}</span>
              <span>更多</span>
              <span class="menu-chevron" aria-hidden="true">▾</span>
            </button>
            <div id="app-menu" class="action-menu global-menu app-level-menu" role="menu" hidden>
              <div class="action-menu-title">更多</div>
              <button id="new-window" class="action-menu-item" type="button">
                <span class="action-menu-icon">${ICONS.plus}</span>
                <span>新建窗口</span>
                <small>⇧⌘N</small>
              </button>
              <button id="settings-open" class="action-menu-item" type="button">
                <span class="action-menu-icon">${ICONS.settings}</span>
                <span>设置</span>
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
`;
