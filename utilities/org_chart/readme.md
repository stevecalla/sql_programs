# Org Chart → PowerPoint (with Inline PDF Preview)

Generate a multi‑slide **PowerPoint org chart** from CSV/Excel, edit the data live in Streamlit, download the PPTX, and preview the **entire deck inline** as a PDF.

- PPTX generation: [`python-pptx`](https://python-pptx.readthedocs.io/)
- PDF preview: **LibreOffice (headless)** → PDF + **pdf.js** renderer
- Cross‑platform: Linux (server) + Windows/macOS (dev)

---

## Table of Contents

- [Features](#features)
- [Data Template](#data-template)
  - [Required Columns](#required-columns)
  - [Optional Columns](#optional-columns)
  - [Minimal CSV Example](#minimal-csv-example)
- [Project Layout](#project-layout)
- [Installation](#installation)
  - [Python Dependencies](#python-dependencies)
  - [LibreOffice Setup](#libreoffice-setup)
- [Running the App](#running-the-app)
- [Configuration](#configuration)
- [How the Layout Works](#how-the-layout-works)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [License](#license)

---

## Features

- Upload **CSV / XLSX / XLS**
- In‑app **editable grid** (add/modify rows)
- Auto‑builds slides: **Cover page** + one slide per **Department**
- Responsive layout with wrapping and **true connector lines**
- Inline **multi‑slide PDF preview**
- One‑click **Download PPTX**
- Optional department ordering via an `order` column

---

## Data Template

### Required Columns

| Column         | Type   | Notes                                                                 |
| -------------- | ------ | --------------------------------------------------------------------- |
| `employee_id`  | string | **Unique** per person                                                 |
| `name`         | string | Person’s full name                                                    |
| `title`        | string | Job title                                                             |
| `manager_id`   | string | The **employee_id** of the person’s manager; blank/self = top/root    |
| `department`   | string | Department name (drives one slide per department)                     |

### Optional Columns

| Column         | Type   | Notes                                                                 |
| -------------- | ------ | --------------------------------------------------------------------- |
| `tenure`       | string | Display text (e.g., `2 years, 5 months`)                              |
| `tenure_calc`  | number | Years as a number (e.g., `2.5`) → used to compute avg tenure on cover |
| `order`        | number | If provided, controls department ordering across slides                |

> A person is a department **root** when `manager_id` is blank, equals their own `employee_id`, or the manager is outside that department. External managers appear on a small top row with connectors into the department.

### Minimal CSV Example

```csv
employee_id,name,title,manager_id,department,tenure,tenure_calc,order
100,Alex Tan,CEO,100,Executive Leadership,7 years,7.0,0
1101,Jill Meyers,Director of Ops,100,Operations,5 years,5.0,2
1102,Sam Patel,Ops Manager,1101,Operations,2 years,2.0,2
2101,Chris Diaz,Director of Eng,100,Engineering,6 years,6.0,1
2102,Mia Wong,Senior Engineer,2101,Engineering,3 years,3.0,1
2103,Leo Park,Engineer,2101,Engineering,1 year,1.0,1
3101,Jamie Fox,Director of Sales,100,Sales,4 years,4.0,3
3102,Ana Ruiz,Account Exec,3101,Sales,2 years,2.0,3
```

---

## Project Layout

```
.
├─ app.py               # Streamlit UI (upload/edit/generate/preview)
├─ pptx_chart.py        # PPTX builder (slides, shapes, true connectors)
├─ pdf_preview.py       # pdf.js inline viewer (multi-page, no data: iframes)
├─ lo_utils.py          # LibreOffice (headless) detection & PPTX→PDF
├─ config.py            # Tunable sizes/colors/fonts/connector styles
├─ requirements.txt
└─ README.md
```

---

## Installation

### Python Dependencies

Create a virtual environment and install deps:

```bash
python -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -U pip
pip install -r requirements.txt
```

**requirements.txt**

```
streamlit
pandas
python-pptx
openpyxl      # .xlsx reader
xlrd          # .xls reader (legacy)
```

### LibreOffice Setup

LibreOffice is only required for the **PDF preview** (you can still generate/download the PPTX without it).

- **Linux (Debian/Ubuntu)**

  ```bash
  sudo apt-get update
  sudo apt-get install -y libreoffice
  ```

- **macOS**

  ```bash
  brew install --cask libreoffice
  ```

- **Windows**  
  Install from https://www.libreoffice.org/.  
  The app prefers `soffice.com` to avoid pop‑up windows during headless runs.

If LibreOffice isn’t on PATH, set an environment variable:

- **Windows**

  ```powershell
  setx SOFFICE_PATH "C:\Program Files\LibreOffice\program\soffice.com"
  ```

- **Linux/macOS**

  ```bash
  export SOFFICE_PATH=/usr/bin/soffice
  ```

---

## Running the App

```bash
streamlit run app.py
```

Open the URL Streamlit prints (usually <http://localhost:8501>).

**Workflow**

1. (Optional) Download a template from the **Templates** expander.
2. Upload CSV/XLSX (or paste rows in the editor and add new rows).
3. Click **Generate PowerPoint**.
4. Download the **PPTX** and/or scroll the **inline PDF** preview.

---

## Configuration

All tunables live in `config.py`.

```python
# Margins / Title
LEFT_M_IN, RIGHT_M_IN = 0.5, 0.5
TOP_M_IN, BOTTOM_M_IN = 0.7, 0.4
TITLE_H_IN = 0.5

# Box targets & minimums (inches)
TARGET_BOX_W_IN = 2.4
TARGET_BOX_H_IN = 1.0
TARGET_X_GAP_IN = 2.6
TARGET_Y_GAP_IN = 1.4
MIN_BOX_W_IN = 1.2
MIN_BOX_H_IN = 0.75

# Fonts (pt)
NAME_FONT_PT = 12
TITLE_FONT_PT = 10
TENURE_FONT_PT = 9

# Connector lines (true connectors)
CONNECTOR_THICK_PT = 1.0              # try 0.6–1.5 for subtle; 2–3 for bold
CONNECTOR_COLOR    = (100, 100, 100)  # RGB tuple
```

To change connector visibility in the PDF preview, bump `CONNECTOR_THICK_PT`.

---

## How the Layout Works

- **Cover slide** lists each department with employee counts and (if present) **avg tenure** from `tenure_calc`.
- For each **department slide**:
  - Builds a department‑only tree (manager relationships within the department).
  - People whose manager is outside the department become **roots**; external managers render on a small **top row**.
  - Responsive layout computes box sizes and wraps nodes across rows as needed.
  - Connectors are routed as **vertical → horizontal bus → vertical** segments to reduce overlaps.

---

## Troubleshooting

**Chrome blocks the preview**  
The preview uses **pdf.js** inside a Streamlit component (not `data:` iframes). If you are in an air‑gapped environment, vendor pdf.js locally and update URLs in `pdf_preview.py`.

**PowerPoint shows a “Repair” dialog**  
Connector coordinates must be **integer EMUs** in the .pptx XML. The app ensures this; if you modify layout math, make sure any `/ 2` operations are replaced with `// 2` or wrapped with `int(...)` before calling `add_connector(...)`.

**Windows console window appears**  
Ensure `SOFFICE_PATH` points to `soffice.com` and not `soffice.exe`. The app runs with `CREATE_NO_WINDOW` to keep it silent.

**No inline PDF**  
You’ll see a notice if LibreOffice isn’t detected. Install it or set `SOFFICE_PATH`. You can still download/open the PPTX.

**Missing columns**  
The app validates headers and reports any missing required columns before generating the deck.

---

## FAQ

**Q: Do I need LibreOffice?**  
A: Only for the **inline PDF**. PPTX generation works without it.

**Q: Can I change the line thickness at runtime?**  
A: Yes—wire a Streamlit slider to override `CONNECTOR_THICK_PT` before building.

**Q: Why do some departments start at different rows?**  
A: Nodes are grouped by level; if there are many, the layout wraps to additional rows using the computed “max columns that fit” for your slide size and margins.

---

## License

MIT (or your preferred license). Add attribution if you redistribute.
