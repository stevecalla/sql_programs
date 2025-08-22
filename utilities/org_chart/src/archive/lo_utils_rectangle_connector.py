# LibreOffice helpers (quiet on Windows, cross-platform)

import os, sys, tempfile, subprocess

def resolve_soffice_path() -> str:
    """
    Cross-platform path resolution for LibreOffice CLI.
    On Windows prefer soffice.com to avoid UI popups.
    SOFFICE_PATH env var overrides.
    """
    p = os.environ.get("SOFFICE_PATH")
    if p:
        return p

    if sys.platform.startswith("win"):
        candidates = [
            r"C:\Program Files\LibreOffice\program\soffice.com",
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.com",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
            "soffice.com",
            "soffice.exe",
        ]
    else:
        candidates = ["soffice"]

    for c in candidates:
        if os.path.sep in c:
            if os.path.isfile(c):
                return c
        else:
            return c  # bare name; let PATH resolve

    return "soffice.com" if sys.platform.startswith("win") else "soffice"

def _run_soffice(args, cwd=None):
    """
    Run LibreOffice with flags, suppressing console windows on Windows.
    Returns CompletedProcess.
    """
    exe = resolve_soffice_path()
    common = dict(stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd)

    if sys.platform.startswith("win"):
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        common["startupinfo"] = si
        common["creationflags"] = subprocess.CREATE_NO_WINDOW

    return subprocess.run([exe, *args], **common)

def libreoffice_available() -> bool:
    try:
        cp = _run_soffice(["--version"])
        return cp.returncode == 0
    except Exception:
        return False

def pptx_to_pdf_bytes(pptx_bytes: bytes) -> bytes:
    """
    Convert PPTX bytes -> PDF bytes using LibreOffice headless.
    """
    with tempfile.TemporaryDirectory(prefix="pptx_pdf_") as td:
        in_path = os.path.join(td, "deck.pptx")
        with open(in_path, "wb") as f:
            f.write(pptx_bytes)

        args = [
            "--headless", "--nologo", "--nolockcheck", "--nodefault",
            "--norestore", "--invisible",
            "--convert-to", "pdf", "--outdir", td, in_path
        ]
        cp = _run_soffice(args, cwd=td)
        if cp.returncode != 0:
            msg = (cp.stderr or cp.stdout).decode("utf-8", errors="ignore")
            raise RuntimeError(f"LibreOffice PDF export failed: {msg}")

        pdf_path = os.path.join(td, "deck.pdf")
        with open(pdf_path, "rb") as f:
            return f.read()
