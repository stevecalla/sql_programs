# bmac.py
import streamlit as st

def show_bmac(
    username: str = "stevecalla",
    where: str = "sidebar",
    text: str = "Buy me a coffee ☕",
    bg: str = "#EAF2FF",          # light blue
    hover_bg: str = "#D8E8FF",    # a touch darker on hover
    text_color: str = "#0F172A",  # dark slate for good contrast
    border_color: str = "rgba(0,0,0,.12)"
):
    """
    Render a Buy Me a Coffee button.
      - username: your BMAC handle
      - where: "sidebar" | "footer" | "main"
      - text: button label
      - bg / hover_bg: background colors (default light blue)
    """
    url = f"https://buymeacoffee.com/{username}"
    html = f"""
    <style>
      .bmac-btn {{
        display:inline-flex; align-items:center; gap:.5rem;
        background:{bg}; color:{text_color}; padding:.5rem .85rem;
        border-radius:10px; text-decoration:none; font-weight:700;
        border:1px solid {border_color};
        box-shadow: 0 1px 2px rgba(0,0,0,.06);
        transition: background .15s ease-in-out, filter .15s ease-in-out;
      }}
      .bmac-btn:hover {{ background:{hover_bg}; filter: brightness(0.99); }}
      .bmac-wrap {{ display:flex; justify-content:center; }}
      .bmac-foot {{ margin-top:1.25rem; padding-top:.75rem; border-top:1px solid #eee; }}
    </style>
    <div class="bmac-wrap{' bmac-foot' if where=='footer' else ''}">
      <a class="bmac-btn" href="{url}" target="_blank" rel="noopener">{text}</a>
    </div>
    """
    if where == "sidebar":
        with st.sidebar:
            st.markdown(html, unsafe_allow_html=True)
    elif where == "footer":
        st.markdown(html, unsafe_allow_html=True)
    else:  # "main"
        st.markdown(html, unsafe_allow_html=True)
