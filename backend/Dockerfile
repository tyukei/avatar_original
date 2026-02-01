FROM python:3.13-slim

WORKDIR /app

# Install system dependencies if needed (e.g. for audio processing)
# RUN apt-get update && apt-get install -y ...

# Copy project files
COPY pyproject.toml .
# COPY uv.lock . # Optional if we were using uv, but pip serves fine

# Install dependencies
# Using --system to install into system python in the container
RUN pip install --no-cache-dir .

# Copy source code
COPY . .

# Cloud Run defaults PORT to 8080
ENV PORT=8080

# Command to run the application
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
