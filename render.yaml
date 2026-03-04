services:
  - type: web
    name: sevends-company-hub
    env: python
    plan: free
    buildCommand: pip install -r requirements.txt
    startCommand: gunicorn app:app --workers 1 --threads 4 --timeout 120
    envVars:
      - key: PYTHON_VERSION
        value: 3.12.3
      - key: DB_PATH
        value: hub.db
      - key: ADMIN_KEYS
        sync: false
      - key: MAX_HOF_PAGES
        value: 10
      - key: AUTO_SCAN
        value: 1
      - key: AUTO_SCAN_MINUTES
        value: 10
