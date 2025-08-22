To install python packages:
ython -m venv venv

# Windows:
source venv/Scripts/activate
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
python org_chart_to_pptx.py

To run web server:
1) node server_org_chart.js or npm run pm2_start_slack_events_2200
2) this will spin up the venv environment & the app.py
3) cloudflare sub-domain is org-chart.kidderwise.org linked to http://localhost:8011
4) cloudflare url https://org-chart.kidderwise.org/

To run via streamlit directly
1) go to the utilities/org_chart directory
2) activate venv as above
3) go to the utilities/org_chart/src directory
4) enter streamlit run app.py

To run src/generate_chart_by_department.py:
1) go into src folder
2) activate venv as noted above
3) python generate_chart_by_department.py