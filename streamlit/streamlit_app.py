"""CloneScope on Streamlit Community Cloud (an alternative to the GitHub Pages site).

Deploy: share.streamlit.io -> Create app -> this repository, branch main,
main file path: streamlit/streamlit_app.py

The analysis still runs in the visitor's browser: this page only serves the same
single-file app (dist/clonescope.html). Free Streamlit apps go to sleep when nobody
uses them, so open the link a minute before a demo.
"""
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).resolve().parent.parent
st.set_page_config(page_title="CloneScope", page_icon=str(ROOT / "dist" / "icon.png"), layout="wide")
st.markdown(
    "<style>#MainMenu, header, footer {visibility: hidden;}"
    " .block-container {padding: 0 !important; max-width: 100% !important;}"
    " iframe {border: 0;}</style>",
    unsafe_allow_html=True,
)
components.html((ROOT / "dist" / "clonescope.html").read_text(encoding="utf-8"), height=1150, scrolling=True)
