"""
Serializers for attendance app
"""
from rest_framework import serializers
from .models import AttendanceRecord
from students.serializers import StudentProfileSerializer
from groups.serializers import GroupSerializer


class AttendanceRecordSerializer(serializers.ModelSerializer):
    """Attendance Record serializer. Exposes date from lesson_date."""
    groupName = serializers.SerializerMethodField()
    date = serializers.DateField(source="lesson_date", read_only=True)

    def get_groupName(self, obj):
        return obj.group.name if obj.group else ""
    
    class Meta:
        model = AttendanceRecord
        fields = ['id', 'date', 'status', 'groupName']
        read_only_fields = ['id']
