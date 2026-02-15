"""
Serializers for groups app
"""
from rest_framework import serializers
from .models import Group, GroupStudent
from students.serializers import StudentProfileSerializer


class GroupSerializer(serializers.ModelSerializer):
    """Group serializer. order alias for sort_order (frontend compat)."""
    studentCount = serializers.IntegerField(source='student_count', read_only=True)
    active = serializers.BooleanField(source='is_active', read_only=True)
    order = serializers.IntegerField(source='sort_order', read_only=True)
    
    class Meta:
        model = Group
        fields = ['id', 'name', 'display_name', 'active', 'order', 'sort_order', 'studentCount']
        read_only_fields = ['id']


class GroupStudentSerializer(serializers.ModelSerializer):
    """Group Student serializer"""
    student_profile = StudentProfileSerializer(read_only=True)
    student_profile_id = serializers.IntegerField(write_only=True, required=False)
    
    class Meta:
        model = GroupStudent
        fields = ['id', 'group', 'student_profile', 'student_profile_id', 'active', 'joined_at']
        read_only_fields = ['id', 'joined_at']
