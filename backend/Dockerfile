FROM python:3.11-slim-bookworm

WORKDIR /app

# Install system deps for Pillow (qrcode), ReportLab, Playwright Chromium,
# and the agency video pipeline (ffmpeg + ffprobe for audio extraction).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpng-dev \
    libjpeg-dev \
    ffmpeg \
    curl \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Install typst CLI for agency PDF rendering (used by document_engine.typst_renderer).
# Static musl binary works fine on Debian glibc.
RUN TYPST_VER="0.14.2" && \
    ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then TYPST_ARCH="x86_64-unknown-linux-musl"; \
    elif [ "$ARCH" = "arm64" ]; then TYPST_ARCH="aarch64-unknown-linux-musl"; \
    else echo "Unsupported arch: $ARCH" && exit 1; fi && \
    curl -fsSL "https://github.com/typst/typst/releases/download/v${TYPST_VER}/typst-${TYPST_ARCH}.tar.xz" \
        | tar -xJ --strip-components=1 -C /usr/local/bin "typst-${TYPST_ARCH}/typst" && \
    chmod +x /usr/local/bin/typst && \
    typst --version

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
