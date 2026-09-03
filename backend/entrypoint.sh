#!/bin/sh
# Entrypoint di produzione: migrazioni, static, superuser opzionale, poi il comando (gunicorn).
set -e

echo "→ migrate"
python manage.py migrate --noinput

echo "→ createcachetable"
python manage.py createcachetable

echo "→ collectstatic"
python manage.py collectstatic --noinput

# Superuser creato al primo avvio solo se le due env sono presenti.
# Se l'utente esiste già createsuperuser fallisce: lo ignoriamo di proposito.
if [ -n "$DJANGO_SUPERUSER_EMAIL" ] && [ -n "$DJANGO_SUPERUSER_PASSWORD" ]; then
  if python manage.py createsuperuser --noinput --email "$DJANGO_SUPERUSER_EMAIL" 2>/dev/null; then
    echo "→ superuser creato: $DJANGO_SUPERUSER_EMAIL"
  else
    echo "→ superuser già presente, salto"
  fi
fi

exec "$@"
