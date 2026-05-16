import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, Page, test } from "@playwright/test";

function loadInjectorBundle() {
  execFileSync("npm", ["run", "build:injector"], { cwd: process.cwd(), stdio: "pipe" });
  return readFileSync(path.resolve(process.cwd(), "../dist/injector.js"), "utf8");
}

async function installInjectorMock(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Map<string, Function[]>();
    const dispatch = async (event: string, payload: any) => {
      for (const listener of listeners.get(event) || []) await listener({ event, payload, id: Date.now() });
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        if (cmd === "plugin:event|listen") {
          const event = String(args?.event);
          const handler = args?.handler as Function;
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)!.push(handler);
          return handler;
        }
        if (cmd === "plugin:event|unlisten") {
          const event = String(args?.event);
          const handler = args?.eventId as Function;
          const list = listeners.get(event) || [];
          const index = list.indexOf(handler);
          if (index >= 0) list.splice(index, 1);
          return null;
        }
        if (cmd === "plugin:event|emit") return dispatch(String(args?.event), args?.payload);
        return null;
      },
      transformCallback: (cb: Function) => cb,
      convertFileSrc: (value: string) => `asset://localhost${value}`,
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as any).__TAURI__ = { core: { convertFileSrc: (value: string) => `asset://localhost${value}` } };
  });
}

test.describe("WebClip CSS isolation", () => {
  test("uses shadow CSS, survives hostile host CSS, and cleans up on cancel", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await installInjectorMock(page);
    await page.goto("/?webclip-hostile=1");
    await page.evaluate(() => {
      document.body.style.overflow = "auto";
      const style = document.createElement("style");
      style.textContent = `
        * { font: 1px serif !important; color: red !important; }
        input, button { display: none !important; }
        .aimd-clip-shell { display: block !important; }
      `;
      document.head.appendChild(style);
    });

    await page.addScriptTag({ content: loadInjectorBundle() });
    const shell = page.locator(".aimd-clip-shell");
    await expect(shell).toHaveAttribute("role", "dialog");

    const shadowState = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>(".aimd-clip-shell");
      const bar = host?.shadowRoot?.querySelector<HTMLElement>(".aimd-clip-bar");
      const button = host?.shadowRoot?.querySelector<HTMLElement>(".aimd-clip-btn[data-action='extract']");
      return {
        hasShadow: Boolean(host?.shadowRoot),
        buttonDisplay: button ? getComputedStyle(button).display : "",
        buttonBorderStyle: button ? getComputedStyle(button).borderStyle : "",
        barAuraAnimation: bar ? getComputedStyle(bar, "::before").animationName : "",
        hostStyles: document.head.querySelectorAll("style").length,
      };
    });
    expect(shadowState.hasShadow).toBe(true);
    expect(shadowState.buttonDisplay).not.toBe("none");
    expect(shadowState.buttonBorderStyle).toBe("solid");
    expect(shadowState.barAuraAnimation).toBe("none");

    await page.locator(".aimd-clip-btn[data-action='extract']").click();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await page.locator(".aimd-clip-btn.secondary").click();
    await expect(shell).not.toBeAttached();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("auto");
  });
});
