import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Agentation } from "agentation";
import "./style.css";

function App() {
  const [product, setProduct] = useState({
    product_key: "loading",
    display_name: "MIDAD Mobile Factory",
    preview_url: "/product-preview/index.html",
  });

  useEffect(() => {
    let mounted = true;
    fetch("/product-preview/preview-manifest.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Product preview manifest is not available");
        return response.json();
      })
      .then((manifest) => {
        if (mounted) setProduct(manifest);
      })
      .catch((error) => {
        if (mounted) setProduct((current) => ({ ...current, preview_error: error.message }));
      });
    return () => { mounted = false; };
  }, []);

  return (
    <>
      <main>
        <p className="eyebrow">MIDAD / MOBILE FACTORY · AGENTATION E2E</p>
        <h1>{product.display_name || "MIDAD Mobile Factory"} UI review</h1>
        <p>
          Isolated development preview of the selected Factory product. The actual
          Capacitor WebView entry loads below in a same-origin frame; annotations
          are sent to the temporary CI Agentation server and verified through MCP.
        </p>
        <div className="preview-meta">
          <span>Product: <strong>{product.product_key}</strong></span>
          <span>Viewport: <strong>390 × 760</strong></span>
          <span>Mode: <strong>CI preview only</strong></span>
        </div>
        {product.preview_error ? <p role="alert" className="error">{product.preview_error}</p> : null}
        <section className="device-shell" aria-label="Product UI preview">
          <div className="device-chrome">
            <span className="device-camera" />
            <span>Android WebView preview</span>
            <span className="device-camera" />
          </div>
          <iframe
            title="MIDAD product preview"
            src={product.preview_url || "/product-preview/index.html"}
            data-testid="product-preview"
            loading="eager"
          />
        </section>
        <p className="status">
          Development tool only · Agentation is not included in the release APK.
        </p>
      </main>
      <Agentation endpoint="http://127.0.0.1:4747" appName={`MIDAD Factory · ${product.product_key || "product"}`} />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
