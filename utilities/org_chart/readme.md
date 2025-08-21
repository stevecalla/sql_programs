python -m venv venv

# Windows:
source venv/Scripts/activate
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
python org_chart_to_pptx.py


python generate_chart_by_department.py
streamlit run app.py
