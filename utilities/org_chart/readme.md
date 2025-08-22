To install python packages:
ython -m venv venv

# Windows:
source venv/Scripts/activate
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
python org_chart_to_pptx.py

To Run Streamlit Server:
1) TBD
2) TBD
3) TBD

streamlit run app.py

To run src/generate_chart_by_department.py:
1) go into src folder
2) activate venv as noted above
3) python generate_chart_by_department.py