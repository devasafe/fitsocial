import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// A ordem importa: o arquivo móvel só sobrescreve, e empata em
// especificidade com o de desktop — quem vem depois vence.
import { MARCA } from "./marca";
import "./estilo.css";
import "./estilo-movel.css";

// O <title> do index.html e estatico: sem isto, o nome antigo ficaria na
// aba do navegador depois do rebranding.
document.title = `${MARCA} — painel`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
