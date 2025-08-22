# Inline PDF rendering with pdf.js (works even when Chrome blocks data: in iframes)

import base64
import streamlit as st

def embed_pdf_inline(pdf_bytes: bytes, height: int = 900, scale: float = 1.25):
    """
    Render PDF pages with pdf.js and show a client-side spinner while drawing.
    Requires internet access to cdnjs; vendor files if air-gapped.
    """
    b64 = base64.b64encode(pdf_bytes).decode("utf-8")
    html = f"""
    <div style="position:relative; width:100%; height:{height}px; background:#fff; overflow:auto;">
      <div id="pdfjs_container" style="width:100%; min-height:100%;"></div>
      <div id="pdfjs_loader" style="
          position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
          background:rgba(255,255,255,0.6);">
        <div style="
            width:48px; height:48px; border:6px solid #ddd; border-top-color:#333;
            border-radius:50%; animation:spin 1s linear infinite;"></div>
      </div>
    </div>
    <style>
      @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
    </style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>
      (async function() {{
        try {{
          pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          const raw = atob("{b64}");
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

          const container = document.getElementById("pdfjs_container");
          const loader = document.getElementById("pdfjs_loader");
          const pdf = await pdfjsLib.getDocument({{ data: bytes }}).promise;

          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {{
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({{ scale: {scale} }});
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.display = "block";
            canvas.style.margin = "0 auto 16px";
            container.appendChild(canvas);
            await page.render({{ canvasContext: ctx, viewport }}).promise;
          }}
          if (loader) loader.remove();
        }} catch (e) {{
          const loader = document.getElementById("pdfjs_loader");
          if (loader) loader.innerHTML = "<div style='color:#c00;font-family:system-ui;padding:12px;'>Failed to render PDF.</div>";
          console.error(e);
        }}
      }})();
    </script>
    """
    st.components.v1.html(html, height=height, scrolling=True)
