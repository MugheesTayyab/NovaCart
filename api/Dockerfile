# Build from the repository root:  docker build -f api/Dockerfile .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/api

COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/app ./app
COPY policies /srv/policies

# The policy index is built (or loaded from this cache) when the service starts.
ENV POLICY_DIR=/srv/policies \
    INDEX_CACHE_DIR=/tmp/policy_index

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
