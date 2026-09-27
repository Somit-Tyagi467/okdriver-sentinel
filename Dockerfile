FROM node:20-alpine AS frontend
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/index.html ./index.html
COPY frontend/vite.config.js ./vite.config.js
COPY frontend/tailwind.config.js ./tailwind.config.js
COPY frontend/postcss.config.js ./postcss.config.js
COPY frontend/src ./src
RUN npm run build

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    OKDRIVER_DB=/app/data/okdriver.sqlite3

WORKDIR /app
COPY server.py ./server.py
COPY static ./static
COPY --from=frontend /web/dist ./frontend/dist
RUN mkdir -p /app/data && useradd --system --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
VOLUME ["/app/data"]
CMD ["python", "server.py"]
