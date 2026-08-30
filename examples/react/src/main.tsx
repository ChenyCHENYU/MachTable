import React from "react";
import ReactDOM from "react-dom/client";
import { MachTableProvider } from "@agile-team/mach-table-react";
import "@agile-team/mach-table-react/styles.css";
import App from "./App";
import machTableConfig from "./mach-table.config";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MachTableProvider config={machTableConfig}>
      <App />
    </MachTableProvider>
  </React.StrictMode>
);
