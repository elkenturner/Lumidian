FROM python:3.11-slim

WORKDIR /app

# Install system deps needed by Pillow (qrcode) and ReportLab
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpng-dev \
    libjpeg-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Railway injects $PORT at runtime
ENV PORT=8000

EXPOSE $PORT

COPY start.sh .
RUN chmod +x start.sh
CMD ["./start.sh"]
