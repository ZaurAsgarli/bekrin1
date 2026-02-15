"""
Global exception handler for consistent API error responses.
Follows DRF convention and returns uniform structure.
"""
import logging
from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status
from django.http import Http404
from django.core.exceptions import PermissionDenied, ValidationError as DjangoValidationError

logger = logging.getLogger(__name__)


def custom_exception_handler(exc, context):
    """
    Custom exception handler that returns:
    { "detail": str, "code": str (optional), "errors": dict (optional) }
    """
    response = exception_handler(exc, context)
    if response is not None:
        data = response.data if isinstance(response.data, dict) else {'detail': str(response.data)}
        if 'detail' not in data and response.data:
            data = {'detail': data.get('message', str(response.data))}
        data.setdefault('detail', _get_detail(exc))
        data.setdefault('code', _get_code(exc))
        response.data = data
        return response

    if isinstance(exc, PermissionDenied):
        return Response(
            {'detail': str(exc) or 'Permission denied', 'code': 'permission_denied'},
            status=status.HTTP_403_FORBIDDEN
        )
    if isinstance(exc, DjangoValidationError):
        return Response(
            {'detail': str(exc), 'code': 'validation_error'},
            status=status.HTTP_400_BAD_REQUEST
        )

    logger.exception('Unhandled exception: %s', exc)
    # Never expose stack traces to frontend; use standard API error format
    return Response(
        {'detail': 'An internal error occurred.', 'code': 'internal_error'},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR
    )


def _get_detail(exc):
    if hasattr(exc, 'detail'):
        d = exc.detail
        if isinstance(d, list):
            return d[0] if d else 'Error'
        if isinstance(d, dict):
            return d.get('detail', str(d))
        return str(d)
    return str(exc)


def _get_code(exc):
    codes = {
        'AuthenticationFailed': 'invalid_credentials',
        'NotFound': 'not_found',
        'PermissionDenied': 'permission_denied',
        'ValidationError': 'validation_error',
    }
    return codes.get(type(exc).__name__, 'error')
