import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installBugTrap } from "./opencodex/bugtrap";
import "./globals.css";

// 本地 bug 收集：未捕获错误 / Promise 拒绝 / console.error → ~/.opencodex/logs/opencodex.jsonl
installBugTrap();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
