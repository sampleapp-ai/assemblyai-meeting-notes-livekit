FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY meeting_notes.py .

CMD ["python", "meeting_notes.py", "start"]
