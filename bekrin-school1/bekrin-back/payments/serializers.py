"""
Serializers for payments app
"""
from decimal import Decimal
from rest_framework import serializers
from .models import Payment


class PaymentSerializer(serializers.ModelSerializer):
    """Payment serializer. Exposes date from payment_date for frontend."""
    studentId = serializers.IntegerField(source='student_profile.id', read_only=True)
    studentName = serializers.CharField(source='student_profile.user.full_name', read_only=True)
    groupId = serializers.IntegerField(source='group.id', read_only=True, allow_null=True)
    groupName = serializers.CharField(source='group.name', read_only=True, allow_null=True)
    paymentNumber = serializers.CharField(source='receipt_no', read_only=True)
    date = serializers.DateField(source='payment_date', read_only=True)
    
    class Meta:
        model = Payment
        fields = [
            'id', 'studentId', 'studentName', 'groupId', 'groupName',
            'amount', 'date', 'title', 'method', 'status', 'note', 'paymentNumber'
        ]
        read_only_fields = ['id', 'paymentNumber']
    
    def to_representation(self, instance):
        data = super().to_representation(instance)
        if 'amount' in data and data['amount'] is not None:
            data['amount'] = float(data['amount'])
        return data


class TeacherPaymentSerializer(PaymentSerializer):
    """
    Teacher sees amount/4 (real amount stays in DB).
    Parent uses PaymentSerializer (full amount).
    """
    def to_representation(self, instance):
        data = super().to_representation(instance)
        if 'amount' in data and data['amount'] is not None:
            data['amount'] = round(float(data['amount']) / 4, 2)
        return data


class _NullableIntegerField(serializers.IntegerField):
    """Accepts empty string as None for optional IDs from frontend."""

    def to_internal_value(self, data):
        if data in (None, '', []) or (isinstance(data, str) and not str(data).strip()):
            return None
        if isinstance(data, str) and str(data).strip().isdigit():
            return int(str(data).strip())
        return super().to_internal_value(data)


class PaymentCreateSerializer(serializers.Serializer):
    """Payment create serializer (frontend format)"""
    studentId = serializers.IntegerField()
    groupId = _NullableIntegerField(required=False, allow_null=True)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0.01'))
    date = serializers.DateField()
    title = serializers.CharField(required=False, allow_blank=True)
    method = serializers.ChoiceField(choices=['cash', 'card', 'bank'])
    status = serializers.ChoiceField(choices=['paid', 'pending'])
    note = serializers.CharField(required=False, allow_blank=True)
    
    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than 0")
        return value
    
    def create(self, validated_data):
        from students.models import StudentProfile
        from groups.models import Group
        
        student_id = validated_data.pop('studentId')
        group_id = validated_data.pop('groupId', None)
        date_val = validated_data.pop('date')
        title_val = validated_data.pop('title', None)
        
        student = StudentProfile.objects.select_related('user').get(id=student_id)
        group = Group.objects.get(id=group_id) if group_id else None
        created_by = validated_data.pop('created_by', None)
        organization = validated_data.pop('organization', None) or (created_by.organization if created_by else None)
        # Ensure student belongs to same org when org is set
        if organization and getattr(student.user, 'organization_id', None) != organization.pk:
            raise serializers.ValidationError(
                {'studentId': 'Bu şagird sizin təşkilatınıza aid deyil'}
            )

        return Payment.objects.create(
            student_profile=student,
            group=group,
            payment_date=date_val,
            title=title_val or '',
            created_by=created_by,
            organization=organization,
            **validated_data
        )
