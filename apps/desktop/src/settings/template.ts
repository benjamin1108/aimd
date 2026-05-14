import { gitIntegrationSectionHTML } from "./git-integration";

export function settingsTemplateHTML() {
  return `
  <main class="settings-shell">
    <form id="settings-form" class="settings-panel">
      <header class="settings-head">
        <div>
          <h1>AIMD 设置</h1>
          <p class="settings-head-sub">管理界面、模型和网页导入偏好</p>
        </div>
      </header>

      <div class="settings-body">
        <aside class="settings-nav" role="tablist" aria-label="设置分类">
          <button type="button" class="settings-nav-item is-active" data-section="general" role="tab" aria-selected="true">常规</button>
          <button type="button" class="settings-nav-item" data-section="model" role="tab" aria-selected="false">AI / 模型</button>
          <button type="button" class="settings-nav-item" data-section="webclip" role="tab" aria-selected="false">网页导入</button>
          <button type="button" class="settings-nav-item" data-section="format" role="tab" aria-selected="false">格式化</button>
          <button type="button" class="settings-nav-item" data-section="git" role="tab" aria-selected="false">Git 集成</button>
        </aside>

        <div class="settings-content">
          <section class="settings-section is-active" data-section="general" role="tabpanel" aria-labelledby="settings-tab-general">
            <header class="settings-section-head">
              <h2>常规</h2>
              <p>调整主窗口的显示偏好。</p>
            </header>

            <label class="toggle-field">
              <input type="checkbox" id="ui-show-asset-panel" />
              <span class="toggle-field-text">
                <span class="field-label">显示资源面板</span>
                <span class="field-hint">在左侧栏显示当前文档内嵌资源列表。关闭后不影响图片保存、资源检查和导出。</span>
              </span>
            </label>

            <label class="toggle-field">
              <input type="checkbox" id="ui-debug-mode" />
              <span class="toggle-field-text">
                <span class="field-label">启用调试模式</span>
                <span class="field-hint">显示调试控制台入口和运行时诊断。关闭后，后台日志仍会保留，但不会主动打扰。</span>
              </span>
            </label>
          </section>

          <section class="settings-section" data-section="model" role="tabpanel" aria-labelledby="settings-tab-model" hidden>
            <header class="settings-section-head">
              <h2>模型连接</h2>
              <p>请选择模型服务商并配置对应的访问凭据。</p>
            </header>

            <label class="field">
              <span class="field-label">Provider</span>
              <select id="provider">
                <option value="dashscope">DashScope（通义千问）</option>
                <option value="gemini">Gemini（Google）</option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">模型</span>
              <select id="model-select"></select>
              <input id="model" type="text" autocomplete="off" spellcheck="false" hidden />
            </label>

            <label class="field">
              <span class="field-label">API Key</span>
              <div class="api-key-wrap" data-state="masked">
                <input id="api-key" class="api-key-input" type="password" autocomplete="off" spellcheck="false" />
                <span class="api-key-mask" aria-hidden="true"></span>
                <button id="api-key-reveal" type="button" class="api-key-reveal" aria-pressed="false" aria-label="显示 / 隐藏 API Key" title="显示 / 隐藏">
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M1.5 8s2.6-4.5 6.5-4.5S14.5 8 14.5 8s-2.6 4.5-6.5 4.5S1.5 8 1.5 8z"/>
                    <circle cx="8" cy="8" r="2"/>
                  </svg>
                </button>
              </div>
              <span id="api-key-error" class="field-error" hidden></span>
            </label>

            <label class="field">
              <span class="field-label">API Base <em class="field-optional">可选</em></span>
              <input id="api-base" type="url" autocomplete="off" spellcheck="false" placeholder="留空使用 Provider 官方接入点" />
            </label>

            <div class="connection-test-row">
              <button id="test-connection" class="secondary-btn" type="button">测试连接</button>
              <span id="connection-test-state" class="connection-test-state" aria-live="polite"></span>
            </div>
          </section>

          <section class="settings-section" data-section="webclip" role="tabpanel" aria-labelledby="settings-tab-webclip" hidden>
            <header class="settings-section-head">
              <h2>从网页导入</h2>
              <p>配置从网页创建草稿时的正文清洗与智能排版。</p>
            </header>

            <label class="field" style="flex-direction: row; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="webclip-llm-enabled" style="margin: 0; width: 16px; height: 16px;" />
              <span class="field-label" style="margin: 0;">开启大模型智能排版与清洗</span>
            </label>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">启用后，会把提取到的网页正文发送给所选模型，并生成摘要、核心观点和层级化分章正文。这可能会增加一些等待时间。</p>

            <label class="field">
              <span class="field-label">Provider</span>
              <select id="webclip-provider">
                <option value="dashscope">DashScope（通义千问）</option>
                <option value="gemini">Gemini（Google）</option>
              </select>
              <span class="field-hint">API Key 和 API Base 复用 AI / 模型 中该 Provider 的配置。</span>
            </label>

            <label class="field">
              <span class="field-label">网页导入模型</span>
              <select id="webclip-model-select"></select>
              <input id="webclip-model" type="text" autocomplete="off" spellcheck="false" hidden />
            </label>

            <label class="field">
              <span class="field-label">输出语言</span>
              <select id="webclip-output-language">
                <option value="zh-CN">中文</option>
                <option value="en">英文</option>
              </select>
            </label>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">如果网页原文不是所选语言，智能排版会在保留链接、图片和术语的前提下翻译正文。</p>
          </section>

          <section class="settings-section" data-section="format" role="tabpanel" aria-labelledby="settings-tab-format" hidden>
            <header class="settings-section-head">
              <h2>一键格式化</h2>
              <p>配置当前文档一键整理时使用的模型和输出语言。</p>
            </header>

            <label class="field">
              <span class="field-label">Provider</span>
              <select id="format-provider">
                <option value="dashscope">DashScope（通义千问）</option>
                <option value="gemini">Gemini（Google）</option>
              </select>
              <span class="field-hint">API Key 和 API Base 复用 AI / 模型 中该 Provider 的配置。</span>
            </label>

            <label class="field">
              <span class="field-label">格式化模型</span>
              <select id="format-model-select"></select>
              <input id="format-model" type="text" autocomplete="off" spellcheck="false" hidden />
            </label>

            <label class="field">
              <span class="field-label">输出语言</span>
              <select id="format-output-language">
                <option value="zh-CN">中文</option>
                <option value="en">英文</option>
              </select>
            </label>
          </section>

          ${gitIntegrationSectionHTML()}
        </div>
      </div>

      <footer class="settings-actions">
        <span id="save-state" class="settings-save-state" aria-live="polite"></span>
        <button id="reset-model" class="ghost-btn" type="button">恢复默认模型</button>
        <button id="cancel" class="secondary-btn" type="button">取消</button>
        <button id="save-settings" class="primary-btn" type="submit" disabled>保存</button>
      </footer>
    </form>
  </main>
`;
}
