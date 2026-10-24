FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/opt/kozha/server
WORKDIR /app
COPY infra/bsl/provision.py /app/provision.py
RUN python provision.py
COPY infra/bsl/requirements.lock /app/requirements.lock
RUN pip install --no-cache-dir -r requirements.lock
COPY infra/bsl/bridge.py /app/bridge.py
RUN useradd --uid 10002 --create-home bsl
USER bsl
CMD ["uvicorn", "bridge:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
