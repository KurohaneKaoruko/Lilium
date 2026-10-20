import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initDesktopApi } from "./api/client";
import "./index.css";

async function bootstrap() {
  // Tauri 桌面端：先拿内嵌 API 地址再渲染
  await initDesktopApi();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
