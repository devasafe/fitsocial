import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// A ordem importa: o arquivo móvel só sobrescreve, e empata em
// especificidade com o de desktop — quem vem depois vence.
import "./estilo.css";
import "./estilo-movel.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
