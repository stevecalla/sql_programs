# Streamlit entrypoint: upload/edit -> build PPT -> download + inline PDF preview

import pandas as pd
import streamlit as st

from lo_utils import libreoffice_available, pptx_to_pdf_bytes
from pdf_preview import embed_pdf_inline
from pptx_chart import build_ppt
from config import ORDER_COL

# Backward-compat shim for Streamlit data editor
try:
    DATA_EDITOR = st.data_editor
except AttributeError:
    DATA_EDITOR = st.experimental_data_editor  # Streamlit < 1.19

st.set_page_config(page_title="Org Chart → PowerPoint", layout="centered")
st.title("Org Chart → PowerPoint")
st.write(
    "Upload a **CSV or Excel (.xlsx/.xls)** with columns "
    "**employee_id, name, title, manager_id, department**. "
    "Optional: **tenure** (display text), **tenure_calc** (numeric years). "
    f"(Optional ordering column: **{ORDER_COL}**)"
)

# ---- Template download (place ABOVE the file_uploader) ----
from pathlib import Path
# SAMPLE_PATH = Path(__file__).with_name("sample_org.csv")  # or .parent/'assets'/'sample_org.csv'
SAMPLE_PATH = Path(__file__).parent / "assets" / "sample_org.csv"

if SAMPLE_PATH.exists():
    st.download_button(
        "⬇️ Download template (CSV)",
        data=SAMPLE_PATH.read_bytes(),
        file_name="sample_org.csv",
        mime="text/csv",
        help="Get a ready-to-edit sample org data file.",
    )
else:
    st.info("Template CSV not found. Ask your admin or generate a blank template from the Templates expander.")
# -----------------------------------------------------------

uploaded = st.file_uploader("Upload CSV or Excel", type=["csv", "xlsx", "xls"])

df = None
if uploaded is not None:
    try:
        name = (uploaded.name or "").lower()
        if name.endswith((".xlsx", ".xls")):
            try:
                df = pd.read_excel(uploaded, dtype=str)
            except Exception:
                if name.endswith(".xlsx"):
                    df = pd.read_excel(uploaded, dtype=str, engine="openpyxl")
                else:
                    df = pd.read_excel(uploaded, dtype=str, engine="xlrd")
        else:
            df = pd.read_csv(uploaded, dtype=str)
        df = df.fillna("")
    except Exception as e:
        st.error(f"Unable to read file: {e}")
        df = None

edited_df = None
if df is not None:
    st.subheader("Edit data (click cells to change, use + to add rows)")
    st.caption("Tip: Click a cell to edit, press Enter to commit. Use the + icon at the bottom to add rows.")

    edited_df = DATA_EDITOR(
        df,
        num_rows="dynamic",
        use_container_width=True,
        hide_index=True,
        key="editor_main",
        column_config={
            "employee_id": st.column_config.TextColumn("employee_id", help="Unique ID", required=True),
            "name": st.column_config.TextColumn("name", required=True),
            "title": st.column_config.TextColumn("title", required=True),
            "manager_id": st.column_config.TextColumn("manager_id", help="Manager employee_id; blank for top-level"),
            "department": st.column_config.TextColumn("department", required=True),
            "tenure": st.column_config.TextColumn("tenure"),
            "tenure_calc": st.column_config.NumberColumn(
                "tenure_calc", help="Years as a number (e.g., 2.5)", step=0.1, format="%.1f"
            ),
        },
    )

    try:
        live_df = edited_df if edited_df is not None else df
        st.subheader("Department summary (live)")
        counts = (
            live_df.groupby("department")["employee_id"]
            .nunique()
            .reset_index(name="Employees")
        )
        if "tenure_calc" in live_df.columns:
            tmp = live_df.copy()
            tmp["tenure_calc"] = pd.to_numeric(tmp["tenure_calc"], errors="coerce")
            avg_df = (
                tmp.groupby("department")["tenure_calc"]
                .mean()
                .round(1)
                .reset_index(name="Avg Tenure (yrs)")
            )
            counts = counts.merge(avg_df, on="department", how="left")
        st.dataframe(counts.sort_values("department"), use_container_width=True)
    except Exception as _e:
        st.caption(f"Summary note: {_e}")
else:
    live_df = None

col1, col2 = st.columns([3, 2])
with col1:
    out_name = st.text_input("Output filename", value="org_chart.pptx")
with col2:
    btn = st.button("Generate PowerPoint", type="primary")

if btn:
    use_df = edited_df if edited_df is not None else df
    if use_df is None:
        st.error("Please upload a valid file first.")
    else:
        required = ["employee_id", "name", "title", "manager_id", "department"]
        missing = [c for c in required if c not in use_df.columns]
        if missing:
            st.error(f"Missing required columns: {', '.join(missing)}")
        else:
            try:
                ppt_io = build_ppt(use_df)
                ppt_bytes = ppt_io.getvalue()

                st.success("Deck generated!")
                st.download_button(
                    label="Download PPTX",
                    data=ppt_bytes,
                    file_name=out_name or "org_chart.pptx",
                    mime="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                )

                st.divider()
                st.subheader("Inline PDF preview")

                if libreoffice_available():
                    try:
                        with st.spinner("Converting PPTX → PDF…"):
                            pdf_bytes = pptx_to_pdf_bytes(ppt_bytes)
                        embed_pdf_inline(pdf_bytes, height=900, scale=1.25)
                    except Exception as e:
                        st.error(f"PDF preview failed: {e}")
                else:
                    st.info(
                        "LibreOffice not detected (needed for PDF preview). "
                        "Install LibreOffice or set SOFFICE_PATH, or use the Download button to open the PPTX."
                    )

            except Exception as e:
                st.error(f"Failed to generate deck: {e}")
