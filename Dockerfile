# =============================================================================
# Dockerfile — Dashboard Ejecutivo SonarQube (Flask)
# =============================================================================
# Imagen basada en Debian con las librerías nativas que necesita WeasyPrint
# (Pango, Cairo, GDK-PixBuf, GObject) ya instaladas vía apt — el mismo
# problema que en Windows requiere el runtime de GTK3, aquí son simples
# paquetes del sistema. Así se evita por completo el dolor de cabeza de
# "OSError: cannot load library 'libgobject-2.0-0'".
#
# IMPORTANTE: la configuración (SONARQUBE_HOST, DEFAULT_PROJECT_KEY, etc.) ya
# NO se edita en app.py sino vía variables de entorno / .env (ver README,
# sección "Configuración"). El .env NO se copia a la imagen (.dockerignore),
# así que hay que pasarlo en tiempo de ejecución.
#
# Uso recomendado: docker compose up -d --build (ver docker-compose.yml).
#
# Alternativa manual, sin compose:
#   docker build -t sonar-dashboard .
#   docker run --rm -p 5000:5000 --env-file .env sonar-dashboard
#   -> abrir http://localhost:5000
# =============================================================================

FROM python:3.12-slim

# Librerías nativas requeridas por WeasyPrint (Pango, Cairo, GDK-PixBuf, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libgdk-pixbuf2.0-0 \
    libffi8 \
    fonts-liberation \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Directorio de logs/histórico — se crean también en tiempo de ejecución,
# pero los dejamos listos para que los volúmenes se puedan montar desde
# fuera (ver docker-compose.yml). Corremos como usuario sin privilegios
# (buena práctica de seguridad); por eso hay que darle dueño explícito a
# /app antes de bajar de root.
RUN mkdir -p /app/logs /app/history \
    && useradd --create-home --uid 1000 appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 5000

# Chequeo de salud: pega contra /login (ruta pública, no requiere sesión)
# usando el mismo FLASK_PORT que use la app dentro del contenedor.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://localhost:' + os.environ.get('FLASK_PORT', '5000') + '/login', timeout=5)" || exit 1

# En producción real, considera reemplazar esto por un WSGI server
# (gunicorn/waitress) y poner FLASK_DEBUG=false en el .env — ver README.
CMD ["python", "app.py"]
