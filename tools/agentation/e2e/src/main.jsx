import React from "react";
import { createRoot } from "react-dom/client";
import { Agentation } from "agentation";
import "./style.css";

function App() {
  return (
    <>
      <main>
        <p className="eyebrow">MIDAD / CLOUD INTEGRATION TEST</p>
        <h1>Agentation end-to-end test</h1>
        <p>
          This isolated preview exists only to verify annotation delivery.
          It is not the production Control Room and contains no MIDAD data.
        </p>
        <section>
          <h2>Sample UI control</h2>
          <button type="button" data-testid="annotation-target">
            E2E sample control
          </button>
          <p className="hint">
            In the automated test, Agentation selects this button and sends a
            synthetic note to the test server.
          </p>
        </section>
        <p className="status">Environment: isolated CI preview</p>
      </main>
      <Agentation
        endpoint="http://127.0.0.1:4747"
        appName="MIDAD Agentation E2E"
      />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
