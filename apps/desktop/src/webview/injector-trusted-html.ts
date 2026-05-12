import type { DiagnosticLevel, ExtractDiagnostic } from "./injector-types";

type RecordFn = (level: DiagnosticLevel, message: string, data?: unknown) => void;
type TrustedHTMLPolicy = { createHTML: (input: string) => unknown };

export function createSafeHTMLSetter(
  record: RecordFn,
): (target: Element | HTMLTemplateElement, html: string) => void {
  let trustedHTMLPolicy: TrustedHTMLPolicy | null | undefined;

  const trustedHTMLFor = (html: string): unknown | null => {
    if (trustedHTMLPolicy === undefined) {
      trustedHTMLPolicy = null;
      try {
        const trustedTypes = (window as any).trustedTypes;
        if (trustedTypes?.createPolicy) {
          trustedHTMLPolicy = trustedTypes.createPolicy("aimd-web-clip", {
            createHTML: (input: string) => input,
          });
        }
      } catch (err) {
        recordTrustedHTMLDiagnostic(record, "Trusted Types policy creation unavailable", err);
      }
    }
    try {
      return trustedHTMLPolicy?.createHTML(html) || null;
    } catch (err) {
      recordTrustedHTMLDiagnostic(record, "Trusted Types HTML creation failed", err);
      return null;
    }
  };

  return (target, html) => {
    const trustedHTML = trustedHTMLFor(html);
    try {
      (target as any).innerHTML = trustedHTML || html;
    } catch (err) {
      record("warn", "HTML assignment blocked by page policy", {
        error: errorMessage(err),
        trustedPolicy: Boolean(trustedHTML),
      });
      if (target instanceof HTMLTemplateElement) return;
      target.textContent = html;
    }
  };
}

function recordTrustedHTMLDiagnostic(record: RecordFn, message: string, err: unknown) {
  record("debug", message, { error: errorMessage(err) } satisfies ExtractDiagnostic["data"]);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
