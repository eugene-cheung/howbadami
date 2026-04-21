FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY roast_mvp.py roast_ds.py snark_engine.py roast_cache.py chesscom_stats.py ./
COPY backend ./backend
COPY data ./data

EXPOSE 8000
# Single worker: job state is in-process memory; multiple workers = different processes = "Unknown job_id" on poll.
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
