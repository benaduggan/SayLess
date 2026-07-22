import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/app.scss";
import Content from "./Content";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root mount element");
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.Fragment>
    <Content />
  </React.Fragment>
);
