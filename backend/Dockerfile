FROM python:3.11-slim-bookworm

WORKDIR /app

# Install system deps for Pillow (qrcode), ReportLab, Playwright Chromium,
# and the agency video pipeline (ffmpeg + ffprobe for audio extraction).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpng-dev \
    libjpeg-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Chromium for Playwright (used by site_audit render-mode detection).
# --with-deps pulls in the system libraries Chromium needs. Adds ~150 MB.
RUN python -m playwright install --with-deps chromium

COPY . .

# Railway injects $PORT at runtime
ENV PORT=8000

EXPOSE $PORT

COPY start.sh .
RUN chmod +x start.sh
CMD ["./start.sh"]
