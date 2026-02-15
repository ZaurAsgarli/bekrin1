"""
Production settings
"""
from .base import *

DEBUG = False

# Production security settings
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'

# Production database (must be PostgreSQL)
# If DATABASE_URL is not set, this will raise an error (which is intentional)
# Ensure DATABASE_URL is set in production environment
_default_db = env.db('DATABASE_URL')
_default_db.setdefault('CONN_MAX_AGE', 60)
DATABASES['default'] = _default_db
