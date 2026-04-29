// Package vendor exposes the third-party JS libraries we ship inside
// generated HTML payloads (sealed documents, the editor UI, etc.).
//
// Keeping these as embedded strings — rather than fetching from a CDN —
// guarantees that AIMD output stays self-contained and offline-friendly.
package vendor

import _ "embed"

//go:embed marked.min.js
var MarkedJS string

//go:embed fflate.min.js
var FflateJS string
