import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { MARCA } from "./marca";
import "./estilo.css";

// O <title> do index.html é estático: sem isto, trocar o nome do produto
// deixaria o antigo na aba do navegador.
document.title = `${MARCA} Pro`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
