# Parse the uploaded org chart DOCX to extract text from SmartArt/shapes with positions (if available)
# and produce a structured CSV with best-effort Name/Title parsing.
#
# Output: /mnt/data/org_chart_boxes.csv (box_id, name, title, raw_text, x_emu, y_emu, source_xml)
#
# Notes:
# - DOCX stores drawing elements in DrawingML (a: namespace). We try to find text and the nearest shape transform (a:xfrm)
#   to approximate (x,y) for layout sorting.
# - For classic textboxes, we also scan w:txbxContent (w:t text) though positions may be missing.
# - This won't reliably recover manager relationships from SmartArt; those are implicit in layout/connector lines.
#   We'll give a clean list of nodes (boxes) you can add a 'manager' column to, if desired.


import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
import csv
import re

docx_path = Path("org_chart_info_081825.docx")
out_csv = Path("org_chart_info.csv")

ns = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "v": "urn:schemas-microsoft-com:vml",
    "wpg": "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
    "wpi": "http://schemas.microsoft.com/office/word/2010/wordprocessingInk",
    "wne": "http://schemas.microsoft.com/office/word/2006/wordml",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
}

def extract_text_runs(elem):
    """Return all a:t text under elem concatenated with spaces/newlines by paragraphs."""
    texts = []
    # DrawingML text (a:t)
    for t in elem.findall(".//a:t", ns):
        if t.text:
            texts.append(t.text)
    # Word textboxes (w:txbxContent -> w:t)
    for t in elem.findall(".//w:txbxContent//w:t", ns):
        if t.text:
            texts.append(t.text)
    return texts

def find_shape_pos(elem):
    """Try to find a:xfrm/a:off (x,y) EMUs nearest under the shape or its properties."""
    # Common places: a:sp/a:spPr/a:xfrm/a:off; wps:spPr/a:xfrm/a:off
    off = elem.find(".//a:spPr//a:xfrm//a:off", ns)
    if off is None:
        off = elem.find(".//a:xfrm//a:off", ns)
    if off is not None:
        x = int(off.attrib.get("x", "0"))
        y = int(off.attrib.get("y", "0"))
        return x, y
    # Sometimes position on inline/anchor (wp) is not explicit; return None
    return None, None

boxes = []
box_id = 0

with zipfile.ZipFile(docx_path, "r") as z:
    # Collect relevant XML files in the word/ folder
    xml_files = [name for name in z.namelist() if name.startswith("word/") and name.endswith(".xml")]
    for name in xml_files:
        try:
            with z.open(name) as f:
                data = f.read()
            root = ET.fromstring(data)
        except Exception:
            continue

        # Heuristic 1: Word shapes w:drawing (contains a:graphic)
        # Look for shape containers: a:sp (shape), wps:wsp (wordprocessing shape), wpg:grpSp (group)
        shape_candidates = []
        shape_candidates += root.findall(".//a:sp", ns)
        shape_candidates += root.findall(".//wps:wsp", ns)
        shape_candidates += root.findall(".//w:drawing", ns)
        shape_candidates += root.findall(".//w:pict", ns)  # VML container

        for sc in shape_candidates:
            texts = extract_text_runs(sc)
            # Skip shapes with no text
            if not texts:
                continue
            raw = " ".join(t.strip() for t in texts if t.strip())
            if not raw:
                continue

            x, y = find_shape_pos(sc)

            box_id += 1
            boxes.append({
                "box_id": box_id,
                "raw_text": raw,
                "x_emu": x if x is not None else "",
                "y_emu": y if y is not None else "",
                "source_xml": name
            })

# Post-process raw_text into name/title if possible
def split_name_title(raw):
    # Split by newline-like separators or two+ spaces
    parts = re.split(r"[|\n\r]+| {2,}", raw)
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) >= 2:
        name = parts[0]
        title = parts[1]
    else:
        # try split by single line if comma present
        if "," in raw:
            name, title = [p.strip() for p in raw.split(",", 1)]
        else:
            # fallback: guess first token(s) are name if looks like "Firstname Lastname"
            tokens = raw.split()
            if len(tokens) >= 2 and tokens[0][0].isupper() and tokens[1][0].isupper():
                # assume first two tokens are name; rest as title
                name = " ".join(tokens[:2])
                title = " ".join(tokens[2:]) if len(tokens) > 2 else ""
            else:
                name = raw
                title = ""
    return name, title

# Deduplicate boxes with identical raw_text (common in grouped XML)
seen = set()
unique_boxes = []
for b in boxes:
    key = (b["raw_text"], b["x_emu"], b["y_emu"])
    if key in seen:
        continue
    seen.add(key)
    name, title = split_name_title(b["raw_text"])
    b["name"] = name
    b["title"] = title
    unique_boxes.append(b)

# Sort by y then x if positions exist, else by name
def sort_key(b):
    y = b["y_emu"] if b["y_emu"] != "" else float("inf")
    x = b["x_emu"] if b["x_emu"] != "" else float("inf")
    try:
        y = int(y)
        x = int(x)
    except:
        y, x = float("inf"), float("inf")
    return (y, x, b["name"])

unique_boxes.sort(key=sort_key)

# Write CSV
with open(out_csv, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["box_id", "name", "title", "raw_text", "x_emu", "y_emu", "source_xml", "manager"])
    for b in unique_boxes:
        writer.writerow([b["box_id"], b["name"], b["title"], b["raw_text"], b["x_emu"], b["y_emu"], b["source_xml"], ""])

(out_csv.as_posix(), len(unique_boxes))
