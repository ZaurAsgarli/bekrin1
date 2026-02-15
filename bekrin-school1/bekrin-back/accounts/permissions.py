"""
Custom permissions for role-based access
"""
from rest_framework import permissions


class IsTeacher(permissions.BasePermission):
    """Permission check for teacher role"""
    
    def has_permission(self, request, view):
        return (
            request.user and
            request.user.is_authenticated and
            request.user.role == 'teacher'
        )


class IsStudent(permissions.BasePermission):
    """Permission check for student role"""
    
    def has_permission(self, request, view):
        return (
            request.user and
            request.user.is_authenticated and
            request.user.role == 'student'
        )


class IsParent(permissions.BasePermission):
    """Permission check for parent role"""
    
    def has_permission(self, request, view):
        return (
            request.user and
            request.user.is_authenticated and
            request.user.role == 'parent'
        )
