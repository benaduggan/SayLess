// Must be the first import; sets __webpack_public_path__ so dynamic
// chunks resolve against the extension origin. See publicPath.ts.
import "./publicPath";

import React from "react";
import { createRoot } from "react-dom/client";
import Content from "./Content";

// Idempotency: content script is injected via manifest AND by
// executeScripts() on session start; both mounts would double-fire.
const contentWindow = window as Window & {
  __screenityContentBootstrapped?: boolean;
};

if (contentWindow.__screenityContentBootstrapped) {
} else {
  contentWindow.__screenityContentBootstrapped = true;

  const existingRoot = document.getElementById("screenity-ui");
  if (existingRoot) {
    document.body.removeChild(existingRoot);
  }

  const root = document.createElement("div");
  root.id = "screenity-ui";
  document.body.appendChild(root);

  const appRoot = createRoot(root);
  appRoot.render(<Content />);
}
