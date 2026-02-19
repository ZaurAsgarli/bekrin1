"""
Custom middleware for bekrin-back.
"""
from django.utils.deprecation import MiddlewareMixin
import logging

logger = logging.getLogger(__name__)


class FrameOptionsExemptMiddleware(MiddlewareMixin):
    """
    Remove X-Frame-Options for responses that must be embeddable in iframes
    (e.g. PDF preview on teacher exam detail, media files).
    Must run after django.middleware.clickjacking.XFrameOptionsMiddleware.
    """
    # Path prefixes that may be loaded in iframes (PDF preview, media)
    FRAME_EXEMPT_PREFIXES = ('/media/', '/protected-media/', '/api/student/runs/')

    def process_response(self, request, response):
        path = request.path
        # Check if this is a path that should be embeddable
        should_exempt = any(path.startswith(prefix) for prefix in self.FRAME_EXEMPT_PREFIXES)
        
        # Also exempt PDF files by content-type or file extension
        if not should_exempt:
            content_type = response.get('Content-Type', '')
            if 'application/pdf' in content_type.lower():
                should_exempt = True
            elif path.lower().endswith('.pdf'):
                should_exempt = True
        
        if should_exempt:
            # Remove X-Frame-Options header if present
            if 'X-Frame-Options' in response:
                del response['X-Frame-Options']
                logger.debug(f"Removed X-Frame-Options for path: {path}")
            # Also ensure SecurityMiddleware doesn't add it back
            # Set a custom header to indicate this is exempt (for debugging)
            response['X-Frame-Allowed'] = 'true'
        
        return response
